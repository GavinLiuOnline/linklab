//! 网络通道：TCP 客户端 / TCP 服务端（多客户端广播）/ UDP

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::mpsc;
use tauri::AppHandle;

use crate::framer::{Framer, SplitMode};
use crate::state::{emit_frame, FrameEvt};

pub struct NetSlot {
    /// 每个对端一个发送队列（客户端 1 个 / 服务端 N 个 / UDP 1 个）
    writers: Arc<Mutex<Vec<mpsc::UnboundedSender<Vec<u8>>>>>,
    tasks: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
}

impl NetSlot {
    pub fn send(&self, data: Vec<u8>) -> Result<(), String> {
        let mut n = 0;
        for tx in self.writers.lock().unwrap().iter() {
            if tx.send(data.clone()).is_ok() {
                n += 1;
            }
        }
        if n == 0 {
            return Err("无可用连接".into());
        }
        Ok(())
    }

    pub fn close(&self) {
        self.writers.lock().unwrap().clear();
        for t in self.tasks.lock().unwrap().drain(..) {
            t.abort();
        }
    }
}

pub fn open(app: AppHandle, cfg: &serde_json::Value) -> Result<NetSlot, String> {
    let mode = cfg
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("tcp")
        .to_string();
    let split = SplitMode::from_cfg(cfg.get("split"));
    match mode.as_str() {
        "tcp" => tcp_client(app, cfg, split),
        "tcps" => tcp_server(app, cfg, split),
        "udps" => udp_server(app, cfg, split),
        _ => udp(app, cfg),
    }
}

fn parse_addr(host: &str, port: u64) -> Result<String, String> {
    if host.contains(':') {
        Ok(format!("[{host}]:{port}")) // IPv6
    } else {
        Ok(format!("{host}:{port}"))
    }
}

fn tcp_client(app: AppHandle, cfg: &serde_json::Value, split: SplitMode) -> Result<NetSlot, String> {
    let host = cfg
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1")
        .to_string();
    let port = cfg.get("port").and_then(|v| v.as_u64()).unwrap_or(502);
    let addr = parse_addr(&host, port)?;
    let nodelay = cfg.get("nodelay").and_then(|v| v.as_bool()).unwrap_or(true);

    let stream: TcpStream = tauri::async_runtime::block_on(async {
        TcpStream::connect(&addr)
            .await
            .map_err(|e| format!("连接 {addr} 失败: {e}"))
    })?;
    let _ = stream.set_nodelay(nodelay);
    let (mut rh, mut wh) = stream.into_split();

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(data) = rx.recv().await {
            if wh.write_all(&data).await.is_err() {
                break;
            }
        }
    });

    let reader_app = app.clone();
    let reader_peer = addr.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let mut framer = Framer::new(split);
        let mut buf = [0u8; 4096];
        loop {
            match rh.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for f in framer.feed(&buf[..n]) {
                        emit_frame(
                            &reader_app,
                            FrameEvt {
                                peer: Some(reader_peer.clone()),
                                ..FrameEvt::plain("net", f)
                            },
                        );
                    }
                }
            }
        }
    });

    Ok(NetSlot {
        writers: Arc::new(Mutex::new(vec![tx])),
        tasks: Mutex::new(vec![reader, writer]),
    })
}

