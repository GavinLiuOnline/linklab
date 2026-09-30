import { useState } from "react";
import { Console } from "../components/Console";
import { Periodic } from "../components/Periodic";
import { useT } from "../lib/i18n";
import { Ic, P } from "../components/icons";
import { closeChannel, openChannel, sendBytes } from "../lib/bridge";
import { bumpErr, channelStore, setOpen, toast } from "../lib/state";
import { useStore } from "../lib/store";
import { parseHex } from "../lib/bytes";
import { loadCfg, saveCfg } from "../lib/cfg";
import { pushLine } from "../lib/consoles";

interface NetCfg {
  mode: "tcp" | "tcps" | "udp" | "udps";
  host: string;
  port: string;
  bind: string;
  maxConn: string;
  nodelay: boolean;
  keepalive: boolean;
  split: "gap" | "fixed" | "crlf" | "mbap";
  fixedLen: string;
}
const DEF: NetCfg = {
  mode: "tcp",
  host: "192.168.1.100",
  port: "502",
  bind: "0.0.0.0:9000",
  maxConn: "4",
  nodelay: true,
  keepalive: true,
  split: "gap",
  fixedLen: "64",
};

const SPLIT_LABEL: Record<NetCfg["split"], string> = {
  gap: "帧间隔超时",
  fixed: "固定长度",
  crlf: "结尾符 \\r\\n",
  mbap: "Modbus TCP (MBAP 长度)",
};

export function NetPage() {
  const t = useT();
  const ch = useStore(channelStore).net;
  const [cfg, setCfg] = useState<NetCfg>(() => loadCfg("net", DEF));
  const [fmt, setFmt] = useState<"HEX" | "ASCII">("HEX");
  const [text, setText] = useState("");

  const patch = (p: Partial<NetCfg>) => {
    setCfg((c) => {
      const n = { ...c, ...p };
      saveCfg("net", n);
      return n;
    });
  };

  const isSrv = cfg.mode === "tcps" || cfg.mode === "udps";
  const splitCfg =
    cfg.split === "fixed"
      ? { mode: "fixed", len: +cfg.fixedLen || 64 }
      : cfg.split === "gap"
        ? { mode: "gap", ms: 30 }
        : { mode: cfg.split };

  const toggle = async () => {
    if (ch.open) {
      try {
        await closeChannel("net");
      } finally {
        setOpen("net", false);
        pushLine("net", "sys", "SYS", [{ text: "通道已关闭" }]);
        toast("NET 已断开", "warn");
      }
      return;
    }
    try {
      await openChannel("net", {
        mode: cfg.mode,
        host: cfg.host,
        port: +cfg.port,
        bind: cfg.mode === "tcp" ? "0.0.0.0:0" : cfg.bind,
        max_conn: +cfg.maxConn,
        nodelay: cfg.nodelay,
        keepalive: cfg.keepalive,
        split: splitCfg,
      });
      setOpen("net", true);
      pushLine("net", "sys", "SYS", [
        {
          text: isSrv
            ? `服务端监听 ${cfg.bind}${cfg.mode === "tcps" ? ` · 最大连接 ${cfg.maxConn}` : ""}`
            : `${cfg.mode.toUpperCase()} → ${cfg.host}:${cfg.port}`,
        },
      ]);
      toast("NET 已连接");
    } catch (e) {
      toast(String(e) || "连接失败", "err");
    }
  };

  const send = async () => {
    const raw = text.trim();
    if (!raw) return toast("请输入发送内容", "warn");
    try {
      const bytes = fmt === "HEX" ? parseHex(raw) : Array.from(new TextEncoder().encode(raw));
      await sendBytes("net", bytes);
      toast(`已发送 ${bytes.length} B`);
    } catch (e) {
      bumpErr("net");
      toast("发送失败：" + e, "err");
    }
  };

  return (
    <section className="page">
      <div className="split">
        <div className="col left">
          <div className="card">
            <header>
              <Ic className="h-ico">{P.net}</Ic>连接配置
            </header>
            <div className="body">
              <div className="seg grid">
                {(
                  [
                    ["tcp", "net.tcp"],
                    ["tcps", "net.tcps"],
                    ["udp", "net.udpc"],
                    ["udps", "net.udps"],
                  ] as const
                ).map(([v, k]) => (
                  <button key={v} className={cfg.mode === v ? "on" : ""} onClick={() => patch({ mode: v })}>
                    {t(k as "net.tcp")}
                  </button>
                ))}
              </div>
              <div className="row">
                <div className="fld grow">
                  <label>{isSrv ? t("net.bind") : t("net.remote")}</label>
                  <input
                    type="text"
                    value={isSrv ? cfg.bind : cfg.host}
                    onChange={(e) => patch(isSrv ? { bind: e.target.value } : { host: e.target.value })}
                    spellCheck={false}
                  />
                </div>
                {!isSrv && (
                  <div className="fld" style={{ width: 110 }}>
                    <label>{t("net.port")}</label>
                    <input type="number" value={cfg.port} onChange={(e) => patch({ port: e.target.value })} />
                  </div>
                )}
              </div>
              {cfg.mode === "tcps" && (
                <div className="row">
                  <div className="fld">
                    <label>{t("net.maxConn")}</label>
                    <input type="number" value={cfg.maxConn} style={{ width: 80 }} onChange={(e) => patch({ maxConn: e.target.value })} />
                  </div>
                </div>
              )}
              <button className={`btn ${ch.open ? "danger" : "primary"}`} style={{ justifyContent: "center" }} onClick={toggle}>
                <Ic>{P.play}</Ic>
                <span>{ch.open ? "断开" : "连接"}</span>
              </button>
              <div className="stat">
                <span className="txv">
                  TX <b>{ch.tx}</b> B
                </span>
                <span className="rxv">
                  RX <b>{ch.rx}</b> B
                </span>
              </div>
            </div>
          </div>
          <div className="card" style={{ flex: 1 }}>
            <header>
              <Ic className="h-ico">{P.options}</Ic>选项
            </header>
            <div className="body">
              <label className="opt">
                <input type="checkbox" checked={cfg.nodelay} onChange={(e) => patch({ nodelay: e.target.checked })} />
                TCP_NODELAY（禁用 Nagle）
              </label>
              <label className="opt">
                <input type="checkbox" checked={cfg.keepalive} onChange={(e) => patch({ keepalive: e.target.checked })} />
                Keep-Alive
              </label>
              <div className="fld">
                <label>分包策略</label>
                <select value={cfg.split} onChange={(e) => patch({ split: e.target.value as NetCfg["split"] })}>
                  {(Object.keys(SPLIT_LABEL) as NetCfg["split"][]).map((k) => (
                    <option key={k} value={k}>
                      {SPLIT_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              {cfg.split === "fixed" && (
                <div className="fld">
                  <label>固定帧长 (B)</label>
                  <input type="number" value={cfg.fixedLen} style={{ width: 120 }} onChange={(e) => patch({ fixedLen: e.target.value })} />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col right">
          <Console id="net" title="SOCKET MONITOR" />
          <div className="sender">
            <div className="seg">
              {(["HEX", "ASCII"] as const).map((f) => (
                <button key={f} className={fmt === f ? "on" : ""} onClick={() => setFmt(f)}>
                  {f}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="00 01 00 00 00 06 01 03 00 00 00 02"
              spellCheck={false}
            />
            <button className="btn primary" onClick={send}>
              <Ic>{P.send}</Ic>
              {t("send.send")}
            </button>
            <Periodic channel="net" />
          </div>
        </div>
      </div>
    </section>
  );
}
