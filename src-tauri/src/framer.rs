//! 字节流切帧：帧间隔超时 / \r\n / 固定长度 / Modbus TCP MBAP / 原始

use std::time::{Duration, Instant};

#[derive(Clone)]
pub enum SplitMode {
    Gap(u64),
    Crlf,
    Raw,
    Mbap,
    Fixed(usize),
}

impl SplitMode {
    pub fn from_cfg(v: Option<&serde_json::Value>) -> SplitMode {
        let v = v.unwrap_or(&serde_json::Value::Null);
        match v.get("mode").and_then(|x| x.as_str()).unwrap_or("gap") {
            "crlf" => SplitMode::Crlf,
            "raw" => SplitMode::Raw,
            "mbap" => SplitMode::Mbap,
            "fixed" => SplitMode::Fixed(
                v.get("len").and_then(|x| x.as_u64()).unwrap_or(64) as usize,
            ),
            _ => SplitMode::Gap(v.get("ms").and_then(|x| x.as_u64()).unwrap_or(30)),
        }
    }
}

pub struct Framer {
    mode: SplitMode,
    buf: Vec<u8>,
    last: Option<Instant>,
}

impl Framer {
    pub fn new(mode: SplitMode) -> Self {
        Self {
            mode,
            buf: Vec::new(),
            last: None,
        }
    }

    /// 喂入数据（可传空切片用于超时冲刷），返回已完成的帧
    pub fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        let now = Instant::now();
        if let SplitMode::Gap(ms) = self.mode {
            let due = self
                .last
                .map(|t| now.duration_since(t) >= Duration::from_millis(ms))
                .unwrap_or(false);
            if due && !self.buf.is_empty() {
                let out = vec![std::mem::take(&mut self.buf)];
                if !data.is_empty() {
                    self.buf.extend_from_slice(data);
                    self.last = Some(now);
                }
                return out;
            }
        }
        match self.mode {
            SplitMode::Raw => {
                if data.is_empty() {
                    Vec::new()
                } else {
                    vec![data.to_vec()]
                }
            }
            SplitMode::Gap(_) => {
                self.buf.extend_from_slice(data);
                if !data.is_empty() {
                    self.last = Some(now);
                }
                Vec::new()
            }
            SplitMode::Crlf => {
                self.buf.extend_from_slice(data);
                let mut out = Vec::new();
                while let Some(pos) = self.buf.windows(2).position(|w| w == b"\r\n") {
                    out.push(self.buf.drain(..pos + 2).collect());
                }
                out
            }
            SplitMode::Fixed(n) => {
                self.buf.extend_from_slice(data);
                let mut out = Vec::new();
                while self.buf.len() >= n {
                    out.push(self.buf.drain(..n).collect());
                }
                out
            }
            SplitMode::Mbap => {
                self.buf.extend_from_slice(data);
                let mut out = Vec::new();
                loop {
                    if self.buf.len() < 7 {
                        break;
                    }
                    let len = u16::from_be_bytes([self.buf[4], self.buf[5]]) as usize;
                    let total = 6 + len; // MBAP 头 6B + unit/PDU
                    if self.buf.len() < total {
                        break;
                    }
                    out.push(self.buf.drain(..total).collect());
                }
                out
            }
        }
    }
}
