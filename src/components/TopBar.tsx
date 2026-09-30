import { useStore, type ChannelId } from "../lib/store";
import { channelStore, uiStore } from "../lib/state";
import { useT, type I18nKey } from "../lib/i18n";

const CHIP_NAME: Record<ChannelId, I18nKey> = { serial: "nav.serial", can: "nav.can", net: "nav.net", mqtt: "nav.mqtt" };

export function TopBar() {
  const t = useT();
  const page = useStore(uiStore).page;
  const channels = useStore(channelStore);
  const opened = (Object.keys(channels) as ChannelId[]).filter((id) => channels[id].open);
  const label = opened.length ? opened.map((id) => t(CHIP_NAME[id])).join(" · ") : t("conn.off");
  return (
    <div id="topbar">
      <div>
        <h1>{t(`nav.${page}` as I18nKey)}</h1>
        <div className="sub">{t(`sub.${page}` as I18nKey)}</div>
      </div>
      <div id="connchips">
        <div className={`chip${opened.length ? " on" : ""}`} title={t("conn.title")}>
          <span className="led" />
          {label}
        </div>
      </div>
    </div>
  );
}
