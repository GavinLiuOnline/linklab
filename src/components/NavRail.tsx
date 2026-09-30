import type { ReactNode } from "react";
import { Ic, P } from "./icons";
import { useStore, type ChannelId, type PageId } from "../lib/store";
import { channelStore, uiStore } from "../lib/state";
import { useT, type I18nKey } from "../lib/i18n";

const NAV: { page: PageId; icon: ReactNode; key: I18nKey; ch?: ChannelId }[] = [
  { page: "serial", icon: P.serial, key: "nav.serial", ch: "serial" },
  { page: "can", icon: P.can, key: "nav.can", ch: "can" },
  { page: "net", icon: P.net, key: "nav.net", ch: "net" },
  { page: "mqtt", icon: P.mqtt, key: "nav.mqtt", ch: "mqtt" },
  { page: "proto", icon: P.proto, key: "nav.proto" },
];

export function NavRail() {
  const t = useT();
  const page = useStore(uiStore).page;
  const channels = useStore(channelStore);
  return (
    <nav id="rail">
      <div className="logo" title="LinkLab">
        <Ic size={20} sw={2.2}>{P.logo}</Ic>
      </div>
      {NAV.map((n) => (
        <button
          key={n.page}
          className={`navbtn${page === n.page ? " on" : ""}${n.ch && channels[n.ch].open ? " live" : ""}`}
          title={t(n.key)}
          onClick={() => uiStore.set({ page: n.page })}
        >
          <Ic size={21} sw={1.7}>{n.icon}</Ic>
          <span className="dot" />
        </button>
      ))}
      <div className="spacer" />
      <button
        className={`navbtn${page === "settings" ? " on" : ""}`}
        title={t("nav.settings")}
        onClick={() => uiStore.set({ page: "settings" })}
      >
        <Ic size={21} sw={1.7}>{P.settings}</Ic>
      </button>
    </nav>
  );
}
