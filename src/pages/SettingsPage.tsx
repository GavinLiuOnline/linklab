import { Ic, P } from "../components/icons";
import { consoleStores } from "../lib/consoles";
import { saveSettings, uiStore, toast } from "../lib/state";
import { useStore } from "../lib/store";
import { mockActive } from "../lib/bridge";
import { saveText } from "../lib/file";
import { useT } from "../lib/i18n";

const ACCENTS = ["#ffb454", "#4ec9b0", "#6cb6ff", "#ff7b72", "#b48cff"];

export function SettingsPage() {
  const t = useT();
  const { settings } = useStore(uiStore);

  /** 导出四个控制台全部会话内容（原始字节重建） */
  const exportLog = async () => {
    const ids = [
      ["sp", "串口 SERIAL"],
      ["can", "CAN 总线"],
      ["net", "网络 SOCKET"],
      ["mq", "MQTT"],
    ] as const;
    let total = 0;
    const dump = ids
      .map(([id, name]) => {
        const st = consoleStores[id].get();
        total += st.lines.length;
        const body = st.lines
          .map((l) => {
            if (!l.raw) return `${l.t}\t${l.label}\t\t${l.segs.map((s) => s.text).join("")}`;
            const ascii = l.raw
              .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
              .join("");
            const hex = l.raw.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
            return `${l.t}\t${l.label}\t${hex}\t${ascii}`;
          })
          .join("\n");
        return `# ===== ${name}（${st.lines.length} 帧）=====\n${body}`;
      })
      .join("\n\n");
    const head = `# LinkLab 会话导出 · ${new Date().toISOString().slice(0, 19).replace("T", " ")} · 共 ${total} 帧\n# 时间戳\t方向\tHEX\tASCII\n\n`;
    try {
      if (await saveText("linklab-session.log", head + dump + "\n")) toast("已导出会话日志");
    } catch (e) {
      toast("导出失败：" + e, "err");
    }
  };

  return (
    <section className="page" style={{ overflowY: "auto" }}>
      <div className="col" style={{ maxWidth: 860, width: "100%", margin: "0 auto" }}>
        {/* ── 通用 ── */}
        <div className="card">
          <header>
            <Ic className="h-ico">{P.bolt}</Ic>
            {t("st.general")}
          </header>
          <div className="body">
            <div className="row">
              <div className="fld">
                <label>{t("st.lang")}</label>
                <div className="seg">
                  <button className={settings.lang === "zh" ? "on" : ""} onClick={() => saveSettings({ lang: "zh" })}>
                    中文
                  </button>
                  <button className={settings.lang === "en" ? "on" : ""} onClick={() => saveSettings({ lang: "en" })}>
                    English
                  </button>
                </div>
              </div>
            </div>
            <label className="opt">
              <input
                type="checkbox"
                checked={settings.forceMock}
                onChange={(e) => saveSettings({ forceMock: e.target.checked })}
              />
              {t("st.mock")}
            </label>
            <div className="tag-note">
              当前状态：<b>{mockActive() ? "模拟模式" : "真实 IO（Tauri 后端）"}</b>
              <br />
              真实模式由 Rust 侧驱动：serialport / socketcan / tokio / rumqttc；协议解析仍在前端完成。
            </div>
          </div>
        </div>

        {/* ── 外观 ── */}
        <div className="card">
          <header>
            <Ic className="h-ico">{P.clock}</Ic>
            {t("st.appearance")}
          </header>
          <div className="body">
            <div className="row">
              <div className="fld">
                <label>{t("st.theme")}</label>
                <div className="seg">
                  <button
                    className={settings.theme === "dark" ? "on" : ""}
                    onClick={() => saveSettings({ theme: "dark" })}
                  >
                    {t("st.dark")}
                  </button>
                  <button
                    className={settings.theme === "light" ? "on" : ""}
                    onClick={() => saveSettings({ theme: "light" })}
                  >
                    {t("st.light")}
                  </button>
                </div>
              </div>
              <div className="fld">
                <label>{t("st.accent")}</label>
                <div className="theme-swatches">
                  {ACCENTS.map((c) => (
                    <div
                      key={c}
                      className={`sw${settings.accent === c ? " on" : ""}`}
                      style={{ background: c }}
                      onClick={() => saveSettings({ accent: c })}
                    />
                  ))}
                </div>
              </div>
            </div>
            <label className="opt">
              <input
                type="checkbox"
                checked={settings.consoleAnim}
                onChange={(e) => saveSettings({ consoleAnim: e.target.checked })}
              />
              {t("st.anim")}
            </label>
          </div>
        </div>

        {/* ── 控制台 ── */}
        <div className="card">
          <header>
            <Ic className="h-ico">{P.terminal}</Ic>
            {t("st.logbuf")}
          </header>
          <div className="body">
            <div className="row">
              <div className="fld">
                <label>{t("st.maxLines")}</label>
                <input
                  type="number"
                  value={settings.maxLines}
                  onChange={(e) => saveSettings({ maxLines: +e.target.value || 500 })}
                  style={{ width: 110 }}
                />
              </div>
              <div className="fld">
                <label>{t("st.tsFmt")}</label>
                <div className="seg">
                  {(
                    [
                      ["clock", "HH:mm:ss.SSS"],
                      ["mono", "+1.234s"],
                      ["abs", "2026-01-01 08:00:00"],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      className={settings.tsFormat === v ? "on" : ""}
                      onClick={() => saveSettings({ tsFormat: v })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fld">
                <label>&nbsp;</label>
                <button className="btn" onClick={exportLog}>
                  <Ic size={13}>{P.lines}</Ic>
                  {t("st.exportLog")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── 关于 ── */}
        <div className="card">
          <header>
            <Ic className="h-ico">{P.box}</Ic>关于
          </header>
          <div className="body">
            <div className="tag-note">
              <b>LinkLab 0.1.0</b> · 通讯调试台 — 串口 / CAN / TCP-UDP / MQTT
              <br />
              本应用以 <b>Tauri 2</b> 打包（Rust 侧经 <b>serialport / socketcan / rumqttc</b> 实现真实 IO），产物体积小、启动快。
              <br />
              <br />· 构建：<b>pnpm app:build</b>，产物在 src-tauri/target/release/bundle
              <br />· Linux: deb / AppImage · Windows: msi / nsis · macOS: dmg / app
              <br />· 跨平台产物建议在各目标系统（或 CI runner）上构建，见 .github/workflows/build.yml
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