fn tcp_server(app: AppHandle, cfg: &serde_json::Value, split: SplitMode) -> Result<NetSlot, String> {
    let bind = cfg
        .get("bind")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0.0:9000")
        .to_string();

    let listener: TcpListener = tauri::async_runtime::block_on(async {
        TcpListener::bind(&bind)
            .await
            .map_err(|e| format!("监听 {bind} 失败: {e}"))
    })?;

    let writers: Arc<Mutex<Vec<mpsc::UnboundedSender<Vec<u8>>>>> = Arc::new(Mutex::new(Vec::new()));
    let accept_writers = writers.clone();
    let accept_app = app.clone();
    let accept = tauri::async_runtime::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, peer)) => {
                    let _ = stream.set_nodelay(true);
                    let (mut rh, mut wh) = stream.into_split();
                    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
                    accept_writers.lock().unwrap().push(tx);

                    // 每客户端写任务
                    tauri::async_runtime::spawn(async move {
                        while let Some(data) = rx.recv().await {
                            if wh.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                    });

                    // 每客户端读任务（独立切帧器）
                    let rapp = accept_app.clone();
                    let pstr = peer.to_string();
                    let split = split.clone();
                    tauri::async_runtime::spawn(async move {
                        let mut framer = Framer::new(split);
                        let mut buf = [0u8; 4096];
                        loop {
                            match rh.read(&mut buf).await {
                                Ok(0) | Err(_) => break,
                                Ok(n) => {
                                    for f in framer.feed(&buf[..n]) {
                                        emit_frame(
                                            &rapp,
                                            FrameEvt {
                                                peer: Some(pstr.clone()),
                                                ..FrameEvt::plain("net", f)
                                            },
                                        );
                                    }
                                }
                            }
                        }
                    });
                }
                Err(_) => break,
            }
        }
    });

    Ok(NetSlot {
        writers,
        tasks: Mutex::new(vec![accept]),
    })
}

fn udp(app: AppHandle, cfg: &serde_json::Value) -> Result<NetSlot, String> {
    let host = cfg
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1")
        .to_string();
    let port = cfg.get("port").and_then(|v| v.as_u64()).unwrap_or(502);
    let remote: SocketAddr = parse_addr(&host, port)?
        .parse()
        .map_err(|_| "远程地址解析失败".to_string())?;
    let bind = cfg
        .get("bind")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0.0:0")
        .to_string();

    let sock = Arc::new(
        tauri::async_runtime::block_on(async {
            UdpSocket::bind(&bind)
                .await
                .map_err(|e| format!("绑定 {bind} 失败: {e}"))
        })?,
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let wsock = sock.clone();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(data) = rx.recv().await {
            let _ = wsock.send_to(&data, remote).await;
        }
    });

    let reader_sock = sock; // 移动 Arc 到读任务
    let reader_app = app;
    let reader = tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match reader_sock.recv_from(&mut buf).await {
                Ok((n, peer)) => {
                    emit_frame(
                        &reader_app,
                        FrameEvt {
                            peer: Some(peer.to_string()),
                            ..FrameEvt::plain("net", buf[..n].to_vec())
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    Ok(NetSlot {
        writers: Arc::new(Mutex::new(vec![tx])),
        tasks: Mutex::new(vec![reader, writer]),
    })
}

/// UDP 服务端：绑定本地地址被动收包，发送时回复最后一个来源地址
fn udp_server(app: AppHandle, cfg: &serde_json::Value, _split: SplitMode) -> Result<NetSlot, String> {
    let bind = cfg
        .get("bind")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0.0:9000")
        .to_string();

    let sock = Arc::new(
        tauri::async_runtime::block_on(async {
            UdpSocket::bind(&bind)
                .await
                .map_err(|e| format!("绑定 {bind} 失败: {e}"))
        })?,
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let last_peer: Arc<Mutex<Option<SocketAddr>>> = Arc::new(Mutex::new(None));

    // writer：发往最近一次收包的对端
    let wsock = sock.clone();
    let wpeer = last_peer.clone();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(data) = rx.recv().await {
            let peer = *wpeer.lock().unwrap();
            if let Some(p) = peer {
                let _ = wsock.send_to(&data, p).await;
            } // 尚未收到任何客户端包时不发送（无已知对端）
        }
    });

    // reader：收包 → 记录来源 → 推给前端
    let reader_sock = sock;
    let reader = tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match reader_sock.recv_from(&mut buf).await {
                Ok((n, peer)) => {
                    *last_peer.lock().unwrap() = Some(peer);
                    emit_frame(
                        &app,
                        FrameEvt {
                            peer: Some(peer.to_string()),
                            ..FrameEvt::plain("net", buf[..n].to_vec())
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    Ok(NetSlot {
        writers: Arc::new(Mutex::new(vec![tx])),
        tasks: Mutex::new(vec![reader, writer]),
    })
}
