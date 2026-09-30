/**
 * 通道内嵌定时发送：挂在发送条内，点击时钟按钮弹出任务面板（不占页面布局空间）
 * 由全局 queueTick 驱动发射
 */
import { useEffect, useRef, useState } from "react";
import { Ic, P } from "../components/icons";
import { queueStore, toast, type QTask } from "../lib/state";
import { useStore, type ChannelId } from "../lib/store";
import { addTask, removeTask, updateTask } from "../lib/queue";
import { useT, tr } from "../lib/i18n";

export function Periodic({ channel }: { channel: ChannelId }) {
  const t = useT();
  const tasks = useStore(queueStore).tasks.filter((task) => task.channel === channel);
  const running = tasks.filter((task) => task.on).length;
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState("");
  const [period, setPeriod] = useState("1000");
  const [canId, setCanId] = useState("181");
  const [topic, setTopic] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击面板外部自动收起
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const add = () => {
    const p = payload.trim();
    if (!p) return toast(t("pd.emptyPayload"), "warn");
    addTask({
      name: p.length > 14 ? p.slice(0, 14) + "…" : p,
      payload: p,
      channel,
      ...(channel === "can" ? { canId } : {}),
      ...(channel === "mqtt" ? { topic: topic || "linklab/test" } : {}),
      periodMs: Math.max(50, +period || 1000),
    });
    setPayload("");
  };

  return (
    <div className="pd-wrap" ref={wrapRef}>
      <button
        className={`btn${running ? " good" : ""}`}
        title={t("pd.title")}
        onClick={() => setOpen((o) => !o)}
        style={running ? { borderColor: "rgba(63,208,164,.4)", color: "var(--rx)" } : undefined}
      >
        <Ic size={14}>{P.clock}</Ic>
        {t("pd.title")}
        {running > 0 && <span className="pd-badge">{running}</span>}
      </button>
      {open && (
        <div className="pd-pop">
          <div className="ttl">
            <Ic size={14} sw={1.8} style={{ color: "var(--amber)" }}>
              {P.clock}
            </Ic>
            {t("pd.title")}
            <span className="grow" />
            <span className="tag-note">
              {running} {t("pd.running")}
            </span>
          </div>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            {channel === "can" && (
              <div className="fld" style={{ width: 84 }}>
                <label>{t("pd.canId")}</label>
                <input type="text" value={canId} onChange={(e) => setCanId(e.target.value)} />
              </div>
            )}
            {channel === "mqtt" && (
              <div className="fld" style={{ width: 130 }}>
                <label>{t("pd.topic")}</label>
                <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="linklab/test" />
              </div>
            )}
            <div className="fld grow">
              <label>{channel === "mqtt" ? t("pd.textPayload") : t("pd.payload")}</label>
              <input
                type="text"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder={channel === "mqtt" ? '{"temp":26.4}' : "01 03 00 00 00 02 C4 0B"}
                spellCheck={false}
              />
            </div>
            <div className="fld" style={{ width: 88 }}>
              <label>{t("pd.period")}</label>
              <input type="number" value={period} min={50} step={100} onChange={(e) => setPeriod(e.target.value)} />
            </div>
            <button className="btn sm primary" style={{ alignSelf: "flex-end" }} onClick={add}>
              <Ic size={13}>{P.plus}</Ic>
              {t("pd.add")}
            </button>
          </div>
          {tasks.length === 0 ? (
            <div className="tag-note" style={{ textAlign: "center", padding: "8px 0" }}>
              —
            </div>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              {tasks.map((task: QTask) => (
                <div key={task.id} className={`qrow${task.on ? " running" : ""}`} style={{ background: "var(--bg)" }}>
                  <button
                    className={`switch${task.on ? " on" : ""}`}
                    title={task.on ? t("pd.paused") : t("pd.add")}
                    onClick={() => updateTask(task.id, { on: !task.on, left: 0 })}
                  />
                  <span className="nm" style={{ minWidth: 0 }}>
                    {tr(task.name)}
                  </span>
                  {channel === "can" && task.canId && (
                    <span className="cd" style={{ color: "var(--purple)" }}>
                      0x{task.canId}
                    </span>
                  )}
                  {channel === "mqtt" && task.topic && <span className="cd hot">{task.topic}</span>}
                  <span className="pl">{task.payload}</span>
                  <span className={`cd${task.on ? " hot" : ""}`}>
                    {task.on
                      ? `${(task.left / 1000).toFixed(1)}s / ${(task.periodMs / 1000).toFixed(1)}s`
                      : t("pd.paused")}
                  </span>
                  <button className="btn sm danger" onClick={() => removeTask(task.id)}>
                    {t("pd.delete")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
