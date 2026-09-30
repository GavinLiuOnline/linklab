//! 通道事件与槽位管理：统一 frame / channel-status 事件，统一开关与发送

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// 帧事件（后端 → 前端渲染管线）
#[derive(Clone, Serialize)]
pub struct FrameEvt {
    pub channel: String,
    pub data: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtr: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
}

impl FrameEvt {
    pub fn plain(channel: &str, data: Vec<u8>) -> Self {
        Self {
            channel: channel.into(),
            data,
            peer: None,
            id: None,
            ext: None,
            rtr: None,
            topic: None,
        }
    }
}

/// 通道状态事件（连接 / 断开 / 错误）
#[derive(Clone, Serialize)]
pub struct StatusEvt {
    pub channel: String,
    pub open: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 帧批量缓冲：emit_frame 只入队，由 start_frame_flush 周期批量 emit，
/// 避免高频数据每帧一次 IPC 序列化压垮 webview 消息泵
static FRAME_BUF: Mutex<Vec<FrameEvt>> = Mutex::new(Vec::new());

pub fn emit_frame(_app: &AppHandle, ev: FrameEvt) {
    if let Ok(mut buf) = FRAME_BUF.lock() {
        buf.push(ev);
    }
}

/// 启动批量发送线程：每 20ms 把缓冲帧一次发往前端（frame-batch 事件）
pub fn start_frame_flush(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(20));
        let batch = match FRAME_BUF.lock() {
            Ok(mut b) => std::mem::take(&mut *b),
            Err(_) => continue,
        };
        if batch.is_empty() {
            continue;
        }
        let _ = app.emit("frame-batch", &batch);
    });
}

pub fn emit_status(app: &AppHandle, channel: &str, open: bool, message: Option<String>) {
    let _ = app.emit(
        "channel-status",
        StatusEvt {
            channel: channel.into(),
            open,
            message,
        },
    );
}

/// 每类通道一个槽位
pub enum Slot {
    Serial(crate::serial::SerialSlot),
    Net(crate::net::NetSlot),
    Mqtt(crate::mqtt::MqttSlot),
    #[cfg(target_os = "linux")]
    Can(crate::can::CanSlot),
}

impl Slot {
    pub fn send(&self, data: Vec<u8>, id: Option<u32>, rtr: Option<bool>) -> Result<(), String> {
        match self {
            Slot::Serial(s) => s.send(data),
            Slot::Net(s) => s.send(data),
            Slot::Mqtt(_) => Err("MQTT 请使用 mqtt_publish".into()),
            #[cfg(target_os = "linux")]
            Slot::Can(s) => s.send(data, id.unwrap_or(0), rtr.unwrap_or(false)),
        }
    }

    pub fn close(&self) {
        match self {
            Slot::Serial(s) => s.close(),
            Slot::Net(s) => s.close(),
            Slot::Mqtt(s) => s.close(),
            #[cfg(target_os = "linux")]
            Slot::Can(s) => s.close(),
        }
    }
}

#[derive(Default)]
pub struct ChannelSlots(pub Mutex<HashMap<String, Slot>>);

impl ChannelSlots {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}
