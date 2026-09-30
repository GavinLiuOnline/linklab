/**
 * 控制台管线：环形缓冲、暂停丢弃、格式切换（与 DESIGN.md §6 一致）
 * 每个控制台独立 store，避免全页重渲染。
 */
import { useStore, type ConsoleId, type LogDir, type Store, createStore } from "./store";

export interface LogSeg {
  text: string;
  color?: string;
  bold?: boolean;
}
export interface LogLine {
  id: number;
  t: string;
  dir: LogDir;
  label: string;
  segs: LogSeg[];
  /** 原始帧字节（RX/TX 行携带，供右键协议解析） */
  raw?: number[];
  /** CAN 帧 ID（canopen 解析用） */
  canId?: number;
}

export type ConsoleFmt = "hex" | "ascii" | "both";

interface ConsoleState {
  lines: LogLine[];
  frames: number;
  paused: boolean;
  fmt: ConsoleFmt;
}

const mk = (): Store<ConsoleState> =>
  createStore<ConsoleState>({ lines: [], frames: 0, paused: false, fmt: "hex" });

export const consoleStores: Record<ConsoleId, Store<ConsoleState>> = {
  sp: mk(),
  can: mk(),
  net: mk(),
  mq: mk(),
};

export function useConsole(id: ConsoleId) {
  return useStore(consoleStores[id]);
}

/* ── 时间戳 ── */
export type TsMode = "clock" | "mono" | "abs";
let tsMode: TsMode = "clock";
const t0 = Date.now();
export function setTsMode(m: TsMode) {
  tsMode = m;
}
export function tsText(): string {
  const d = new Date();
  if (tsMode === "mono") return "+" + ((Date.now() - t0) / 1000).toFixed(3) + "s";
  if (tsMode === "abs") return d.toLocaleString("zh-CN", { hour12: false });
  return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

/* ── 环形上限 ── */
let maxLines = 800;
export function setMaxLines(n: number) {
  maxLines = Math.max(100, n);
}

let lineId = 0;

/* ── 批量缓冲：高频数据合并渲染，避免每帧全树重渲染导致卡死 ── */
const pending: Partial<Record<ConsoleId, LogLine[]>> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 100;
/** 单批行数超过此值视为数据洪水：自动暂停该控制台，防止 DOM 雪崩 */
const FLOOD_BATCH = 800;

async function flushAll() {
  flushTimer = null;
  for (const key of Object.keys(pending) as ConsoleId[]) {
    const batch = pending[key]!;
    delete pending[key];
    const st = consoleStores[key];
    const s = st.get();
    if (s.paused) continue; // 暂停时整批丢弃
    if (batch.length > FLOOD_BATCH) {
      // 数据洪水保护：保留最新一部分并自动暂停，等用户手动恢复
      const { toast } = await import("./state");
      st.set({ paused: true, lines: batch.slice(-200), frames: s.frames + batch.length });
      toast("数据速率过高，已自动暂停接收", "warn");
      continue;
    }
    let lines = [...s.lines, ...batch];
    if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);
    st.set({ lines, frames: s.frames + batch.length });
  }
}

export function pushLine(
  id: ConsoleId,
  dir: LogDir,
  label: string,
  segs: LogSeg[],
  raw?: { data?: number[]; canId?: number }
) {
  const s = consoleStores[id].get();
  if (s.paused) return; // 暂停时静默丢弃
  const line: LogLine = { id: ++lineId, t: tsText(), dir, label, segs, raw: raw?.data, canId: raw?.canId };
  (pending[id] ??= []).push(line);
  if (!flushTimer) flushTimer = setTimeout(flushAll, FLUSH_MS);
}

export function clearConsole(id: ConsoleId) {
  delete pending[id]; // 丢弃未刷出的缓冲，避免清空后旧批复活
  consoleStores[id].set({ lines: [] });
}
export function setFmt(id: ConsoleId, fmt: ConsoleFmt) {
  consoleStores[id].set({ fmt });
}
export function togglePause(id: ConsoleId) {
  const st = consoleStores[id];
  st.set({ paused: !st.get().paused });
}
