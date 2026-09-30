import { useEffect } from "react";
import { NavRail } from "./components/NavRail";
import { TopBar } from "./components/TopBar";
import { SerialPage } from "./pages/SerialPage";
import { CanPage } from "./pages/CanPage";
import { NetPage } from "./pages/NetPage";
import { MqttPage } from "./pages/MqttPage";
import { ProtoPage } from "./pages/ProtoPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useStore } from "./lib/store";
import { uiStore } from "./lib/state";
import { initBridge, setForceMock } from "./lib/bridge";
import { setMaxLines, setTsMode } from "./lib/consoles";
import { queueTick } from "./lib/queue";

export default function App() {
  const { page, settings, toasts } = useStore(uiStore);

  useEffect(() => {
    initBridge();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    const r = document.documentElement.style;
    r.setProperty("--amber", settings.accent);
    r.setProperty("--amber2", settings.accent);
    r.setProperty("--tx", settings.accent);
    setMaxLines(settings.maxLines);
    setTsMode(settings.tsFormat);
    setForceMock(settings.forceMock);
  }, [settings]);

  useEffect(() => {
    const t = setInterval(queueTick, 100);
    return () => clearInterval(t);
  }, []);

  return (
    <div id="app" className={settings.consoleAnim ? "" : "noanim"}>
      <NavRail />
      <div id="main">
        <TopBar />
        <div id="pages">
          {page === "serial" && <SerialPage />}
          {page === "can" && <CanPage />}
          {page === "net" && <NetPage />}
          {page === "mqtt" && <MqttPage />}
          {page === "proto" && <ProtoPage />}
          {page === "settings" && <SettingsPage />}
        </div>
      </div>
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.type === "ok" ? "" : " " + t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
