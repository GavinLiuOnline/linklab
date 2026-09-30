import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./bridge";

/**
 * 保存文本文件：Tauri 内走系统"另存为"对话框 + 后端写文件
 * （WebView 内 Blob 下载在 wry/webkit2gtk 上不可靠）；浏览器开发态走 Blob 下载。
 * 返回是否保存成功（取消对话框视为 false）。
 */
export async function saveText(fileName: string, text: string): Promise<boolean> {
  if (inTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: fileName });
    if (!path) return false; // 用户取消
    await invoke("export_file", { path, contents: text });
    return true;
  }
  const blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}
