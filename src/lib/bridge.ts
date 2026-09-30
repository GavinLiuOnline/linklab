/**
 * IO 桥接层：Tauri 真实通道 ⇄ 模拟引擎自动降级
 * - Tauri 环境：invoke 命令 + 监听 frame/channel-status 事件
 * - 浏览器/强制模拟：走 mock.ts 演示引擎
 * 协议解析保留在前端（DESIGN.md §7 桥接要点 1）
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CONSOLE_OF, type ChannelId } from "./store";
import { pushLine, consoleStores, type LogSeg } from "./consoles";
import { bumpErr, bumpRxBatch, bumpTx, setOpen, toast } from "./state";
import { hexOf, asciiOf, utf8Decode } from "./bytes";
import { startMock, stopMock, mockSend, mockPorts } from "./mock";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let forceMock = false;
export function setForceMock(v: boolean) {
  forceMock = v;
}
export const mockActive = (): boolean => forceMock || !inTauri;

/* ── 事件类型（与 Rust 端结构对应） ── */
export interface FrameEvt {
  channel: ChannelId;
  data: number[];
  peer?: string;
  id?: number;
  ext?: boolean;
  rtr?: boolean;
  topic?: string;
}
export interface StatusEvt {
  channel: ChannelId;
  open: boolean;
  message?: string;
}

export interface SendMeta {
  /** CAN 帧 ID */
  canId?: number;
  /** MQTT 主题 */
  topic?: string;
  /** MQTT 负载文本 */
  text?: string;
  /** 附加在 TX 行尾的紫色标注（如 +CRC✓） */
  note?: string;
  /** 不回显 TX 行（仅计数） */
  silent?: boolean;
  /** CAN 远程帧 */
  rtr?: boolean;
  qos?: number;
}

let inited = false;
export async function initBridge(): Promise<void> {
  if (!inTauri || inited) return;
  inited = true;
  // 后端每 20ms 批量发帧：逐帧渲染行，RX 字节统计按批聚合一次提交
  await listen<FrameEvt[]>("frame-batch", (e) => {
    const rx: Partial<Record<ChannelId, number>> = {};
    for (const f of e.payload) {
      routeFrame(f);
      rx[f.channel as ChannelId] = (rx[f.channel as ChannelId] ?? 0) + f.data.length;
    }
    bumpRxBatch(rx);
  });
  await listen<StatusEvt>("channel-status", (e) => onStatus(e.payload));
}

/* ── 渲染片段 ── */
export function fmtSegs(bytes: number[], fmt: string): LogSeg[] {
  const h = hexOf(bytes);
  if (fmt === "hex") return [{ text: h }];
  const a = asciiOf(bytes);
  if (fmt === "ascii") return [{ text: a }];
  return [{ text: h }, { text: `\n    └ "${a}"`, color: "var(--txt3)" }];
}

function canLine(id?: number, ext?: boolean, rtr?: boolean, data: number[] = []): LogSeg[] {
  const idStr = "0x" + (id ?? 0).toString(16).toUpperCase().padStart(3, "0");
  return [
    { text: idStr, color: "var(--purple)", bold: true },
    { text: ext ? " [EXT]" : "" },
    { text: ` [${rtr ? 0 : data.length}] ` },
    { text: rtr ? "RTR (远程帧)" : hexOf(data) },
    ...(rtr ? [] : [{ text: `  "${asciiOf(data)}"`, color: "var(--txt3)" }]),
  ];
}

function routeFrame(f: FrameEvt) {
  const cid = CONSOLE_OF[f.channel];
  if (f.channel === "can") {
    pushLine(cid, "rx", "RX ◀", canLine(f.id, f.ext, f.rtr, f.data), { data: f.data, canId: f.id });
  } else if (f.channel === "mqtt") {
    pushLine(
      cid,
      "rx",
      "RX ◀",
      [
        { text: f.topic ?? "", color: "var(--purple)", bold: true },
        { text: "\n    " + utf8Decode(f.data) },
      ],
      { data: f.data }
    );
  } else if (f.channel === "net") {
    const fmt = consoleStores[cid].get().fmt;
    pushLine(
      cid,
      "rx",
      "RX ◀",
      [{ text: `[${f.peer ?? "peer"}] `, color: "var(--txt3)" }, ...fmtSegs(f.data, fmt)],
      { data: f.data }
    );
  } else {
    pushLine(cid, "rx", "RX ◀", fmtSegs(f.data, consoleStores[cid].get().fmt), { data: f.data });
  }
}

