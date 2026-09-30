/**
 * 模拟引擎（演示态，与 DESIGN.md §6 一致）
 * 浏览器开发态或「模拟模式」开启时接管通道：
 * - 串口: 1.2s 温度传感器帧；2.6s Modbus 请求 + 90ms 从站应答
 * - CAN:  3 个 ID 不同周期混流
 * - 网络: 1.8s Modbus TCP MBAP 帧
 * - MQTT: 1.5s 随机主题 JSON 推送
 */
import { type ChannelId, type ConsoleId } from "./store";
import { pushLine, consoleStores } from "./consoles";
import { crc16Modbus, modbusBuild } from "./protocols";
import { hexOf, asciiOf } from "./bytes";
import { echoTx, fmtSegs, type SendMeta } from "./bridge";

const timers: Record<ChannelId, number[]> = { serial: [], can: [], net: [], mqtt: [] };

export function mockPorts() {
  return [
    { name: "COM3", desc: "USB-SERIAL CH340" },
    { name: "COM7", desc: "CP2102" },
    { name: "/dev/ttyUSB0", desc: "FT232 USB-Serial" },
    { name: "/dev/ttyACM0", desc: "CDC ACM" },
  ];
}

function stopTimers(id: ChannelId) {
  timers[id].forEach((t) => {
    clearInterval(t);
    clearTimeout(t);
  });
  timers[id] = [];
}

export function stopMock(id: ChannelId) {
  stopTimers(id);
}

function segs(cid: ConsoleId, bytes: number[]) {
  return fmtSegs(bytes, consoleStores[cid].get().fmt);
}

export function startMock(id: ChannelId, cfg: unknown) {
  stopTimers(id);
  if (id === "serial") startSerial();
  else if (id === "can") startCan();
  else if (id === "net") startNet(cfg);
  else if (id === "mqtt") startMqtt();
}

/* ── 串口 ── */
function startSerial() {
  const a = setInterval(() => {
    const t = Math.round(24 + Math.random() * 4);
    const b = [0xaa, 0x55, 0x01, t, 0x01, (0xaa + 0x55 + 0x01 + t + 0x01) & 0xff];
    pushLine("sp", "rx", "RX ◀", segs("sp", b), { data: b });
  }, 1200);
  const b = setInterval(() => {
    const req = modbusBuild("01", "03", "0000", "0002");
    echoTx("serial", req, { note: "← CRC16 自动附加" });
    setTimeout(() => {
      const body = [0x01, 0x03, 0x04, 0x02, 0x92, 0xff, 0x00];
      pushLine("sp", "rx", "RX ◀", segs("sp", [...body, ...crc16Modbus(body)]), {
        data: [...body, ...crc16Modbus(body)],
      });
    }, 90);
  }, 2600);
  timers.serial = [a, b];
}

/* ── CAN ── */
function startCan() {
  const gen: [number, () => number[]][] = [
    [0x181, () => [0x01, (Math.random() * 256) | 0, 0xf4, 0x00, 0, 0, 0, 0]],
    [0x183, () => [0x7f, (Math.random() * 0xff) | 0, (Math.random() * 0xff) | 0, 0x12]],
    [0x203, () => [0x50, 0xc3, 0x00, 0x00]],
  ];
  timers.can = gen.map(([id, g], i) =>
    setInterval(() => {
      const d = g();
      pushLine(
        "can",
        "rx",
        "RX ◀",
        [
          {
            text: "0x" + id.toString(16).toUpperCase().padStart(3, "0"),
            color: "var(--purple)",
            bold: true,
          },
          { text: ` [${d.length}] ${hexOf(d)}  "${asciiOf(d)}"` },
        ],
        { data: d, canId: id }
      );
    }, 700 + i * 450)
  );
}

/* ── 网络 ── */
function startNet(cfg: unknown) {
  const c = (cfg ?? {}) as { mode?: string; host?: string; port?: number };
  const mode = (c.mode ?? "tcp").toUpperCase();
  const addr = `${c.host ?? "192.168.1.100"}:${c.port ?? 502}`;
  const t = setInterval(() => {
    const mbap = [
      0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 0x01, 0x03, 0x02, (Math.random() * 256) | 0,
      (Math.random() * 256) | 0,
    ];
    pushLine(
      "net",
      "rx",
      "RX ◀",
      [{ text: `[${mode} ${addr}] `, color: "var(--txt3)" }, ...segs("net", mbap)],
      { data: mbap }
    );
  }, 1800);
  timers.net = [t];
}

/* ── MQTT ── */
function startMqtt() {
  const topics = [
    "factory/line1/dev01/temp",
    "factory/line1/dev02/temp",
    "home/sensor/living/humidity",
  ];
  const t = setInterval(() => {
    const tp = topics[(Math.random() * topics.length) | 0];
    const pl = JSON.stringify({ v: +(20 + Math.random() * 10).toFixed(1), ts: Date.now() });
    pushLine(
      "mq",
      "rx",
      "RX ◀",
      [
        { text: tp, color: "var(--purple)", bold: true },
        { text: "\n    " + pl },
      ],
      { data: [...pl].map((c) => c.charCodeAt(0) & 0xff) }
    );
  }, 1500);
  timers.mqtt = [t];
}

/* ── 模拟发送 ── */
export function mockSend(id: ChannelId, bytes: number[], meta?: SendMeta) {
  echoTx(id, bytes, meta);
  if (id === "serial" && bytes.length >= 4 && bytes.length <= 32) {
    // 看起来像 Modbus 请求且 CRC 正确 → 模拟从站应答
    const body = bytes.slice(0, -2);
    const [lo, hi] = crc16Modbus(body);
    if (lo === bytes[bytes.length - 2] && hi === bytes[bytes.length - 1]) {
      const fn = body[1];
      let resp: number[] | null = null;
      if (fn >= 0x01 && fn <= 0x04 && body.length >= 6) {
        const n = Math.min(((body[4] << 8) | body[5]) & 0xffff, 8) * 2;
        resp = [body[0], fn, n, ...Array.from({ length: n }, () => (Math.random() * 256) | 0)];
      } else if (fn >= 0x05 && fn <= 0x06 && body.length >= 6) {
        resp = body.slice(0, 6);
      }
      if (resp) {
        const r = resp;
        setTimeout(() => {
          pushLine("sp", "rx", "RX ◀", segs("sp", [...r, ...crc16Modbus(r)]), {
            data: [...r, ...crc16Modbus(r)],
          });
        }, 90);
      }
    }
  }
}
