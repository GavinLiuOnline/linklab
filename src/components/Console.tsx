import { Fragment, memo, useEffect, useRef, useState } from "react";
import { clearConsole, setFmt, togglePause, useConsole, type LogLine } from "../lib/consoles";
import type { ConsoleId } from "../lib/store";
import { useStore } from "../lib/store";
import { uiStore, toast } from "../lib/state";
import { saveText } from "../lib/file";
import { useT } from "../lib/i18n";
import { Ic, P } from "./icons";
import { hexOf } from "../lib/bytes";
import {
  modbusParse,
  modbusAsciiParse,
  dlt645Parse,
  nmeaParse,
  canopenParse,
} from "../lib/protocols";

/**
 * 数据监视控制台：时间戳 + 方向 + 负载，HEX/ASCII/混合切换，暂停滚动 / 清空 / 过滤 / 导出
 * 点击行选中，右键弹出协议解析菜单（Modbus / 645 / NMEA / CANopen 等）。
 */

type PT = "modbus" | "mbascii" | "dlt645" | "nmea" | "custom" | "slip" | "canopen";

const PT_NAME: Record<PT, string> = {
  modbus: "Modbus RTU",
  mbascii: "Modbus ASCII",
  dlt645: "DL/T 645-2007",
  nmea: "NMEA 0183",
  custom: "自定义帧头帧",
  slip: "SLIP 解包",
  canopen: "CANopen",
};

/** 每个控制台可用的解析协议 */
const MENU: Record<ConsoleId, PT[]> = {
  sp: ["modbus", "mbascii", "dlt645", "nmea", "custom", "slip"],
  net: ["modbus", "mbascii", "dlt645", "nmea", "custom", "slip"],
  can: ["canopen", "custom"],
  mq: ["modbus", "nmea", "custom"],
};

/** 执行解析：返回字段表；失败时首行为错误 */
function parseRows(pt: PT, l: LogLine): [string, string][] {
  const raw = l.raw ?? [];
  try {
    switch (pt) {
      case "modbus": {
        const r = modbusParse(raw);
        return r.rows;
      }
      case "mbascii": {
        const r = modbusAsciiParse(raw);
        return r.rows;
      }
      case "dlt645":
        return dlt645Parse(raw).rows;
      case "nmea":
        return nmeaParse(raw).rows;
      case "canopen": {
        const p = canopenParse(l.canId ?? 0, raw);
        return [
          ["类型", p.kind + " · " + p.label],
          ["节点 ID", p.node],
          ["COB-ID", "0x" + (l.canId ?? 0).toString(16).padStart(3, "0").toUpperCase()],
          ["字段", p.detail],
        ];
      }
      case "slip": {
        // SLIP 解包（C0 分隔 + DC 转义还原）
        const out: number[] = [];
        let esc = false;
        for (const b of raw) {
          if (b === 0xc0) continue;
          if (esc) {
            out.push(b === 0xdc ? 0xc0 : b === 0xdd ? 0xdb : b);
            esc = false;
          } else if (b === 0xdb) esc = true;
          else out.push(b);
        }
        const mb = modbusParse(out);
        return [
          ["解包数据", hexOf(out)],
          ["ASCII", out.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("")],
          ...mb.rows,
        ];
      }
      default: {
        // 自定义帧头帧：AA 55 + LEN + CMD + DATA + SUM
        if (raw.length < 6) throw new Error("帧长不足 6 字节");
        if (raw[0] !== 0xaa || raw[1] !== 0x55) throw new Error("帧头不符（应为 AA 55）");
        const len = raw[2];
        const calc = raw.slice(0, -1).reduce((a, b) => a + b, 0) & 0xff;
        const ok = calc === raw[raw.length - 1];
        return [
          ["帧头", "AA 55"],
          ["长度", String(len)],
          ["CMD", "0x" + raw[3].toString(16).padStart(2, "0")],
          ["数据区", hexOf(raw.slice(4, 4 + len))],
          [
            "SUM 校验",
            ok
              ? "✓ " + raw[raw.length - 1].toString(16).padStart(2, "0").toUpperCase()
              : `✗ 收 ${raw[raw.length - 1].toString(16).padStart(2, "0").toUpperCase()} ≠ 算 ${calc
                  .toString(16)
                  .padStart(2, "0")
                  .toUpperCase()}`,
          ],
        ];
      }
    }
  } catch (e) {
    return [["错误", (e as Error).message]];
  }
}

