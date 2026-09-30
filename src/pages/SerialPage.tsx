import { useEffect, useRef, useState } from "react";
import { Console } from "../components/Console";
import { Ic, P } from "../components/icons";
import {
  closeChannel,
  listSerialPorts,
  openChannel,
  sendBytes,
  type PortInfo,
} from "../lib/bridge";
import { bumpErr, channelStore, setOpen, toast } from "../lib/state";
import { useStore } from "../lib/store";
import { appendCrc, type CrcMode } from "../lib/protocols";
import { parseHex, utf8Encode } from "../lib/bytes";
import { loadCfg, saveCfg } from "../lib/cfg";
import { pushLine } from "../lib/consoles";
import { Periodic } from "../components/Periodic";
import { useT, tr, type I18nKey } from "../lib/i18n";

/** 常用波特率预设（选择写入输入框，输入框可自由填写任意值） */
const BAUDS = ["1200", "2400", "4800", "9600", "14400", "19200", "38400", "57600", "115200", "230400", "460800", "500000", "576000", "921600", "1000000", "1500000", "2000000"];

interface SerialCfg {
  port: string;
  baud: string;
  parity: string;
  dataBits: string;
  stopBits: string;
  flow: string;
  showTs: boolean;
  raw: boolean;
  echo: boolean;
  crlf: boolean;
  gap: string;
  crc: CrcMode;
}

const DEF: SerialCfg = {
  port: "COM3",
  baud: "115200",
  parity: "None",
  dataBits: "8",
  stopBits: "1",
  flow: "None",
  showTs: true,
  raw: true,
  echo: true,
  crlf: false,
  gap: "30",
  crc: "none",
};

const CRC_LABEL: Record<CrcMode, I18nKey> = {
  none: "sp.crcNone",
  sum8: "sp.crcSum8",
  crc8: "sp.crcCrc8",
  crc16m: "sp.crc16m",
  crc16ccitt: "sp.crcCcitt",
};

/** 发送备注用的校验短标签（语言无关） */
const CRC_SHORT: Partial<Record<CrcMode, string>> = {
  sum8: "SUM-8",
  crc8: "CRC-8",
  crc16m: "CRC16-Modbus",
  crc16ccitt: "CRC16-CCITT",
};

const FLOW_MAP: Record<string, string> = { None: "none", "RTS/CTS": "rtscts", "XON/XOFF": "xonxoff" };
const PARITY_MAP: Record<string, string> = { None: "none", Even: "even", Odd: "odd" };

