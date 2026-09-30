/** 字节工具：HEX 容错解析 / 十六进制 / ASCII 对照 */

export function hexOf(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++)
    out += (i ? " " : "") + bytes[i].toString(16).padStart(2, "0").toUpperCase();
  return out;
}

export function asciiOf(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += b >= 32 && b < 127 ? String.fromCharCode(b) : "·";
  }
  return s;
}

/** 容错解析：支持空格 / 逗号 / 0x 前缀 / 无分隔，奇数长度报错 */
export function parseHex(s: string): number[] {
  const t = s.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  if (t.length % 2) throw new Error("HEX 长度为奇数");
  const out: number[] = [];
  for (let i = 0; i < t.length; i += 2) out.push(parseInt(t.slice(i, i + 2), 16));
  return out;
}

export const utf8Decode = (bytes: ArrayLike<number>): string =>
  new TextDecoder().decode(new Uint8Array(bytes as number[]));

export const utf8Encode = (s: string): number[] => Array.from(new TextEncoder().encode(s));