/** 单行渲染组件：memo 化，旧行引用稳定时跳过重渲染 */
const Row = memo(
  function Row({ l, sel, onCtx, onClick }: { l: LogLine; sel: boolean; onCtx: (e: React.MouseEvent, l: LogLine) => void; onClick: (e: React.MouseEvent) => void }) {
    return (
      <div
        className={`ln ${l.dir}${sel ? " sel" : ""}`}
        style={l.raw ? { cursor: "context-menu" } : undefined}
        onClick={onClick}
        onContextMenu={(e) => onCtx(e, l)}
      >
        <span className="t">{l.t}</span>
        <span className="dir">{l.label}</span>
        <span className="payload">
          {l.segs.map((s, i) =>
            s.color || s.bold ? (
              <span key={i} style={{ color: s.color, fontWeight: s.bold ? 700 : undefined }}>
                {s.text}
              </span>
            ) : (
              <Fragment key={i}>{s.text}</Fragment>
            )
          )}
        </span>
      </div>
    );
  },
  (a, b) => a.l.id === b.l.id && a.sel === b.sel
);

export function Console({
  id,
  title,
  withFmt = true,
  filterable = false,
  showTs = true,
}: {
  id: ConsoleId;
  title: string;
  withFmt?: boolean;
  filterable?: boolean;
  showTs?: boolean;
}) {
  const st = useConsole(id);
  const t = useT();
  // 渲染窗口跟随系统设置"控制台最大保留行数"（响应式，设置即时生效）
  const renderMax = Math.max(100, useStore(uiStore).settings.maxLines);
  const [kw, setKw] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  // 右键解析：选中行 + 菜单位置 + 解析结果浮层
  const [sel, setSel] = useState<number | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; line: LogLine } | null>(null);
  const [result, setResult] = useState<{ title: string; rows: [string, string][] } | null>(null);
  // 滚动锚定：仅当用户贴底时自动跟随；上翻查看历史不拉扯
  const atBottom = useRef(true);

  useEffect(() => {
    if (!st.paused && bodyRef.current && atBottom.current) {
      bodyRef.current.scrollTop = 1e9; // 写大值由浏览器钳位，避免读 scrollHeight 强制布局
    }
  }, [st.lines.length, st.paused]);

  const lines = kw
    ? st.lines.filter((l) => (l.label + l.segs.map((s) => s.text).join("")).includes(kw))
    : st.lines;

  /** 导出当前控制台收发内容（原始字节重建 HEX/ASCII，不依赖显示格式） */
  const exportLog = async () => {
    const n = st.lines.length;
    if (!n) return;
    const head = `# LinkLab 导出 · ${title} · ${new Date().toISOString().slice(0, 19).replace("T", " ")} · 共 ${n} 帧\n# 时间戳\t方向\tHEX\tASCII/文本\n`;
    const body = st.lines
      .map((l) => {
        if (!l.raw) return `${l.t}\t${l.label}\t\t${l.segs.map((s) => s.text).join("")}`;
        const hex = hexOf(l.raw);
        const ascii = l.raw
          .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
          .join("");
        return `${l.t}\t${l.label}\t${hex}\t${ascii}`;
      })
      .join("\n");
    const name = `linklab-${id}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.log`;
    try {
      if (await saveText(name, head + body + "\n")) toast("已导出 " + n + " 帧");
    } catch (e) {
      toast("导出失败：" + e, "err");
    }
  };

  const openCtx = (e: React.MouseEvent, l: LogLine) => {
    if (!l.raw) return;
    e.preventDefault();
    setSel(l.id);
    // 菜单为 fixed 定位：直接用视口坐标，不受滚动容器影响
    setCtx({ x: e.clientX, y: e.clientY, line: l });
  };

  const doParse = (pt: PT) => {
    if (!ctx?.line) return;
    setResult({ title: PT_NAME[pt], rows: parseRows(pt, ctx.line) });
    setCtx(null);
  };

  return (
    <div className="console">
      <div className="cbar">
        <span className="title">{title}</span>
        <span className="cnt">
          {t("con.frames")} <b>{st.frames}</b>
        </span>
        {filterable && (
          <span className="cnt" style={{ marginLeft: 12 }}>
            {t("con.filter")}{" "}
            <input
              type="text"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder={t("con.filterPh")}
              style={{ width: 150, height: 26, padding: "0 8px", fontSize: 11 }}
            />
          </span>
        )}
        <div style={{ marginLeft: "auto" }} />
        {withFmt && (
          <div className="seg">
            {(["hex", "ascii", "both"] as const).map((f) => (
              <button key={f} className={st.fmt === f ? "on" : ""} onClick={() => setFmt(id, f)}>
                {f === "hex" ? "HEX" : f === "ascii" ? "ASCII" : t("con.both")}
              </button>
            ))}
          </div>
        )}
        <button className="btn sm ghost" onClick={exportLog} title={t("con.export")} disabled={!st.lines.length}>
          <Ic size={13}>{P.lines}</Ic>
          {t("con.export")}
        </button>
        <button
          className="btn sm ghost"
          onClick={() => togglePause(id)}
          style={st.paused ? { color: "var(--amber)" } : undefined}
        >
          {st.paused ? t("con.resume") : t("con.pause")}
        </button>
        <button className="btn sm ghost" onClick={() => clearConsole(id)}>
          {t("con.clear")}
        </button>
      </div>
      <div
        className={`cbody${showTs ? "" : " hidets"}`}
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        onClick={() => setCtx(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {lines.length === 0 ? (
          <div className="empty-hint">
            <Ic size={34} sw={1.4}>
              {P.terminal}
            </Ic>
            <div>{t("con.empty")}</div>
          </div>
        ) : (
          lines.slice(-renderMax).map((l) => (
            <Row
              key={l.id}
              l={l}
              sel={sel === l.id}
              onCtx={openCtx}
              onClick={(e) => {
                e.stopPropagation();
                setSel(l.id);
                setCtx(null);
              }}
            />
          ))
        )}
      </div>
      {ctx && (
        <>
          {/* 全屏透明遮罩：点击任意处关闭菜单（含右键再开时先收旧菜单） */}
          <div
            className="ctxmask"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx(null);
            }}
          />
          <div
            className="ctxmenu"
            style={{
              left: Math.min(ctx.x, window.innerWidth - 200),
              top: Math.min(ctx.y, window.innerHeight - 220),
            }}
          >
            <div className="ctx-head">
              协议解析 · {hexOf(ctx.line.raw ?? []).slice(0, 32)}
              {hexOf(ctx.line.raw ?? []).length > 32 ? "…" : ""}
            </div>
            {MENU[id].map((pt) => (
              <button key={pt} className="ctx-item" onClick={() => doParse(pt)}>
                {PT_NAME[pt]}
              </button>
            ))}
          </div>
        </>
      )}
      {result && (
        <div className="pmodal-mask" onClick={() => setResult(null)}>
          <div className="pmodal" onClick={(e) => e.stopPropagation()}>
            <header>
              <Ic className="h-ico">{P.search}</Ic>
              协议解析结果 · {result.title}
              <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => setResult(null)}>
                ✕
              </button>
            </header>
            <div className="pbody">
              <table className="parse-table">
                <tbody>
                  {result.rows.map(([k, v], i) => (
                    <tr key={i}>
                      <td>{k}</td>
                      <td style={{ whiteSpace: "pre-line", color: v.includes("✗") || k === "错误" ? "var(--err)" : v.includes("✓") ? "var(--rx)" : "var(--txt2)" }}>
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