/** 波特率组合控件：输入框可自由输入，右侧内嵌箭头弹出预设列表（自绘，跨平台一致） */
function BaudField({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  title?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const show = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 120) });
    setOpen(true);
  };
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        placeholder="9600 - 2000000"
        title={title}
        style={{ width: "100%", paddingRight: 30 }}
      />
      <button
        className="btn ghost"
        style={{
          position: "absolute",
          right: 3,
          top: 3,
          bottom: 3,
          padding: "0 6px",
          minHeight: 0,
          borderRadius: 5,
        }}
        onClick={open ? () => setOpen(false) : show}
        title={title ?? t("sp.baudTitle")}
      >
        <Ic size={12}>{P.chevDown}</Ic>
      </button>
      {open && pos && (
        <>
          <div className="ctxmask" onClick={() => setOpen(false)} />
          <div className="baudpop" style={{ top: pos.top, left: pos.left, width: pos.width }}>
            {BAUDS.map((b) => (
              <button
                key={b}
                className={`ctx-item${b === value ? " on" : ""}`}
                onClick={() => {
                  onChange(b);
                  setOpen(false);
                }}
              >
                {b}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function SerialPage() {
  const t = useT();
  const ch = useStore(channelStore).serial;
  const [cfg, setCfg] = useState<SerialCfg>(() => loadCfg("serial", DEF));
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [fmt, setFmt] = useState<"HEX" | "ASCII">("HEX");
  const [text, setText] = useState("");

  const patch = (p: Partial<SerialCfg>) => {
    setCfg((c) => {
      const n = { ...c, ...p };
      saveCfg("serial", n);
      return n;
    });
  };

  const refreshPorts = async () => {
    setPorts(await listSerialPorts()); // 每次都更新，拔出设备也能反映
  };

  useEffect(() => {
    refreshPorts();
  }, []);

  const toggle = async () => {
    if (ch.open) {
      try {
        await closeChannel("serial");
      } finally {
        setOpen("serial", false);
        pushLine("sp", "sys", "SYS", [{ text: t("sys.closed") }]);
        toast(t("sp.disconnected"), "warn");
      }
      return;
    }
    await refreshPorts(); // 连接前再枚举一次，涵盖"刚插入 USB 立即连接"的场景
    const split = cfg.raw
      ? cfg.crlf
        ? { mode: "crlf" }
        : { mode: "gap", ms: +cfg.gap || 30 }
      : { mode: "raw" };
    try {
      await openChannel("serial", {
        port: cfg.port,
        baud: +cfg.baud,
        parity: PARITY_MAP[cfg.parity] ?? "none",
        data_bits: +cfg.dataBits,
        stop_bits: +cfg.stopBits,
        flow: FLOW_MAP[cfg.flow] ?? "none",
        split,
      });
      setOpen("serial", true);
      pushLine("sp", "sys", "SYS", [{ text: `${t("sys.opened")} · ${cfg.port} @ ${cfg.baud}` }]);
      toast(t("sp.connected"));
    } catch (e) {
      toast(String(e).replace(/^.*\((.*)\).*$/, "$1") || tr("打开串口失败"), "err");
    }
  };

  const send = async () => {
    const raw = text.trim();
    if (!raw) return toast(t("send.empty"), "warn");
    try {
      let bytes = fmt === "HEX" ? parseHex(raw) : utf8Encode(raw);
      const withCrc = fmt === "HEX" && cfg.crc !== "none";
      if (withCrc) bytes = appendCrc(bytes, cfg.crc);
      await sendBytes("serial", bytes, { note: withCrc ? "+" + CRC_SHORT[cfg.crc] : undefined, silent: !cfg.echo });
      toast(`${t("common.sentA")} ${bytes.length} B`);
    } catch (e) {
      bumpErr("serial");
      toast(tr("发送失败：") + e, "err");
    }
  };

  return (
    <section className="page">
      <div className="split">
        <div className="col left">
          <div className="card">
            <header>
              <Ic className="h-ico">
                {P.serial}
              </Ic>
              {t("sp.cfg")}
            </header>
            <div className="body">
              <div className="row">
                <div className="fld grow">
                  <label>{t("sp.port")}</label>
                  <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                    <select
                      value={cfg.port}
                      onChange={(e) => patch({ port: e.target.value })}
                      onFocus={refreshPorts}
                      style={{ flex: 1, minWidth: 0, width: "auto" }}
                    >
                      {!ports.some((p) => p.name === cfg.port) && (
                        <option value={cfg.port}>{cfg.port || t("sp.noDevice")}{t("sp.offTag")}</option>
                      )}
                      {ports.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.desc ? `${p.name} — ${p.desc}` : p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn ghost"
                      style={{ padding: "6px 7px" }}
                      onClick={refreshPorts}
                      title={t("sp.refresh")}
                    >
                      <Ic size={13}>{P.reload}</Ic>
                    </button>
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="fld grow">
                  <label>{t("sp.baud")}</label>
                  <BaudField value={cfg.baud} onChange={(v) => patch({ baud: v })} title={t("sp.baud")} />
                </div>
                <div className="fld">
                  <label>{t("sp.parity")}</label>
                  <select value={cfg.parity} onChange={(e) => patch({ parity: e.target.value })}>
                    {["None", "Even", "Odd"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="row">
                <div className="fld">
                  <label>{t("sp.data")}</label>
                  <select value={cfg.dataBits} onChange={(e) => patch({ dataBits: e.target.value })}>
                    {["7", "8"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fld">
                  <label>{t("sp.stop")}</label>
                  <select value={cfg.stopBits} onChange={(e) => patch({ stopBits: e.target.value })}>
                    {["1", "2"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fld">
                  <label>{t("sp.flow")}</label>
                  <select value={cfg.flow} onChange={(e) => patch({ flow: e.target.value })}>
                    {["None", "RTS/CTS", "XON/XOFF"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button className={`btn ${ch.open ? "danger" : "primary"}`} style={{ justifyContent: "center" }} onClick={toggle}>
                <Ic>{P.play}</Ic>
                <span>{ch.open ? t("sp.close") : t("sp.open")}</span>
              </button>
              <div className="stat">
                <span className="txv">
                  TX <b>{ch.tx}</b> B
                </span>
                <span className="rxv">
                  RX <b>{ch.rx}</b> B
                </span>
                <span>
                  ERR <b>{ch.err}</b>
                </span>
              </div>
            </div>
          </div>
          <div className="card" style={{ flex: 1 }}>
            <header>
              <Ic className="h-ico">{P.options}</Ic>
              {t("sp.rxopt")}
            </header>
            <div className="body">
              <label className="opt">
                <input type="checkbox" checked={cfg.showTs} onChange={(e) => patch({ showTs: e.target.checked })} />
                {t("sp.showTs")}
              </label>
              <label className="opt">
                <input type="checkbox" checked={!cfg.raw} onChange={(e) => patch({ raw: !e.target.checked })} />
                {t("sp.raw")}
              </label>
              <label className="opt">
                <input type="checkbox" checked={cfg.echo} onChange={(e) => patch({ echo: e.target.checked })} />
                {t("sp.echo")}
              </label>
              <label className="opt">
                <input type="checkbox" checked={cfg.crlf} onChange={(e) => patch({ crlf: e.target.checked })} />
                {t("sp.crlf")}
              </label>
              <div className="fld">
                <label>{t("sp.gap")}</label>
                <input type="number" value={cfg.gap} min={1} max={500} style={{ width: "100%" }} onChange={(e) => patch({ gap: e.target.value })} />
              </div>
              <div className="tag-note">
                {t("sp.noteA")}
                <b>{t("sp.noteGap")}</b>
                {t("sp.noteOr")}
                <b>\r\n</b>
                {t("sp.noteB")}
              </div>
            </div>
          </div>
        </div>
        <div className="col right">
          <Console id="sp" title="DATA MONITOR" showTs={cfg.showTs} />
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
              placeholder={fmt === "HEX" ? "HEX: 01 03 00 00 00 02 C4 0B" : t("sp.textPh")}
              spellCheck={false}
            />
            <select
              value={cfg.crc}
              onChange={(e) => patch({ crc: e.target.value as CrcMode })}
              style={{ flex: "0 0 158px" }}
              title={t("sp.crc")}
            >
              {(Object.keys(CRC_LABEL) as CrcMode[]).map((m) => (
                <option key={m} value={m}>
                  {t(CRC_LABEL[m])}
                </option>
              ))}
            </select>
            <button className="btn primary" onClick={send}>
              <Ic>{P.send}</Ic>
              {t("send.send")}
            </button>
            <Periodic channel="serial" />
          </div>
        </div>
      </div>
    </section>
  );
}
