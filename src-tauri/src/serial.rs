//! 串口通道：serialport 读写线程 + 切帧

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serialport::{DataBits, FlowControl, Parity, SerialPortType, StopBits};
use tauri::AppHandle;

use crate::framer::{Framer, SplitMode};
use crate::state::{emit_frame, FrameEvt};

pub struct SerialSlot {
    tx: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    run: Arc<AtomicBool>,
}

impl SerialSlot {
    pub fn send(&self, data: Vec<u8>) -> Result<(), String> {
        self.tx
            .lock()
            .unwrap()
            .as_ref()
            .ok_or_else(|| "串口已关闭".to_string())?
            .send(data)
            .map_err(|e| e.to_string())
    }

    pub fn close(&self) {
        self.run.store(false, Ordering::Relaxed);
        self.tx.lock().unwrap().take(); // 丢弃 sender → 写线程退出
    }
}

pub fn open(app: AppHandle, port_name: String, cfg: &serde_json::Value) -> Result<SerialSlot, String> {
    let baud = cfg.get("baud").and_then(|v| v.as_u64()).unwrap_or(115200) as u32;
    let parity = match cfg.get("parity").and_then(|v| v.as_str()).unwrap_or("none") {
        "even" => Parity::Even,
        "odd" => Parity::Odd,
        _ => Parity::None,
    };
    let data_bits = match cfg.get("data_bits").and_then(|v| v.as_u64()).unwrap_or(8) {
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    let stop_bits = match cfg.get("stop_bits").and_then(|v| v.as_u64()).unwrap_or(1) {
        2 => StopBits::Two,
        _ => StopBits::One,
    };
    let flow = match cfg.get("flow").and_then(|v| v.as_str()).unwrap_or("none") {
        "rtscts" => FlowControl::Hardware,
        "xonxoff" => FlowControl::Software,
        _ => FlowControl::None,
    };
    let split = SplitMode::from_cfg(cfg.get("split"));

    let port = serialport::new(&port_name, baud)
        .parity(parity)
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .flow_control(flow)
        .timeout(Duration::from_millis(30))
        .open()
        .map_err(|e| format!("打开 {port_name} 失败: {e}"))?;

    let read_port = port.try_clone().map_err(|e| e.to_string())?;
    let run = Arc::new(AtomicBool::new(true));
    let (wtx, wrx) = mpsc::channel::<Vec<u8>>();

    // 读线程：读 → 切帧 → 事件
    let r = run.clone();
    let reader_app = app.clone();
    std::thread::spawn(move || {
        let mut port = read_port;
        let mut framer = Framer::new(split);
        let mut buf = [0u8; 512];
        while r.load(Ordering::Relaxed) {
            match port.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    for f in framer.feed(&buf[..n]) {
                        emit_frame(&reader_app, FrameEvt::plain("serial", f));
                    }
                }
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock =>
                {
                    for f in framer.feed(&[]) {
                        emit_frame(&reader_app, FrameEvt::plain("serial", f));
                    }
                }
                Err(_) => break, // 设备拔出等致命错误
            }
        }
    });

    // 写线程：独占写句柄
    let w = run.clone();
    std::thread::spawn(move || {
        let mut port = port;
        while w.load(Ordering::Relaxed) {
            match wrx.recv_timeout(Duration::from_millis(200)) {
                Ok(data) => {
                    if port.write_all(&data).is_err() {
                        break;
                    }
                    let _ = port.flush();
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }
    });

    Ok(SerialSlot {
        tx: Mutex::new(Some(wtx)),
        run,
    })
}

/// 枚举可用串口（含 USB 描述）
pub fn list() -> Vec<(String, Option<String>)> {
    serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let desc = match &p.port_type {
                SerialPortType::UsbPort(info) => info.product.clone(),
                SerialPortType::BluetoothPort => Some("蓝牙串口".into()),
                SerialPortType::PciPort => Some("PCI 串口".into()),
                _ => None,
            };
            (p.port_name, desc)
        })
        .collect()
}
