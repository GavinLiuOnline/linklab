import { useState, type ReactNode } from "react";
import { Ic, P } from "../components/icons";
import { protoStore, toast, type TmplId } from "../lib/state";
import {
  modbusBuild,
  modbusParse,
  modbusAsciiBuild,
  modbusAsciiParse,
  slipEncode,
  customFrameBuild,
  dlt645Build,
  dlt645Parse,
  nmeaBuild,
  nmeaParse,
  canopenParse,
  sdoBuild,
  chkFail,
} from "../lib/protocols";
import { hexOf, parseHex } from "../lib/bytes";
import { sendBytes } from "../lib/bridge";
import { addTask } from "../lib/queue";
import { useStore } from "../lib/store";
import { useT, tr, type I18nKey } from "../lib/i18n";

const TMPLS: { id: TmplId; icon: ReactNode; nm: string; ds: I18nKey }[] = [
  { id: "modbus", icon: P.box, nm: "Modbus RTU", ds: "pr.dsModbus" },
  { id: "mbascii", icon: P.box, nm: "Modbus ASCII", ds: "pr.dsMbAscii" },
  { id: "dlt645", icon: P.bolt, nm: "DL/T 645-2007", ds: "pr.ds645" },
  { id: "nmea", icon: P.net, nm: "NMEA 0183", ds: "pr.dsNmea" },
  { id: "slip", icon: P.slip, nm: "SLIP 转义帧", ds: "pr.dsSlip" },
  { id: "custom", icon: P.layers, nm: "自定义帧头帧", ds: "pr.dsCustom" },
  { id: "canopen", icon: P.bolt, nm: "CANopen SDO/PDO", ds: "pr.dsCanopen" },
];

const FN_CODES: [string, I18nKey][] = [
  ["01", "pr.fn1"],
  ["02", "pr.fn2"],
  ["03", "pr.fn3"],
  ["04", "pr.fn4"],
  ["05", "pr.fn5"],
  ["06", "pr.fn6"],
  ["10", "pr.fn7"],
];

function byteCap(tmpl: TmplId, i: number, len: number): [string, string] {
  if (tmpl === "modbus" || tmpl === "mbascii") {
    if (i === 0) return ["addr", tmpl === "mbascii" ? ":" : "ADDR"];
    if (tmpl === "modbus" && i === 1) return ["fn", "FUNC"];
    if (tmpl === "modbus" && i >= len - 2) return ["crc", i === len - 2 ? "CRC-LO" : "CRC-HI"];
    if (tmpl === "mbascii" && i >= len - 4) return ["crc", i === len - 4 ? "LRC-HI" : i === len - 3 ? "LRC-LO" : "CRLF"];
  } else if (tmpl === "slip") {
    if (i === 0) return ["crc", tr("C0 首标")];
    if (i === len - 1) return ["crc", tr("C0 尾标")];
  } else if (tmpl === "dlt645") {
    if (i === 0) return ["addr", "HEAD 68"];
    if (i === 7) return ["addr", "HEAD 68"];
    if (i <= 6) return ["addr", i <= 6 ? `A${6 - i}` : ""];
    if (i === 8) return ["fn", "CTRL"];
    if (i === 9) return ["fn", "LEN"];
    if (i === len - 2) return ["crc", "CS"];
    if (i === len - 1) return ["addr", "END 16"];
  } else if (tmpl === "custom") {
    if (i < 2) return ["addr", tr("帧头")];
    if (i === 2) return ["fn", "LEN"];
    if (i === 3) return ["fn", "CMD"];
    if (i === len - 1) return ["crc", "SUM"];
  } else if (tmpl === "canopen") {
    if (i === 0) return ["fn", tr("CC 命令")];
    if (i === 1) return ["addr", "IDX-LO"];
    if (i === 2) return ["addr", "IDX-HI"];
    if (i === 3) return ["fn", "SUB"];
    if (i >= len - 1) return ["crc", `D${len - 1 - i}`];
  }
  return ["", ""];
}

