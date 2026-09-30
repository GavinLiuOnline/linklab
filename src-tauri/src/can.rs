//! CAN 通道（仅 Linux / socketCAN）：单线程轮询读写 + 硬件过滤
//! 非 Linux 平台（macOS/Windows）无 socketCAN：提供同 API 占位，open 即返回错误，
//! 仅为保证跨平台编译打包；前端 CAN 页只在 Linux 枚举接口，正常不会触发。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

#[cfg(target_os = "linux")]
use socketcan::{CanFrame, CanSocket, EmbeddedFrame, Id, Socket, SocketOptions, StandardId};
#[cfg(target_os = "linux")]
use std::time::Duration;

use tauri::AppHandle;

#[cfg(target_os = "linux")]
use crate::state::{emit_frame, FrameEvt};

pub struct CanSlot {
    tx: Mutex<Option<mpsc::Sender<(u32, bool, Vec<u8>)>>>,
    run: Arc<AtomicBool>,
}

impl CanSlot {
    pub fn send(&self, data: Vec<u8>, id: u32, rtr: bool) -> Result<(), String> {
        self.tx
            .lock()
            .unwrap()
            .as_ref()
            .ok_or_else(|| "CAN 通道已关闭".to_string())?
            .send((id, rtr, data))
            .map_err(|e| e.to_string())
    }

    pub fn close(&self) {
        self.run.store(false, Ordering::Relaxed);
        self.tx.lock().unwrap().take();
    }
}

/// 构造 CAN 帧标识（标准 11bit / 扩展 29bit）
#[cfg(target_os = "linux")]
fn make_id(raw: u32, ext: bool) -> Id {
    if ext {
        socketcan::ExtendedId::new(raw & 0x1FFF_FFFF)
            .map(Id::Extended)
            .unwrap_or_else(|| Id::Standard(StandardId::new(0).unwrap()))
    } else {
        StandardId::new((raw & 0x7FF) as u16)
            .map(Id::Standard)
            .unwrap_or_else(|| Id::Standard(StandardId::new(0).unwrap()))
    }
}

/// Linux：真实 socketCAN 打开 + 读写线程
#[cfg(target_os = "linux")]
pub fn open(app: AppHandle, cfg: &serde_json::Value) -> Result<CanSlot, String> {
    let iface = cfg
        .get("interface")
        .and_then(|v| v.as_str())
        .unwrap_or("can0")
        .to_string();
    let ext = cfg.get("ext").and_then(|v| v.as_bool()).unwrap_or(false);

    let sock = CanSocket::open(&iface).map_err(|e| format!("打开 {iface} 失败: {e}"))?;

    // 硬件过滤器：只收指定 ID（标准帧 11bit 精确匹配）
    if let Some(ids) = cfg.get("filter_ids").and_then(|v| v.as_array()) {
        let filters: Vec<socketcan::CanFilter> = ids
            .iter()
            .filter_map(|v| v.as_u64())
            .map(|id| socketcan::CanFilter::new((id & 0x7FF) as u32, 0x7FF))
            .collect();
        if !filters.is_empty() {
            let _ = sock.set_filters(&filters);
        }
    }

    let _ = sock.set_nonblocking(true);
    let sock = Arc::new(sock);
    let (tx, rx) = mpsc::channel::<(u32, bool, Vec<u8>)>();
    let run = Arc::new(AtomicBool::new(true));

    let r = run.clone();
    let io_sock = sock.clone();
    let io_app = app.clone();
    std::thread::spawn(move || {
        while r.load(Ordering::Relaxed) {
            // 写：队列命令 → 发送帧
            match rx.recv_timeout(Duration::from_millis(10)) {
                Ok((id, rtr, data)) => {
                    let cid = make_id(id, ext);
                    let frame = if rtr {
                        CanFrame::new_remote(cid, data.len().min(8))
                    } else {
                        CanFrame::new(cid, &data[..data.len().min(8)])
                    };
                    if let Some(f) = frame {
                        let _ = io_sock.write_frame(&f);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
            // 读：非阻塞排空所有待读帧（高负载总线一次收取，避免积压雪崩）
            loop {
                match io_sock.read_frame() {
                    Ok(f) => {
                        let (rid, rext) = match f.id() {
                            Id::Standard(s) => (s.as_raw() as u32, false),
                            Id::Extended(e) => (e.as_raw(), true),
                        };
                        emit_frame(
                            &io_app,
                            FrameEvt {
                                id: Some(rid),
                                ext: Some(rext),
                                rtr: Some(f.is_remote_frame()),
                                ..FrameEvt::plain("can", f.data().to_vec())
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        }
    });

    Ok(CanSlot {
        tx: Mutex::new(Some(tx)),
        run,
    })
}

/// 非 Linux：socketCAN 不可用，统一返回错误
#[cfg(not(target_os = "linux"))]
pub fn open(_app: AppHandle, _cfg: &serde_json::Value) -> Result<CanSlot, String> {
    Err("socketCAN 仅在 Linux 上可用".into())
}
