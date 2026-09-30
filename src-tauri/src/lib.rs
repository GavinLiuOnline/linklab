//! LinkLab 通讯调试台 — Tauri 后端
//! 真实 IO：serialport（串口）/ tokio（TCP-UDP）/ rumqttc（MQTT）/ socketcan（CAN）
//! 后端只负责字节搬运与切帧；协议解析保留在前端（DESIGN.md §7）

mod can;
mod framer;
mod mqtt;
mod net;
mod serial;
mod state;

use state::{ChannelSlots, Slot};
use tauri::State;

#[derive(serde::Serialize)]
pub struct PortInfo {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    desc: Option<String>,
}

#[tauri::command]
fn serial_list() -> Vec<PortInfo> {
    serial::list()
        .into_iter()
        .map(|(name, desc)| PortInfo { name, desc })
        .collect()
}

/// 列出系统实际存在的 socketCAN 接口（/sys/class/net 下 ARP 类型 280 = ARPHRD_CAN）
#[tauri::command]
fn can_list() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Ok(rd) = std::fs::read_dir("/sys/class/net") {
        for e in rd.flatten() {
            let p = e.path().join("type");
            if let Ok(s) = std::fs::read_to_string(&p) {
                if s.trim() == "280" {
                    out.push(e.file_name().to_string_lossy().to_string());
                }
            }
        }
    }
    out.sort();
    out
}

/// 前端已通过 dialog 插件选定保存路径，后端负责写文件（WebView 的 Blob 下载不可靠）
#[tauri::command]
fn export_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents.as_bytes()).map_err(|e| e.to_string())
}

fn close_slot(slots: &ChannelSlots, channel: &str) {
    if let Some(s) = slots.0.lock().unwrap().remove(channel) {
        s.close();
    }
}

#[tauri::command]
fn channel_open(
    app: tauri::AppHandle,
    slots: State<'_, ChannelSlots>,
    channel: String,
    cfg: serde_json::Value,
) -> Result<(), String> {
    close_slot(&slots, &channel);
    let slot = match channel.as_str() {
        "serial" => {
            let port = cfg
                .get("port")
                .and_then(|v| v.as_str())
                .ok_or("缺少 port 配置")?
                .to_string();
            Slot::Serial(serial::open(app, port, &cfg)?)
        }
        "net" => Slot::Net(net::open(app, &cfg)?),
        "mqtt" => Slot::Mqtt(mqtt::open(app, &cfg)?),
        #[cfg(target_os = "linux")]
        "can" => Slot::Can(can::open(app, &cfg)?),
        #[cfg(not(target_os = "linux"))]
        "can" => return Err("CAN 需要 socketCAN，仅 Linux 平台支持".into()),
        other => return Err(format!("未知通道 {other}")),
    };
    slots.0.lock().unwrap().insert(channel, slot);
    Ok(())
}

#[tauri::command]
fn channel_close(slots: State<'_, ChannelSlots>, channel: String) -> Result<(), String> {
    close_slot(&slots, &channel);
    Ok(())
}

#[tauri::command]
fn channel_send(
    slots: State<'_, ChannelSlots>,
    channel: String,
    data: Vec<u8>,
    id: Option<u32>,
    rtr: Option<bool>,
) -> Result<(), String> {
    let guard = slots.0.lock().unwrap();
    let slot = guard.get(&channel).ok_or("通道未打开")?;
    slot.send(data, id, rtr)
}

#[tauri::command]
fn mqtt_publish(
    slots: State<'_, ChannelSlots>,
    topic: String,
    payload: Vec<u8>,
    qos: u8,
) -> Result<(), String> {
    let client = {
        let guard = slots.0.lock().unwrap();
        match guard.get("mqtt") {
            Some(Slot::Mqtt(m)) => m.client.clone(),
            _ => return Err("MQTT 未连接".into()),
        }
    };
    tauri::async_runtime::block_on(async move {
        let q = match qos {
            1 => rumqttc::QoS::AtLeastOnce,
            2 => rumqttc::QoS::ExactlyOnce,
            _ => rumqttc::QoS::AtMostOnce,
        };
        client
            .publish(topic, q, false, payload)
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn mqtt_subscribe(slots: State<'_, ChannelSlots>, topic: String, qos: u8) -> Result<(), String> {
    let client = {
        let guard = slots.0.lock().unwrap();
        match guard.get("mqtt") {
            Some(Slot::Mqtt(m)) => m.client.clone(),
            _ => return Err("MQTT 未连接".into()),
        }
    };
    tauri::async_runtime::block_on(async move {
        let q = match qos {
            1 => rumqttc::QoS::AtLeastOnce,
            2 => rumqttc::QoS::ExactlyOnce,
            _ => rumqttc::QoS::AtMostOnce,
        };
        client.subscribe(topic, q).await.map_err(|e| e.to_string())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ChannelSlots::new())
        .setup(|app| {
            // 帧事件批量发送线程（高频数据性能优化）
            state::start_frame_flush(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            serial_list,
            can_list,
            export_file,
            channel_open,
            channel_close,
            channel_send,
            mqtt_publish,
            mqtt_subscribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
