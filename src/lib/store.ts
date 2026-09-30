import { useSyncExternalStore } from "react";

/** 极简外部 store：避免引入状态库，保持包体小 */
export interface Store<T extends object> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(l: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let s = initial;
  const subs = new Set<() => void>();
  return {
    get: () => s,
    set(patch) {
      const p = typeof patch === "function" ? patch(s) : patch;
      s = { ...s, ...p };
      subs.forEach((l) => l());
    },
    subscribe(l) {
      subs.add(l);
      return () => {
        subs.delete(l);
      };
    },
  };
}

export function useStore<T extends object>(st: Store<T>): T {
  return useSyncExternalStore(st.subscribe, st.get);
}

export type ChannelId = "serial" | "can" | "net" | "mqtt";
export type ConsoleId = "sp" | "can" | "net" | "mq";
export type PageId = "serial" | "can" | "net" | "mqtt" | "proto" | "settings";
export type LogDir = "rx" | "tx" | "sys" | "err";

export const CONSOLE_OF: Record<ChannelId, ConsoleId> = {
  serial: "sp",
  can: "can",
  net: "net",
  mqtt: "mq",
};
export const CHANNELS: ChannelId[] = ["serial", "can", "net", "mqtt"];