export function ProtoPage() {
  const t = useT();
  const { tmpl, frame, parse } = useStore(protoStore);
  const [addr, setAddr] = useState("01");
  const [fn, setFn] = useState("03");
  const [reg, setReg] = useState("0000");
  const [qty, setQty] = useState("0002");
  const [meterAddr, setMeterAddr] = useState("000000000001");
  const [ctrl, setCtrl] = useState("11");
  const [di, setDi] = useState("00010000");
  const [sentence, setSentence] = useState("GNGLL");
  const [fields, setFields] = useState("3751.9022,N,12130.1234,E,0,00,A");
  const [cmd, setCmd] = useState("81");
  const [parseIn, setParseIn] = useState("");
  // CANopen（作为协议模板：SDO 生成参数）
  const [coNode, setCoNode] = useState("1");
  const [coRead, setCoRead] = useState(true);
  const [coIdx, setCoIdx] = useState("1000");
  const [coSub, setCoSub] = useState("00");
  const [coVal, setCoVal] = useState("0000");
  const [coCob, setCoCob] = useState<number | null>(null);

  const build = () => {
    try {
      let bytes: number[];
      switch (tmpl) {
        case "modbus":
          bytes = modbusBuild(addr, fn, reg, qty);
          break;
        case "mbascii":
          bytes = modbusAsciiBuild(addr, fn, reg, qty);
          break;
        case "dlt645":
          bytes = dlt645Build(meterAddr, ctrl, di);
          break;
        case "nmea":
          bytes = nmeaBuild(sentence, fields);
          break;
        case "slip":
          bytes = slipEncode(modbusBuild(addr, fn, reg, qty));
          break;
        case "canopen": {
          const node = +coNode;
          const index = parseInt(coIdx.replace(/^0x/i, ""), 16);
          const sub = parseInt(coSub.replace(/^0x/i, ""), 16);
          if (isNaN(index) || isNaN(sub)) return toast(tr("Index / Sub 需为 HEX"), "err");
          const val = coRead ? undefined : parseHex(coVal).reverse();
          const built = sdoBuild(node, coRead, index, sub, val);
          setCoCob(built.cobId);
          bytes = built.data;
          break;
        }
        default:
          bytes = customFrameBuild([parseInt(reg, 16) & 0xff, parseInt(qty, 16) & 0xff], parseInt(cmd, 16));
      }
      protoStore.set({ frame: bytes, parse: null });
      toast(`${t("pr.genA")} ${bytes.length} ${t("pr.bytesU")}`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const copy = () => {
    if (!frame) return toast(t("pr.gen") + "?", "warn");
    navigator.clipboard?.writeText(hexOf(frame));
    toast("OK: " + hexOf(frame));
  };

  const sendToChannel = async () => {
    if (!frame) return toast(t("pr.gen") + "?", "warn");
    try {
      if (tmpl === "canopen") {
        if (coCob == null) return toast(tr("请先生成 SDO 帧"), "warn");
        await sendBytes("can", frame, { canId: coCob, note: "SDO" });
        toast(t("pr.sdoSentA") + "0x" + coCob.toString(16).toUpperCase());
      } else {
        await sendBytes("serial", frame);
        toast(t("pr.sendCh"));
      }
    } catch (e) {
      toast(String(e), "err");
    }
  };

  const toQueue = () => {
    if (!frame) return toast(t("pr.gen") + "?", "warn");
    addTask({ name: "TX", payload: hexOf(frame), channel: "serial", periodMs: 500 });
    toast(t("pr.toQueue"));
  };

  const doParse = () => {
    // CANopen 解析：支持 cansend 风格 "COB-ID#DATA"；无 # 时按 SDO 命令字节自动判别方向
    if (tmpl === "canopen") {
      try {
        const s = parseIn.trim().replace(/^0x/i, "");
        const sep = s.indexOf("#");
        const node = Math.max(1, Math.min(127, +coNode || 1));
        let cob: number;
        let d: number[];
        if (sep >= 0) {
          cob = parseInt(s.slice(0, sep), 16);
          d = parseHex(s.slice(sep + 1));
        } else {
          d = parseHex(s);
          const cc = d[0] ?? 0;
          // 应答类命令说明符：0x60(写确认) 0x41/0x43/0x47/0x4B/0x4F(读应答)
          // 0x20/0x30(段读应答,e=0) 0x00-0x1F(段数据)；0x40 与 0x2x(e=1) 是请求
          const isResp =
            cc === 0x60 ||
            cc === 0x41 ||
            cc === 0x43 ||
            cc === 0x47 ||
            cc === 0x4b ||
            cc === 0x4f ||
            ((cc & 0xe0) === 0x20 && !(cc & 0x02)) ||
            ((cc & 0xe0) === 0x00 && cc !== 0);
          cob = (isResp ? 0x580 : 0x600) + node;
        }
        if (isNaN(cob) || cob < 0 || cob > 0x7ff)
          return toast(t("pr.cobFmt"), "err");
        const p = canopenParse(cob, d);
        protoStore.set({
          parse: {
            rows: [
              [tr("类型"), p.kind + " · " + p.label],
              [tr("节点 ID"), p.node],
              ["COB-ID", "0x" + cob.toString(16).padStart(3, "0").toUpperCase() + (sep < 0 ? tr("（按命令字节自动判别方向）") : "")],
              [tr("字段"), p.detail],
            ] as [string, string][],
            crcOK: true,
          },
        });
      } catch (e) {
        toast(tr("解析失败：") + (e as Error).message, "err");
      }
      return;
    }
    let bytes: number[];
    try {
      bytes = parseHex(parseIn);
    } catch (e) {
      return toast((e as Error).message, "err");
    }
    if (!bytes.length) return toast(tr("请粘贴 HEX 报文"), "warn");
    try {
      let r;
      switch (tmpl) {
        case "mbascii":
          r = modbusAsciiParse(bytes);
          break;
        case "dlt645":
          r = dlt645Parse(bytes);
          break;
        case "nmea":
          r = nmeaParse(bytes);
          break;
        case "modbus":
        case "slip":
          r = modbusParse(tmpl === "slip" && bytes[0] === 0xc0 ? bytes.slice(1, -1) : bytes);
          break;
        default: {
          // 自定义帧：结构 + SUM
          if (bytes.length < 6) throw new Error(tr("帧长不足 6 字节"));
          const calc = bytes.slice(0, -1).reduce((a, b) => a + b, 0) & 0xff;
          const ok = calc === bytes[bytes.length - 1];
          const gotS = bytes[bytes.length - 1].toString(16).padStart(2, "0").toUpperCase();
          const calcS = calc.toString(16).padStart(2, "0").toUpperCase();
          r = {
            rows: [
              [tr("帧头"), hexOf(bytes.slice(0, 2))],
              [tr("长度"), String(bytes[2])],
              ["CMD", "0x" + bytes[3].toString(16).padStart(2, "0")],
              [tr("数据区"), hexOf(bytes.slice(4, -1))],
              [
                tr("SUM 校验"),
                ok ? "✓ " + gotS : chkFail(gotS, calcS),
              ],
            ] as [string, string][],
            crcOK: ok,
          };
        }
      }
      protoStore.set({ parse: r });
    } catch (e) {
      toast(tr("解析失败：") + (e as Error).message, "err");
    }
  };

  const isMb = tmpl === "modbus" || tmpl === "mbascii" || tmpl === "slip";

  return (
    <section className="page">
      <div className="split" style={{ flexDirection: "row" }}>
        <div className="col left" style={{ flex: "0 0 300px" }}>
          <div className="card" style={{ flex: 1 }}>
            <header>
              <Ic className="h-ico">{P.code}</Ic>
              {t("pr.tmpl")}
            </header>
            <div className="body" style={{ gap: 8 }}>
              {TMPLS.map((tp) => (
                <div
                  key={tp.id}
                  className={`tmpl${tmpl === tp.id ? " on" : ""}`}
                  onClick={() => {
                    protoStore.set({ tmpl: tp.id, frame: null, parse: null });
                    toast(tr(tp.nm));
                  }}
                >
                  <div className="tico">
                    <Ic size={17} sw={1.7}>
                      {tp.icon}
                    </Ic>
                  </div>
                  <div>
                    <div className="nm">{tr(tp.nm)}</div>
                    <div className="ds">{t(tp.ds)}</div>
                  </div>
                </div>
              ))}
              <div className="tag-note" style={{ marginTop: 4 }}>
                {t("pr.tipA")}
                <b>{t("pr.gb")}</b>
                {t("pr.tipMid")}
                <b>{t("pr.pb")}</b>
                {t("pr.tipB")}
              </div>
            </div>
          </div>
        </div>
        <div className="col right">
          <div className="card" style={{ flex: 1 }}>
            <header>
              <Ic className="h-ico">{P.plus}</Ic>
              {t("pr.build")}
            </header>
            <div className="body">
              {isMb && (
                <div className="fieldrow">
                  <div className="fld">
                    <label>{t("pr.addr")}</label>
                    <input type="text" value={addr} onChange={(e) => setAddr(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label>{t("pr.fn")}</label>
                    <select value={fn} onChange={(e) => setFn(e.target.value)}>
                      {FN_CODES.map(([v, tt]) => (
                        <option key={v} value={v}>
                          {tt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="fld">
                    <label>{t("pr.reg")}</label>
                    <input type="text" value={reg} onChange={(e) => setReg(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label>{t("pr.qty")}</label>
                    <input type="text" value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                </div>
              )}
              {tmpl === "dlt645" && (
                <div className="fieldrow">
                  <div className="fld">
                    <label>{t("pr.meterAddr")}</label>
                    <input type="text" value={meterAddr} onChange={(e) => setMeterAddr(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label>{t("pr.ctrl")}</label>
                    <input type="text" value={ctrl} onChange={(e) => setCtrl(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label>{t("pr.di")}</label>
                    <input type="text" value={di} onChange={(e) => setDi(e.target.value)} />
                  </div>
                </div>
              )}
              {tmpl === "nmea" && (
                <div className="fieldrow">
                  <div className="fld">
                    <label>{t("pr.sentence")}</label>
                    <input type="text" value={sentence} onChange={(e) => setSentence(e.target.value)} />
                  </div>
                  <div className="fld grow">
                    <label>{t("pr.fields")}</label>
                    <input type="text" value={fields} onChange={(e) => setFields(e.target.value)} />
                  </div>
                </div>
              )}
              {tmpl === "custom" && (
                <div className="fieldrow">
                  <div className="fld">
                    <label>{t("pr.cmd")}</label>
                    <input type="text" value={cmd} onChange={(e) => setCmd(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label>{t("pr.d1")}</label>
                    <input type="text" value={reg} onChange={(e) => setReg(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label>{t("pr.d2")}</label>
                    <input type="text" value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                </div>
              )}
              {tmpl === "canopen" && (
                <div className="fieldrow">
                  <div className="fld">
                    <label>{t("pr.nodeId")}</label>
                    <input
                      type="number"
                      min={1}
                      max={127}
                      value={coNode}
                      onChange={(e) => setCoNode(String(Math.min(127, Math.max(1, +e.target.value || 1))))}
                      style={{ width: 90 }}
                    />
                  </div>
                  <div className="fld">
                    <label>{t("pr.rw")}</label>
                    <div className="seg" style={{ width: "fit-content" }}>
                      <button className={coRead ? "on" : ""} onClick={() => setCoRead(true)}>
                        {t("pr.read")}
                      </button>
                      <button className={!coRead ? "on" : ""} onClick={() => setCoRead(false)}>
                        {t("pr.write")}
                      </button>
                    </div>
                  </div>
                  <div className="fld">
                    <label>{t("pr.idxHex")}</label>
                    <input type="text" value={coIdx} onChange={(e) => setCoIdx(e.target.value.toUpperCase())} style={{ width: 72 }} spellCheck={false} />
                  </div>
                  <div className="fld">
                    <label>{t("pr.subHex")}</label>
                    <input type="text" value={coSub} onChange={(e) => setCoSub(e.target.value.toUpperCase())} style={{ width: 56 }} spellCheck={false} />
                  </div>
                  {!coRead && (
                    <div className="fld">
                      <label>{t("pr.wrVal")}</label>
                      <input type="text" value={coVal} onChange={(e) => setCoVal(e.target.value.toUpperCase())} style={{ width: 96 }} spellCheck={false} />
                    </div>
                  )}
                </div>
              )}
              <div className="row">
                <button className="btn primary sm" onClick={build}>
                  <Ic>{P.bolt}</Ic>
                  {t("pr.gen")}
                </button>
                {tmpl === "canopen" && coCob != null && (
                  <span className="badge o">COB-ID 0x{coCob.toString(16).padStart(3, "0").toUpperCase()}</span>
                )}
                <span className="tag-note">
                  {tmpl === "canopen"
                    ? t("pr.noteCanopen")
                    : tmpl === "nmea"
                    ? t("pr.noteNmea")
                    : tmpl === "dlt645"
                    ? t("pr.note645")
                    : tmpl === "mbascii"
                    ? t("pr.noteAscii")
                    : t("pr.noteDef")}
                </span>
              </div>
              <div
                className="grow"
                style={{
                  padding: "14px 12px 12px",
                  background: "var(--console)",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  minHeight: 66,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div className="framebytes" style={{ position: "relative", paddingTop: 14 }}>
                  {!frame ? (
                    <span style={{ color: "var(--txt3)", fontSize: 12 }}>{t("pr.ph")}</span>
                  ) : (
                    frame.map((b, i) => {
                      const [cls, cap] = byteCap(tmpl, i, frame.length);
                      return (
                        <div key={i} className={`fb ${cls}`}>
                          {cap ? <span className="cap">{cap}</span> : null}
                          {b === 0x0d || b === 0x0a
                            ? b === 0x0d
                              ? "\\r"
                              : "\\n"
                            : b.toString(16).padStart(2, "0").toUpperCase()}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="row">
                <button className="btn sm" onClick={sendToChannel}>
                  → {t("pr.sendCh")}
                </button>
                <button className="btn sm" onClick={copy}>
                  {t("pr.copy")}
                </button>
                <button className="btn sm ghost" onClick={toQueue}>
                  {t("pr.toQueue")}
                </button>
              </div>
            </div>
          </div>
          <div className="card" style={{ flex: 1 }}>
            <header>
              <Ic className="h-ico">{P.search}</Ic>
              {t("pr.parse")}
            </header>
            <div className="body">
              <textarea
                className="ta"
                rows={3}
                value={parseIn}
                onChange={(e) => setParseIn(e.target.value)}
                placeholder={
                  tmpl === "canopen"
                    ? t("pr.phCan")
                    : tmpl === "nmea"
                    ? t("pr.phNmea")
                    : t("pr.phHex")
                }
                spellCheck={false}
              />
              <div className="row">
                <button className="btn primary sm" onClick={doParse}>
                  <Ic>{P.search}</Ic>
                  {t("pr.parseBtn")}
                </button>
                <span className="tag-note">{t("pr.noteParse")}</span>
              </div>
              {parse && (
                <table className="parse-table">
                  <tbody>
                    {parse.rows.map(([k, v], i) => (
                      <tr key={i}>
                        <td>{k}</td>
                        <td
                          style={{
                            color: v.includes("✗") ? "var(--err)" : v.includes("✓") ? "var(--rx)" : "var(--txt2)",
                          }}
                        >
                          {v}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>{t("pr.rawBytes")}</td>
                      <td>{tmpl === "canopen" ? parseIn : hexOf(parseHex(parseIn))}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
