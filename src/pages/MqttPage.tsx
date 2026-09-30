import { useState } from "react";
import { Console } from "../components/Console";
import { Periodic } from "../components/Periodic";
import { useT } from "../lib/i18n";
import { Ic, P } from "../components/icons";
import { closeChannel, openChannel, sendBytes, subscribeTopic } from "../lib/bridge";
import { bumpErr, channelStore, setOpen, toast } from "../lib/state";
import { useStore } from "../lib/store";
import { loadCfg, saveCfg } from "../lib/cfg";
import { pushLine } from "../lib/consoles";

interface MqttCfg {
  host: string;
  port: string;
  cid: string;
  user: string;
  pass: string;
  proto: string;
  keepalive: string;
}
const DEF: MqttCfg = {
  host: "broker.emqx.io",
  port: "1883",
  cid: "linklab-9f2c",
  user: "",
  pass: "",
  proto: "MQTT 3.1.1",
  keepalive: "30",
};

interface Sub {
  topic: string;
  qos: number;
}

function loadSubs(): Sub[] {
  try {
    const raw = localStorage.getItem("linklab.subs");
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [
    { topic: "factory/line1/dev01/temp", qos: 1 },
    { topic: "home/sensor/#", qos: 0 },
  ];
}

export function MqttPage() {
  const t = useT();
  const ch = useStore(channelStore).mqtt;
  const [cfg, setCfg] = useState<MqttCfg>(() => loadCfg("mqtt", DEF));
  const [subs, setSubs] = useState<Sub[]>(loadSubs);
  const [subIn, setSubIn] = useState("");
  const [qos, setQos] = useState("0");
  const [pubTopic, setPubTopic] = useState("");
  const [pubPayload, setPubPayload] = useState("");

  const patch = (p: Partial<MqttCfg>) => {
    setCfg((c) => {
      const n = { ...c, ...p };
      saveCfg("mqtt", n);
      return n;
    });
  };
  const patchSubs = (s: Sub[]) => {
    setSubs(s);
    localStorage.setItem("linklab.subs", JSON.stringify(s));
  };

  const toggle = async () => {
    if (ch.open) {
      try {
        await closeChannel("mqtt");
      } finally {
        setOpen("mqtt", false);
        pushLine("mq", "sys", "SYS", [{ text: "通道已关闭" }]);
        toast("MQTT 已断开", "warn");
      }
      return;
    }
    try {
      await openChannel("mqtt", {
        host: cfg.host,
        port: +cfg.port,
        client_id: cfg.cid,
        username: cfg.user || null,
        password: cfg.pass || null,
        keepalive: +cfg.keepalive,
      });
      setOpen("mqtt", true);
      pushLine("mq", "sys", "SYS", [{ text: `连接 ${cfg.host}:${cfg.port} · ${cfg.cid}` }]);
      // 恢复订阅
      for (const s of subs) await subscribeTopic(s.topic, s.qos);
      if (subs.length) toast(`MQTT 已连接 · 恢复 ${subs.length} 个订阅`);
      else toast("MQTT 已连接");
    } catch (e) {
      toast(String(e) || "连接失败", "err");
    }
  };

  const subscribe = async () => {
    const tp = subIn.trim();
    if (!tp) return toast("请输入主题", "warn");
    const q = +qos;
    try {
      await subscribeTopic(tp, q);
      patchSubs([{ topic: tp, qos: q }, ...subs]);
      setSubIn("");
      toast("已订阅 " + tp);
    } catch (e) {
      toast("订阅失败：" + e, "err");
    }
  };

  const publish = async () => {
    const tp = pubTopic.trim() || "factory/line1/dev01/cmd";
    const pl = pubPayload || "{}";
    try {
      await sendBytes("mqtt", [], { topic: tp, text: pl });
      toast("已发布 → " + tp);
    } catch (e) {
      bumpErr("mqtt");
      toast("发布失败：" + e, "err");
    }
  };

  return (
    <section className="page">
      <div className="split">
        <div className="col left">
          <div className="card">
            <header>
              <Ic className="h-ico">{P.mqtt}</Ic>Broker 连接
            </header>
            <div className="body">
              <div className="row">
                <div className="fld grow">
                  <label>服务器</label>
                  <input type="text" value={cfg.host} onChange={(e) => patch({ host: e.target.value })} spellCheck={false} />
                </div>
                <div className="fld" style={{ width: 96 }}>
                  <label>端口</label>
                  <input type="number" value={cfg.port} onChange={(e) => patch({ port: e.target.value })} />
                </div>
              </div>
              <div className="row">
                <div className="fld grow">
                  <label>Client ID</label>
                  <input type="text" value={cfg.cid} onChange={(e) => patch({ cid: e.target.value })} />
                </div>
              </div>
              <div className="row">
                <div className="fld grow">
                  <label>用户名</label>
                  <input type="text" value={cfg.user} placeholder="可选" onChange={(e) => patch({ user: e.target.value })} />
                </div>
                <div className="fld grow">
                  <label>密码</label>
                  <input type="password" value={cfg.pass} placeholder="可选" onChange={(e) => patch({ pass: e.target.value })} />
                </div>
              </div>
              <div className="row">
                <div className="fld">
                  <label>协议</label>
                  <select value={cfg.proto} onChange={(e) => patch({ proto: e.target.value })}>
                    {["MQTT 3.1.1", "MQTT 5.0"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fld">
                  <label>KeepAlive</label>
                  <input type="number" value={cfg.keepalive} style={{ width: 80 }} onChange={(e) => patch({ keepalive: e.target.value })} />
                </div>
              </div>
              <button className={`btn ${ch.open ? "danger" : "primary"}`} style={{ justifyContent: "center" }} onClick={toggle}>
                <Ic>{P.play}</Ic>
                <span>{ch.open ? "断开" : "连接"}</span>
              </button>
            </div>
          </div>
          <div className="card" style={{ flex: 1 }}>
            <header>
              <Ic className="h-ico">{P.box}</Ic>订阅主题
            </header>
            <div className="body">
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  type="text"
                  className="grow"
                  value={subIn}
                  onChange={(e) => setSubIn(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && subscribe()}
                  placeholder="factory/line1/+/temp"
                  spellCheck={false}
                />
                <select value={qos} onChange={(e) => setQos(e.target.value)}>
                  <option value="0">QoS 0</option>
                  <option value="1">QoS 1</option>
                  <option value="2">QoS 2</option>
                </select>
                <button className="btn sm" onClick={subscribe}>
                  订阅
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {subs.map((s) => (
                  <div className="topicrow" key={s.topic}>
                    <span style={{ color: "var(--rx)" }}>{s.topic}</span>
                    <span className="q">Q{s.qos}</span>
                    <button
                      className="btn sm ghost"
                      style={{ marginLeft: "auto" }}
                      onClick={() => patchSubs(subs.filter((x) => x.topic !== s.topic))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="col right">
          <Console id="mq" title="MQTT TRAFFIC" withFmt={false} filterable />
          <div className="sender">
            <input
              type="text"
              value={pubTopic}
              onChange={(e) => setPubTopic(e.target.value)}
              placeholder="主题: factory/line1/dev01/cmd"
              style={{ flex: "0 0 240px" }}
              spellCheck={false}
            />
            <input
              type="text"
              value={pubPayload}
              onChange={(e) => setPubPayload(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && publish()}
              placeholder='{"cmd":"start","speed":80}'
            />
            <button className="btn primary" onClick={publish}>
              <Ic>{P.send}</Ic>
              {t("send.publish")}
            </button>
            <Periodic channel="mqtt" />
          </div>
        </div>
      </div>
    </section>
  );
}
