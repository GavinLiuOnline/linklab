import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Console } from "../components/Console";
import { Periodic } from "../components/Periodic";
import { useT, tr } from "../lib/i18n";
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
        pushLine("can", "sys", "SYS", [{ text: t("sys.closed") }]);
        toast(t("can.disconnected"), "warn");
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
        { text: `${t("sys.opened")} · ${cfg.iface} @ ${cfg.br}${filterIds.length ? ` · ${t("can.hwF")}${cfg.filter}` : ""}` },
      ]);
      toast(t("can.connected"));
    } catch (e) {
      toast(String(e) || tr("打开 CAN 失败"), "err");
    }
  };

  const send = async () => {
    const canId = parseInt(id, 16);
    if (isNaN(canId)) return toast(tr("CAN ID 必须为 HEX"), "err");
    const data = payload
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((x) => parseInt(x, 16));
    if (data.some(isNaN)) return toast(tr("负载必须为 HEX 字节序列"), "err");
    if (data.length === 0) return toast(tr("请输入负载数据"), "warn");
    if (data.length > 8) return toast(tr("CAN 经典帧负载最多 8 字节"), "warn");
    try {
      await sendBytes("can", data, { canId, rtr });
    } catch (e) {
      bumpErr("can");
      toast(tr("发送失败：") + e, "err");
    }
  };

  return (
    <section className="page">
      <div className="split">
        <div className="col left">
          <div className="card">
            <header>
              <Ic className="h-ico">{P.can}</Ic>
              {t("can.cfg")}
            </header>
            <div className="body">
              <div className="fld">
                <label>{t("can.iface")}</label>
                <select value={cfg.iface} onChange={(e) => patch({ iface: e.target.value })}>
                  {ifaces.length === 0 && <option value={cfg.iface}>{t("can.none")}</option>}
                  {ifaces.map((v) => (
                    <option key={v} value={v}>
                      {v} — socketCAN
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <div className="fld grow">
                  <label>{t("sp.baud")}</label>
                  <select value={cfg.br} onChange={(e) => patch({ br: e.target.value })}>
                    {["125k", "250k", "500k", "1M", "2M (FD)"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fld grow">
                  <label>{t("can.frameType")}</label>
                  <select value={cfg.type} onChange={(e) => patch({ type: e.target.value as CanCfg["type"] })}>
                    <option value="std">{t("can.std")}</option>
                    <option value="ext">{t("can.ext")}</option>
                  </select>
                </div>
              </div>
              <button className={`btn ${ch.open ? "danger" : "primary"}`} style={{ justifyContent: "center" }} onClick={toggle}>
                <Ic>{P.play}</Ic>
                <span>{ch.open ? t("can.stop") : t("can.start")}</span>
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
                {t("can.brNoteA")}
                <b>ip link set can0 type can bitrate 500000</b>
                {t("can.brNoteB")}
              </div>
            </div>
          </div>
          <div className="card">
            <header>
              <Ic className="h-ico">{P.filter}</Ic>
              {t("can.hwFilterH")}
            </header>
            <div className="body">
              <div className="fld">
                <label>{t("can.filterLbl")}</label>
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
                {t("can.showRtr")}
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
