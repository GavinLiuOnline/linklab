/**
 * 协议算法（真实实现，与 DESIGN.md §5 一致）
 * - CRC16-Modbus: poly 0xA001, init 0xFFFF, 低字节在前
 * - SLIP: C0 分隔; DC->DB DC, DB->DB DD; 首尾各包一个 C0
 * - Modbus RTU 组帧 / 解帧（请求 / 应答 / 异常帧自动判别）
 */
import { hexOf } from "./bytes";
import { tr } from "./i18n";

/** 校验失败值模板："✗ 收 X ≠ 算 Y"（词条化） */
export const chkFail = (got: string, calc: string) => `✗ ${tr("收")} ${got} ≠ ${tr("算")} ${calc}`;
/** 校验通过值模板："✓ X（计算值 Y）" */
export const chkOk = (v: string, calc: string) => `✓ ${v}（${tr("计算值")} ${calc}）`;

/** CRC16-Modbus，返回 [lo, hi] */
export function crc16Modbus(bytes: ArrayLike<number>): [number, number] {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return [crc & 0xff, (crc >> 8) & 0xff];
}

/** SLIP 转义封装 */
export function slipEncode(bytes: number[]): number[] {
  const out = [0xc0];
  for (const b of bytes) {
    if (b === 0xc0) out.push(0xdb, 0xdc);
    else if (b === 0xdb) out.push(0xdb, 0xdd);
    else out.push(b);
  }
  out.push(0xc0);
  return out;
}

const MB_FNS = ["01", "02", "03", "04", "05", "06", "10"];

/** Modbus RTU 组帧；fn=0x10 时自动补字节计数与数据区（补零） */
export function modbusBuild(addrS: string, fnS: string, regS: string, valS: string): number[] {
  const addr = parseInt(addrS, 16),
    fn = parseInt(fnS, 16),
    reg = parseInt(regS, 16),
    val = parseInt(valS, 16);
  if ([addr, fn, reg, val].some(isNaN)) throw new Error(tr("字段必须为 HEX"));
  if (!MB_FNS.includes(fnS)) throw new Error(tr("不支持的功能码"));
  const body = [addr, fn, (reg >> 8) & 0xff, reg & 0xff, (val >> 8) & 0xff, val & 0xff];
  if (fnS === "10") {
    const n = val;
    body.splice(4, 2, (n >> 8) & 0xff, n & 0xff);
    body.push(n * 2);
    for (let i = 0; i < n * 2; i++) body.push(0); // 数据区补零
  }
  return [...body, ...crc16Modbus(body)];
}

export interface ModbusParseResult {
  rows: [string, string][];
  crcOK: boolean;
}

/** Modbus RTU 解帧：自动判别请求 / 应答 / 异常应答 (0x80|fn) */
export function modbusParse(bytes: number[]): ModbusParseResult {
  if (bytes.length < 4) throw new Error(tr("帧长不足 4 字节"));
  const body = bytes.slice(0, -2);
  const cl = bytes[bytes.length - 2],
    ch = bytes[bytes.length - 1];
  const calc = crc16Modbus(body);
  const crcOK = calc[0] === cl && calc[1] === ch;
  const addr = body[0],
    fn = body[1];
  const isResp =
    fn & 0x80 ||
    (fn >= 0x01 &&
      fn <= 0x04 &&
      body.length > 5 &&
      body[2] <= 0xf0 &&
      !(body[2] === 0 && body[3] === 0 && body[4] === 0));
  const rows: [string, string][] = [
    [tr("从站地址"), "0x" + addr.toString(16).padStart(2, "0")],
    [
      tr("功能码"),
      "0x" + fn.toString(16).padStart(2, "0") + (fn & 0x80 ? tr(" (异常应答 ") + body[2] + ")" : ""),
    ],
    [
      tr("CRC 校验"),
      crcOK
        ? chkOk(hexOf([cl, ch]), hexOf(calc))
        : chkFail(hexOf([cl, ch]), hexOf(calc)),
    ],
  ];
  if (fn & 0x80) {
    rows.push([tr("异常码"), "0x" + body[2].toString(16)]);
    return { rows, crcOK };
  }
  if (isResp && body.length >= 5 && fn <= 0x04) {
    const n = body[2];
    rows.push([tr("字节计数"), n + " B"]);
    for (let i = 0; i < n; i += 2)
      rows.push([
        tr("寄存器") + " #" + i / 2,
        "0x" + (((body[3 + i] << 8) | body[4 + i]) & 0xffff).toString(16).padStart(4, "0"),
      ]);
  } else if (fn <= 0x04 && body.length >= 6) {
    rows.push(
      [tr("起始地址"), "0x" + (((body[2] << 8) | body[3]) & 0xffff).toString(16).padStart(4, "0")],
      [tr("数量"), String(((body[4] << 8) | body[5]) & 0xffff)]
    );
  } else if (fn === 0x10 && body.length >= 6) {
    rows.push(
      [tr("起始地址"), "0x" + (((body[2] << 8) | body[3]) & 0xffff).toString(16).padStart(4, "0")],
      [tr("寄存器数"), String(((body[4] << 8) | body[5]) & 0xffff)]
    );
    if (body.length > 6) rows.push([tr("字节计数"), body[6] + " B"]);
  } else {
    rows.push([tr("数据区"), hexOf(body.slice(2))]);
  }
  return { rows, crcOK };
}

