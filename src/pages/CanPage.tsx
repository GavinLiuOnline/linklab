import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Console } from "../components/Console";
import { Periodic } from "../components/Periodic";
import { useT } from "../lib/i18n";
import { Ic, P } from "../components/icons";
import { closeChannel, inTauri, openChannel, sendBytes } from "../lib/bridge";
import { bumpErr, channelStore, setOpen, toast } from "../lib/state";
import { useStore } from "../lib/store";
import { loadCfg, saveCfg } from "../lib/cfg";
import { pushLine } from "../lib/consoles";

interface CanCfg {
  iface: string;
  br: string;
  type: "std" | "ext";
  filter: string;
  showRtr: boolean;
}
const DEF: CanCfg = { iface: "can0", br: "500k", type: "std", filter: "", showRtr: true };

export function CanPage() {
  const t = useT();
  const ch = useStore(channelStore).can;
  const [cfg, setCfg] = useState<CanCfg>(() => loadCfg("can", DEF));
  const [id, setId] = useState("203");
  const [payload, setPayload] = useState("01 F4");
  const [rtr, setRtr] = useState(false);
  // 系统实际存在的 socketCAN 接口（null = 检测中；模拟模式用虚拟列表）
  const [ifaces, setIfaces] = useState<string[]>(["can0", "can1", "vcan0"]);

  useEffect(() => {
    (async () => {
      if (!inTauri) return;
      try {
        const list = await invoke<string[]>("can_list");
        setIfaces(list);
      } catch {
        setIfaces([]);
      }
    })();
  }, []);

  const patch = (p: Partial<CanCfg>) => {
    setCfg((c) => {
      const n = { ...c, ...p };
      saveCfg("can", n);
      return n;
    });
  };

  const toggle = async () => {
    if (ch.open) {
      try {
        await closeChannel("can");
      } finally {
        setOpen("can", false);
        pushLine("can", "sys", "SYS", [{ text: "通道已关闭" }]);
        toast("CAN 已断开", "warn");
      }
      return;
    }
    const filterIds = cfg.filter
      .split(/[,\s]+/)
      .map((s) => parseInt(s, 16))
      .filter((n) => !isNaN(n));
    try {
      await openChannel("can", {
        interface: cfg.iface,
        filter_ids: filterIds,
        ext: cfg.type === "ext",
      });
      setOpen("can", true);
      pushLine("can", "sys", "SYS", [
        { text: `通道已打开 · ${cfg.iface} @ ${cfg.br}${filterIds.length ? ` · 硬件过滤 ${cfg.filter}` : ""}` },
      ]);
      toast("CAN 已连接");
    } catch (e) {
      toast(String(e) || "打开 CAN 失败", "err");
    }
  };

  const send = async () => {
    const canId = parseInt(id, 16);
    if (isNaN(canId)) return toast("CAN ID 必须为 HEX", "err");
    const data = payload
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((x) => parseInt(x, 16));
    if (data.some(isNaN)) return toast("负载必须为 HEX 字节序列", "err");
    if (data.length === 0) return toast("请输入负载数据", "warn");
    if (data.length > 8) return toast("CAN 经典帧负载最多 8 字节", "warn");
    try {
      await sendBytes("can", data, { canId, rtr });
    } catch (e) {
      bumpErr("can");
      toast("发送失败：" + e, "err");
    }
  };

  return (
    <section className="page">
      <div className="split">
        <div className="col left">
          <div className="card">
            <header>
              <Ic className="h-ico">{P.can}</Ic>通道配置
            </header>
            <div className="body">
              <div className="fld">
                <label>接口</label>
                <select value={cfg.iface} onChange={(e) => patch({ iface: e.target.value })}>
                  {ifaces.length === 0 && <option value={cfg.iface}>未检测到 CAN 接口</option>}
                  {ifaces.map((v) => (
                    <option key={v} value={v}>
                      {v} — socketCAN
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <div className="fld grow">
                  <label>波特率</label>
                  <select value={cfg.br} onChange={(e) => patch({ br: e.target.value })}>
                    {["125k", "250k", "500k", "1M", "2M (FD)"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fld grow">
                  <label>帧类型</label>
                  <select value={cfg.type} onChange={(e) => patch({ type: e.target.value as CanCfg["type"] })}>
                    <option value="std">标准帧 (11bit)</option>
                    <option value="ext">扩展帧 (29bit)</option>
                  </select>
                </div>
              </div>
              <button className={`btn ${ch.open ? "danger" : "primary"}`} style={{ justifyContent: "center" }} onClick={toggle}>
                <Ic>{P.play}</Ic>
                <span>{ch.open ? "停止通道" : "启动通道"}</span>
              </button>
              <div className="stat">
                <span className="txv">
                  TX <b>{ch.tx}</b>
                </span>
                <span className="rxv">
                  RX <b>{ch.rx}</b>
                </span>
                <span>
                  ERR <b>{ch.err}</b>
                </span>
              </div>
              <div className="tag-note">
                socketCAN 的波特率由系统配置（<b>ip link set can0 type can bitrate 500000</b>），本工具不做修改。
              </div>
            </div>
          </div>
          <div className="card">
            <header>
              <Ic className="h-ico">{P.filter}</Ic>硬件过滤器
            </header>
            <div className="body">
              <div className="fld">
                <label>只收 ID (HEX, 逗号分隔)</label>
                <input
                  type="text"
                  value={cfg.filter}
                  onChange={(e) => patch({ filter: e.target.value })}
                  placeholder="181, 183, 203"
                  spellCheck={false}
                />
              </div>
              <label className="opt">
                <input type="checkbox" checked={cfg.showRtr} onChange={(e) => patch({ showRtr: e.target.checked })} />
                显示 RTR 帧
              </label>
            </div>
          </div>
        </div>
        <div className="col right">
          <Console id="can" title="CAN BUS MONITOR" />
          <div className="sender">
            <span className="tag">ID</span>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="203"
              spellCheck={false}
              style={{ flex: "0 0 96px" }}
            />
            <label className="opt">
              <input type="checkbox" checked={rtr} onChange={(e) => setRtr(e.target.checked)} />
              RTR
            </label>
            <span className="tag">DATA</span>
            <input
              type="text"
              value={payload}
              onChange={(e) => setPayload(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="01 F4 00 00 00 00 00 00"
              spellCheck={false}
              style={{ flex: 1, minWidth: 0, width: "auto" }}
            />
            <button className="btn primary" onClick={send}>
              <Ic>{P.send}</Ic>
              {t("send.frame")}
            </button>
            <Periodic channel="can" />
          </div>
        </div>
      </div>
    </section>
  );
}
