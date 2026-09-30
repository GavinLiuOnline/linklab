/**
 * 全局应用状态：通道统计 / UI（页面、Toast、设置）/ 协议工厂 / 发送队列
 * 设置与队列任务持久化于 localStorage。
 */
import { createStore, type ChannelId, type PageId } from "./store";

/* ── 通道状态 ── */
export interface ChState {
  open: boolean;
  tx: number;
  rx: number;
  err: number;
}
export type ChannelsState = Record<ChannelId, ChState>;

export const channelStore = createStore<ChannelsState>({
  serial: { open: false, tx: 0, rx: 0, err: 0 },
  can: { open: false, tx: 0, rx: 0, err: 0 },
  net: { open: false, tx: 0, rx: 0, err: 0 },
  mqtt: { open: false, tx: 0, rx: 0, err: 0 },
});

export function setOpen(id: ChannelId, open: boolean) {
  const p: Partial<ChannelsState> = {};
  p[id] = { ...channelStore.get()[id], open };
  channelStore.set(p);
}
export function bumpTx(id: ChannelId, n: number) {
  const p: Partial<ChannelsState> = {};
  const s = channelStore.get()[id];
  p[id] = { ...s, tx: s.tx + n };
  channelStore.set(p);
}
export function bumpRx(id: ChannelId, n: number) {
  const p: Partial<ChannelsState> = {};
  const s = channelStore.get()[id];
  p[id] = { ...s, rx: s.rx + n };
  channelStore.set(p);
}
/** 批量聚合 RX 字节（一次 set 更新多通道，高频帧时不逐帧触发重渲染） */
export function bumpRxBatch(map: Partial<Record<ChannelId, number>>) {
  const p: Partial<ChannelsState> = {};
  const cur = channelStore.get();
  for (const id of Object.keys(map) as ChannelId[]) {
    const n = map[id] ?? 0;
    if (!n) continue;
    p[id] = { ...cur[id], rx: cur[id].rx + n };
  }
  if (Object.keys(p).length) channelStore.set(p);
}
export function bumpErr(id: ChannelId) {
  const p: Partial<ChannelsState> = {};
  const s = channelStore.get()[id];
  p[id] = { ...s, err: s.err + 1 };
  channelStore.set(p);
}

/* ── UI / 设置 ── */
export interface Settings {
  accent: string;
  theme: "dark" | "light";
  lang: "zh" | "en";
  maxLines: number;
  tsFormat: "clock" | "mono" | "abs";
  autoLog: boolean;
  consoleAnim: boolean;
  forceMock: boolean;
}
export interface Toast {
  id: number;
  msg: string;
  type: "ok" | "warn" | "err";
}

const DEFAULTS: Settings = {
  accent: "#ffb454",
  theme: "dark",
  lang: "zh",
  maxLines: 500,
  tsFormat: "clock",
  autoLog: true,
  consoleAnim: true,
  forceMock: false,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("linklab.settings");
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export const uiStore = createStore<{
  page: PageId;
  settings: Settings;
  toasts: Toast[];
}>({ page: "serial", settings: loadSettings(), toasts: [] });

export function saveSettings(patch: Partial<Settings>) {
  const settings = { ...uiStore.get().settings, ...patch };
  uiStore.set({ settings });
  try {
    localStorage.setItem("linklab.settings", JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

let toastId = 0;
export function toast(msg: string, type: Toast["type"] = "ok") {
  const t: Toast = { id: ++toastId, msg, type };
  uiStore.set({ toasts: [...uiStore.get().toasts, t] });
  setTimeout(() => {
    uiStore.set({ toasts: uiStore.get().toasts.filter((x) => x.id !== t.id) });
  }, 2400);
}

/* ── 协议工厂 ── */
export type TmplId = "modbus" | "mbascii" | "slip" | "dlt645" | "nmea" | "custom" | "canopen";
export const protoStore = createStore<{
  tmpl: TmplId;
  frame: number[] | null;
  parse: { rows: [string, string][]; crcOK: boolean } | null;
}>({ tmpl: "modbus", frame: null, parse: null });

/* ── 发送队列 ── */
export interface QTask {
  id: number;
  name: string;
  /** HEX 负载（mqtt 为文本负载） */
  payload: string;
  channel: ChannelId;
  /** CAN 通道的帧 ID（HEX 文本） */
  canId?: string;
  /** MQTT 主题 */
  topic?: string;
  periodMs: number;
  on: boolean;
  /** 内部：倒计时 ms / 最近发射时间 */
  left: number;
  firedAt: number;
}

const QUEUE_KEY = "linklab.queue";
function loadQueue(): QTask[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) return JSON.parse(raw).map((t: QTask) => ({ ...t, left: 0, firedAt: 0 }));
  } catch {
    /* ignore */
  }
  return [
    {
      id: 1,
      name: "读保持寄存器",
      payload: "01 03 00 00 00 02 C4 0B",
      channel: "serial",
      periodMs: 500,
      on: true,
      left: 0,
      firedAt: 0,
    },
    {
      id: 2,
      name: "CAN 心跳",
      payload: "01 F4 00 00",
      canId: "181",
      channel: "can",
      periodMs: 1000,
      on: false,
      left: 0,
      firedAt: 0,
    },
    {
      id: 3,
      name: "MQTT 状态上报",
      payload: '{"temp":26.4,"rpm":1480}',
      topic: "factory/line1/dev01/status",
      channel: "mqtt",
      periodMs: 2000,
      on: false,
      left: 0,
      firedAt: 0,
    },
  ];
}

export const queueStore = createStore<{ tasks: QTask[] }>({ tasks: loadQueue() });
export function persistQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queueStore.get().tasks));
  } catch {
    /* ignore */
  }
}
