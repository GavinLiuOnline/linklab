/** 发送队列任务管理与周期发射（100ms tick 由 App 驱动） */
import { persistQueue, queueStore, type QTask } from "./state";
import { parseHex } from "./bytes";
import { sendBytes } from "./bridge";

export function addTask(t: Omit<QTask, "id" | "left" | "firedAt" | "on">) {
  queueStore.set({ tasks: [...queueStore.get().tasks, { ...t, id: Date.now(), on: true, left: 0, firedAt: 0 }] });
  persistQueue();
}
export function updateTask(id: number, patch: Partial<QTask>) {
  queueStore.set({ tasks: queueStore.get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  persistQueue();
}
export function removeTask(id: number) {
  queueStore.set({ tasks: queueStore.get().tasks.filter((t) => t.id !== id) });
  persistQueue();
}
export function stopAll() {
  queueStore.set({ tasks: queueStore.get().tasks.map((t) => ({ ...t, on: false, left: 0 })) });
  persistQueue();
}

export function queueTick() {
  const { tasks } = queueStore.get();
  const next = tasks.map((t) => {
    if (!t.on) return t.left ? { ...t, left: 0 } : t;
    const left = t.left + 100;
    if (left >= t.periodMs) {
      fire(t);
      return { ...t, left: 0, firedAt: Date.now() };
    }
    return { ...t, left };
  });
  queueStore.set({ tasks: next });
}

async function fire(t: QTask) {
  try {
    if (t.channel === "mqtt") {
      await sendBytes("mqtt", [], { topic: t.topic, text: t.payload });
    } else if (t.channel === "can") {
      await sendBytes("can", parseHex(t.payload), { canId: parseInt(t.canId ?? "0", 16) });
    } else {
      await sendBytes(t.channel, parseHex(t.payload));
    }
  } catch {
    /* bridge 已计数并提示 */
  }
}
