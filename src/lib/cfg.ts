/** 页面配置持久化 */
export function loadCfg<T extends object>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem("linklab.cfg." + key);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}
export function saveCfg(key: string, cfg: object) {
  try {
    localStorage.setItem("linklab.cfg." + key, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