/** 自定义帧头帧：AA 55 + LEN + CMD + DATA + SUM */
export function customFrameBuild(data: number[], cmd = 0x81): number[] {
  const head = [0xaa, 0x55, data.length + 1, cmd, ...data];
  return [...head, head.reduce((a, b) => a + b, 0) & 0xff];
}

/** 累加和校验（取低 8 位） */
export function sum8(bytes: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s += bytes[i];
  return s & 0xff;
}

/** CRC-8（poly 0x07，init 0x00，常见于传感器/单总线） */
export function crc8(bytes: ArrayLike<number>): number {
  let crc = 0x00;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** CRC-16/CCITT-FALSE（poly 0x1021，init 0xFFFF，高字节在前） */
export function crc16ccitt(bytes: ArrayLike<number>): [number, number] {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return [(crc >> 8) & 0xff, crc & 0xff];
}

/** 发送校验工具：按所选算法返回应追加的校验字节 */
export type CrcMode = "none" | "sum8" | "crc8" | "crc16m" | "crc16ccitt";

export function appendCrc(bytes: number[], mode: CrcMode): number[] {
  switch (mode) {
    case "sum8":
      return [...bytes, sum8(bytes)];
    case "crc8":
      return [...bytes, crc8(bytes)];
    case "crc16m":
      return [...bytes, ...crc16Modbus(bytes)];
    case "crc16ccitt":
      return [...bytes, ...crc16ccitt(bytes)];
    default:
      return bytes;
  }
}

/* ── Modbus ASCII（: 开头 + HEX 文本 + LRC + CRLF） ── */

/** LRC：字节和取补（Modbus ASCII / 部分仪表协议） */
export function lrc(bytes: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s += bytes[i];
  return (-s) & 0xff;
}

const HEX_CHARS = "0123456789ABCDEF";

/** Modbus ASCII 组帧：返回 ASCII 字节流（含 : 头、LRC、\r\n 尾） */
export function modbusAsciiBuild(addrS: string, fnS: string, regS: string, valS: string): number[] {
  const rtu = modbusBuild(addrS, fnS, regS, valS).slice(0, -2); // 去 CRC
  const l = lrc(rtu);
  const chars = [0x3a]; // ':'
  for (const b of [...rtu, l]) chars.push(HEX_CHARS.charCodeAt(b >> 4), HEX_CHARS.charCodeAt(b & 15));
  chars.push(0x0d, 0x0a);
  return chars;
}

/** 从 HEX 文本对中还原字节；失败返回 null */
function hexDecodeChars(s: string): number[] | null {
  const t = s.replace(/[^0-9a-fA-F]/g, "");
  if (t.length < 2 || t.length % 2) return null;
  const out: number[] = [];
  for (let i = 0; i < t.length; i += 2) out.push(parseInt(t.slice(i, i + 2), 16));
  return out;
}

/** Modbus ASCII 解帧：验 LRC 后按 RTU 字段切分（不含 CRC 行，改为 LRC 行） */
export function modbusAsciiParse(bytes: number[]): ModbusParseResult {
  let s = bytes
    .map((b) => String.fromCharCode(b))
    .join("")
    .trim();
  if (!s.startsWith(":")) throw new Error(tr("帧应以 : 开始"));
  s = s.slice(1);
  const body = hexDecodeChars(s.slice(0, -2));
  const lrcGot = hexDecodeChars(s.slice(-2));
  if (!body || !lrcGot) throw new Error(tr("HEX 字符无效"));
  if (lrc(body) !== lrcGot[0])
    throw new Error(
      tr("LRC 校验失败") +
        "：" +
        chkFail(lrcGot[0].toString(16).padStart(2, "0").toUpperCase(), lrc(body).toString(16).padStart(2, "0").toUpperCase())
    );
  const r = modbusParse([...body, ...crc16Modbus(body)]);
  r.rows = r.rows.filter(([k]) => k !== tr("CRC 校验"));
  r.rows.splice(2, 0, [tr("LRC 校验"), `✓ ${lrcGot[0].toString(16).padStart(2, "0").toUpperCase()}`]);
  r.crcOK = true;
  return r;
}

/* ── DL/T 645-2007（电表规约：68 + 地址 + 68 + 控制码 + 数据 + CS + 16） ── */

/** DL/T 645 组帧；addr 为 12 位 BCD 地址文本，ctrl 控制码，di 为 4 字节数据标识文本 */
export function dlt645Build(addrS: string, ctrlS: string, diS: string): number[] {
  const addr = hexDecodeChars(addrS);
  const di = hexDecodeChars(diS);
  const ctrl = parseInt(ctrlS, 16);
  if (!addr || addr.length !== 6 || isNaN(ctrl) || !di)
    throw new Error(tr("地址需 12 位 HEX，数据标识需偶数位 HEX"));
  const body = [
    0x68,
    ...addr.slice().reverse(), // 地址低字节在前
    0x68,
    ctrl,
    di.length,
    ...di.slice().reverse(), // DI 低字节在前
  ];
  return [0x68, ...body.slice(1), sum8(body), 0x16];
}

/** DL/T 645 解帧：验结构 + CS */
export function dlt645Parse(bytes: number[]): ModbusParseResult {
  if (bytes.length < 12) throw new Error(tr("帧长不足 12 字节"));
  if (bytes[0] !== 0x68 || bytes[7] !== 0x68 || bytes[bytes.length - 1] !== 0x16)
    throw new Error(tr("帧头/帧尾不符（应为 68…68…16）"));
  const csGot = bytes[bytes.length - 2];
  const calc = sum8(bytes.slice(1, -2));
  const csOK = csGot === calc;
  const ctrl = bytes[8];
  const len = bytes[9];
  const data = bytes.slice(10, 10 + len);
  const rows: [string, string][] = [
    [tr("表地址"), hexOf(bytes.slice(1, 7).reverse())],
    [tr("控制码"), "0x" + ctrl.toString(16).padStart(2, "0") + (ctrl & 0x80 ? tr(" (异常应答)") : "")],
    [tr("数据长度"), len + " B"],
    [tr("数据区"), hexOf(data.slice().reverse())],
    [
      tr("CS 校验"),
      csOK
        ? `✓ ${csGot.toString(16).padStart(2, "0").toUpperCase()}`
        : chkFail(csGot.toString(16).padStart(2, "0").toUpperCase(), calc.toString(16).padStart(2, "0").toUpperCase()),
    ],
  ];
  return { rows, crcOK: csOK };
}

/* ── NMEA 0183（$ 开头 + * 异或校验 + CRLF） ── */

/** NMEA 组帧：sentence 如 "GNGLL"，fields 为逗号分隔内容；返回含 \r\n 的文本字节流 */
export function nmeaBuild(sentence: string, fieldsCsv: string): number[] {
  const body = sentence.replace(/^\$/, "") + "," + fieldsCsv;
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  const text = `$${body}*${x.toString(16).toUpperCase().padStart(2, "0")}\r\n`;
  return [...text].map((c) => c.charCodeAt(0) & 0xff);
}

/** NMEA 解帧：验异或校验并切分字段 */
export function nmeaParse(bytes: number[]): ModbusParseResult {
  const text = bytes.map((b) => String.fromCharCode(b)).join("").trim();
  const m = text.match(/^\$([^*]+)\*([0-9A-Fa-f]{2})$/);
  if (!m) throw new Error(tr("格式应为 $XXX…*HH"));
  const body = m[1];
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  const ok = x.toString(16).padStart(2, "0").toUpperCase() === m[2].toUpperCase();
  const fields = body.split(",");
  const rows: [string, string][] = [
    [tr("语句类型"), fields[0]],
    ...fields.slice(1).map((f, i): [string, string] => [tr("字段") + " " + (i + 1), f]),
    [
      tr("异或校验"),
      ok ? `✓ ${m[2].toUpperCase()}` : chkFail(m[2], x.toString(16).toUpperCase()),
    ],
  ];
  return { rows, crcOK: ok };
}

/* ── CANopen（SDO / PDO / NMT / 心跳等 COB-ID 识别与 SDO 生成） ── */

export interface CanopenParsed {
  kind: "NMT" | "SYNC" | "EMCY" | "TIME" | "PDO" | "SDO" | "HB" | "未知";
  node: string; // 节点 ID 文本（无节点语义为 "-"）
  label: string; // 命令/帧名
  detail: string; // 字段化说明（多行 \n 分隔）
}

const NMT_CS: Record<number, string> = {
  1: "Start Node（启动）",
  2: "Stop Node（停止）",
  128: "Reset Communication（通讯复位）",
  129: "Reset Node（节点复位）",
};

const HB_STATE: Record<number, string> = {
  0: "Boot-up（上电启动）",
  4: "Stopped（停止）",
  5: "Operational（运行）",
  127: "Pre-operational（预运行）",
};

/** 小端合并 d[from..] 共 n 字节 → 数值 */
function le(d: number[], from: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v += (d[from + i] ?? 0) * 2 ** (8 * i);
  return v;
}

function idxSub(d: number[]): string {
  return "0x" + (d[2] * 256 + d[1]).toString(16).padStart(4, "0") + ":" + (d[3] ?? 0).toString(16).padStart(2, "0");
}

/** SDO 命令说明符 → 描述（expedited 常用值） */
function sdoCmd(cc: number, dir: "req" | "res"): { label: string; size?: number; abort?: boolean } {
  if (cc === 0x80)
    return { label: dir === "req" ? tr("SDO Abort（客户端中止）") : tr("SDO Abort（服务器中止）"), abort: true };
  if (dir === "req") {
    if (cc === 0x40) return { label: tr("Initiate Upload Request（读请求）") };
    if ((cc & 0xe0) === 0x20 && cc & 0x02 && cc & 0x01)
      return { label: tr("Initiate Download Request（写请求，快速传输）"), size: 4 - ((cc >> 2) & 3) };
    if (cc & 0x20) return { label: `${tr("段写")} (toggle=${(cc >> 4) & 1})` };
    if ((cc & 0xe0) === 0x60 || cc === 0x60)
      return { label: tr("Initiate Upload Response（读应答）"), size: 4 - ((cc >> 2) & 3) };
    return { label: `${tr("SDO 命令")} 0x${cc.toString(16).padStart(2, "0")}` };
  }
  // 应答方向
  if (cc === 0x60) return { label: tr("Initiate Download Response（写确认）") };
  if (cc === 0x41) return { label: tr("Initiate Upload Response（启动段读）") };
  if (cc === 0x43 || cc === 0x4b || cc === 0x4f)
    return { label: tr("Initiate Upload Response（读应答，快速传输）"), size: 4 - ((cc >> 2) & 3) };
  if (cc === 0x4a || cc === 0x4e)
    return { label: tr("Initiate Upload Response（读应答）"), size: cc === 0x4e ? 1 : 2 };
  if (cc & 0x20) return { label: `${tr("段读应答")} (toggle=${(cc >> 4) & 1})` };
  if (cc === 0x60) return { label: tr("Segment Download Response（段写确认）") };
  return { label: `${tr("SDO 命令")} 0x${cc.toString(16).padStart(2, "0")}` };
}

/** PDO 编号：COB-ID → "TPDOx/RPDOx" */
function pdoName(cobId: number): string {
  const fn = (cobId >> 7) & 0xf;
  const map: Record<number, string> = {
    3: "TPDO1",
    4: "RPDO1",
    5: "TPDO2",
    6: "RPDO2",
    7: "TPDO3",
    8: "RPDO3",
    9: "TPDO4",
    10: "RPDO4",
  };
  return map[fn] ?? "PDO";
}

/** CANopen 帧解析：cobId（0-0x7FF）+ 数据字节 */
export function canopenParse(cobId: number, d: number[]): CanopenParsed {
  const hx = (v: number, w = 2) => v.toString(16).padStart(w, "0").toUpperCase();
  if (cobId === 0x000) {
    const cs = NMT_CS[d[0]] ? tr(NMT_CS[d[0]]) : `${tr("未知命令")} 0x${hx(d[0])}`;
    return {
      kind: "NMT",
      node: d[1] === 0 ? tr("所有节点") : String(d[1]),
      label: tr("网络管理"),
      detail: `${tr("命令")}: ${cs}\n${tr("目标节点")}: ${d[1] === 0 ? "0 (" + tr("全体") + ")" : d[1]}`,
    };
  }
  if (cobId === 0x080)
    return { kind: "SYNC", node: "-", label: tr("同步帧"), detail: `${tr("同步计数器")}: ${d.length ? d[0] : tr("无")}` };
  if (cobId >= 0x081 && cobId <= 0x0ff) {
    const eec = le(d, 1, 2);
    return {
      kind: "EMCY",
      node: String(cobId - 0x80),
      label: tr("紧急报文"),
      detail: `${tr("错误代码")}: 0x${hx(eec, 4)}\n${tr("错误寄存器")}: 0x${hx(d[0])}\n${tr("厂商区")}: ${hexOf(d.slice(3)) || "-"}`,
    };
  }
  if (cobId === 0x100)
    return { kind: "TIME", node: "-", label: tr("时间戳"), detail: `${tr("时刻")}: ${hexOf(d) || "-"}` };
  if (cobId >= 0x180 && cobId <= 0x57f) {
    const data = d.slice(0, 8);
    return {
      kind: "PDO",
      node: String(cobId & 0x7f),
      label: pdoName(cobId),
      detail: `${tr("过程数据")} (${data.length} B): ${hexOf(data) || "-"}\n${tr("十进制")}: ${data.join(" ")}`,
    };
  }
  if (cobId >= 0x580 && cobId <= 0x5ff) {
    const node = cobId - 0x580;
    const c = sdoCmd(d[0], "res");
    const n = c.size ?? 4;
    const v = le(d, 4, n);
    return {
      kind: "SDO",
      node: String(node),
      label: c.label,
      detail: c.abort
        ? `${tr("中止代码")}: 0x${hx(le(d, 4, 4), 8)}`
        : `${tr("对象字典")}: ${idxSub(d)}\n${tr("数据")} (${n} B): 0x${hx(v, n * 2)}（DEC ${v}）`,
    };
  }
  if (cobId >= 0x600 && cobId <= 0x67f) {
    const node = cobId - 0x600;
    const c = sdoCmd(d[0], "req");
    const n = c.size ?? 4;
    const v = le(d, 4, n);
    return {
      kind: "SDO",
      node: String(node),
      label: c.label,
      detail: c.abort
        ? `${tr("中止代码")}: 0x${hx(le(d, 4, 4), 8)}`
        : `${tr("对象字典")}: ${idxSub(d)}\n${tr("数据")} (${n} B): 0x${hx(v, n * 2)}（DEC ${v}）`,
    };
  }
  if (cobId >= 0x700 && cobId <= 0x77f) {
    const st = HB_STATE[d[0]] ? tr(HB_STATE[d[0]]) : `0x${hx(d[0])}`;
    return { kind: "HB", node: String(cobId - 0x700), label: tr("心跳"), detail: `${tr("设备状态")}: ${st}` };
  }
  return {
    kind: "未知",
    node: String(cobId & 0x7f),
    label: `COB-ID 0x${hx(cobId, 3)}`,
    detail: `${tr("原始数据")}: ${hexOf(d) || "-"}`,
  };
}

/** SDO 生成：读写对象字典，val 为原始小端字节（读时空） */
export function sdoBuild(node: number, read: boolean, index: number, sub: number, val?: number[]): { cobId: number; data: number[] } {
  if (node < 1 || node > 127) throw new Error(tr("节点 ID 范围 1-127"));
  if (index < 0 || index > 0xffff) throw new Error(tr("Index 范围 0x0000-0xFFFF"));
  const cobId = read ? 0x600 + node : 0x600 + node;
  const head = [index & 0xff, (index >> 8) & 0xff, sub & 0xff];
  if (read) return { cobId, data: [0x40, ...head, 0, 0, 0, 0] };
  const n = val?.length ?? 0;
  if (![1, 2, 4].includes(n)) throw new Error(tr("写值长度须为 1/2/4 字节"));
  const cc = n === 1 ? 0x2f : n === 2 ? 0x2b : 0x23;
  const pad = [0, 0, 0, 0].slice(0, 4 - n);
  return { cobId, data: [cc, ...head, ...(val ?? []), ...pad] };
}

/** 读应答生成（模拟从站快速应答，val 1/2/4 字节小端） */
export function sdoRespBuild(node: number, index: number, sub: number, val: number[]): { cobId: number; data: number[] } {
  const n = val.length;
  if (![1, 2, 4].includes(n)) throw new Error(tr("应答值长度须为 1/2/4 字节"));
  const cc = { 1: 0x4f, 2: 0x4b, 4: 0x43 }[n]!;
  return {
    cobId: 0x580 + node,
    data: [cc, index & 0xff, (index >> 8) & 0xff, sub & 0xff, ...val],
  };
}
