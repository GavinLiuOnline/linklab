//! MQTT 通道：rumqttc 异步客户端

use std::time::Duration;
use std::sync::Mutex;

use rumqttc::{AsyncClient, Event, MqttOptions, Packet};
use tauri::AppHandle;

use crate::state::{emit_frame, emit_status, FrameEvt};

pub struct MqttSlot {
    pub client: AsyncClient,
    tasks: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
}

impl MqttSlot {
    pub fn close(&self) {
        let client = self.client.clone();
        let _ = tauri::async_runtime::block_on(client.disconnect());
        for t in self.tasks.lock().unwrap().drain(..) {
            t.abort();
        }
    }
}

pub fn open(app: AppHandle, cfg: &serde_json::Value) -> Result<MqttSlot, String> {
    let host = cfg
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("broker.emqx.io")
        .to_string();
    let port = cfg.get("port").and_then(|v| v.as_u64()).unwrap_or(1883) as u16;
    let cid = cfg
        .get("client_id")
        .and_then(|v| v.as_str())
        .unwrap_or("linklab")
        .to_string();
    let keepalive = cfg.get("keepalive").and_then(|v| v.as_u64()).unwrap_or(30);

    let mut opts = MqttOptions::new(cid, &host, port);
    opts.set_keep_alive(Duration::from_secs(keepalive));
    if let Some(user) = cfg.get("username").and_then(|v| v.as_str()) {
        if !user.is_empty() {
            opts.set_credentials(
                user.to_string(),
                cfg.get("password")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            );
        }
    }

    let (client, mut eventloop) = AsyncClient::new(opts, 64);
    let task = tauri::async_runtime::spawn(async move {
        let mut errored = false;
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(Packet::Publish(p))) => {
                    emit_frame(
                        &app,
                        FrameEvt {
                            topic: Some(p.topic),
                            ..FrameEvt::plain("mqtt", p.payload.to_vec())
                        },
                    );
                }
                Ok(Event::Incoming(Packet::ConnAck(_))) => {
                    errored = false;
                    emit_status(&app, "mqtt", true, Some("已连接 Broker".into()));
                }
                Ok(Event::Incoming(Packet::Disconnect)) => {
                    emit_status(&app, "mqtt", false, Some("Broker 断开".into()));
                }
                Ok(_) => {}
                Err(e) => {
                    if !errored {
                        errored = true;
                        emit_status(&app, "mqtt", false, Some(format!("连接错误: {e}")));
                    }
                    // rumqttc 内部自动重连，保持轮询
                }
            }
        }
    });

    Ok(MqttSlot {
        client,
        tasks: Mutex::new(vec![task]),
    })
}