function onStatus(s: StatusEvt) {
  setOpen(s.channel, s.open);
  const cid = CONSOLE_OF[s.channel];
  pushLine(cid, s.open ? "sys" : "err", "SYS", [
    { text: s.message ?? (s.open ? "通道已打开" : "通道已关闭") },
  ]);
  toast(
    `${s.channel.toUpperCase()} ${s.open ? "已连接" : "已断开"}${s.message ? " · " + s.message : ""}`,
    s.open ? "ok" : "warn"
  );
}

/** TX 回显（真实与模拟共用） */
export function echoTx(id: ChannelId, bytes: number[], meta?: SendMeta) {
  const cid = CONSOLE_OF[id];
  if (!meta?.silent) {
    if (id === "can") {
      pushLine(cid, "tx", "TX ▶", canLine(meta?.canId, false, false, bytes), { data: bytes, canId: meta?.canId });
    } else if (id === "mqtt") {
      pushLine(
        cid,
        "tx",
        "TX ▶",
        [
          { text: meta?.topic ?? "", color: "var(--purple)", bold: true },
          { text: "\n    " + (meta?.text ?? hexOf(bytes)) },
        ],
        { data: bytes }
      );
    } else {
      const fmt = consoleStores[cid].get().fmt;
      pushLine(
        cid,
        "tx",
        "TX ▶",
        [
          ...fmtSegs(bytes, fmt),
          ...(meta?.note ? [{ text: " " + meta.note, color: "var(--purple)" }] : []),
        ],
        { data: bytes }
      );
    }
  }
  bumpTx(id, id === "can" ? 1 : bytes.length);
}

/* ── 通道操作 ── */
export async function openChannel(id: ChannelId, cfg: unknown): Promise<void> {
  if (mockActive()) {
    startMock(id, cfg);
    return;
  }
  await invoke("channel_open", { channel: id, cfg });
}

export async function closeChannel(id: ChannelId): Promise<void> {
  if (mockActive()) {
    stopMock(id);
    return;
  }
  await invoke("channel_close", { channel: id });
}

/** 发送：mqtt 走独立命令（topic+payload），其余通道发原始字节 */
export async function sendBytes(
  id: ChannelId,
  bytes: number[],
  meta?: SendMeta
): Promise<void> {
  if (mockActive()) {
    mockSend(id, bytes, meta);
    return;
  }
  try {
    if (id === "mqtt") {
      await invoke("mqtt_publish", {
        topic: meta?.topic ?? "",
        payload: meta?.text ? Array.from(new TextEncoder().encode(meta.text)) : bytes,
        qos: meta?.qos ?? 0,
      });
    } else if (id === "can") {
      await invoke("channel_send", { channel: id, data: bytes, id: meta?.canId, rtr: meta?.rtr ?? false });
    } else {
      await invoke("channel_send", { channel: id, data: bytes });
    }
    echoTx(id, bytes, meta);
  } catch (e) {
    bumpErr(id);
    throw new Error(String(e).replace(/^Error['"]?\s*/i, "").replace(/['"]$/, "") || "发送失败");
  }
}

export async function subscribeTopic(topic: string, qos: number): Promise<void> {
  if (mockActive()) return;
  await invoke("mqtt_subscribe", { topic, qos });
}

export interface PortInfo {
  name: string;
  desc: string | null;
}
export async function listSerialPorts(): Promise<PortInfo[]> {
  if (!inTauri) return mockPorts();
  try {
    return await invoke<PortInfo[]>("serial_list");
  } catch {
    return [];
  }
}
