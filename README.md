# LinkLab · Communication Debugger

<p align="center">
  <img src="docs/screenshots/en-serial.png" width="860" alt="LinkLab serial monitor (English UI)">
</p>

**[中文说明 / Chinese](README_CN.md)**

**LinkLab** is a cross-platform communication debugger for embedded development, covering **Serial UART / CAN bus / TCP-UDP network / MQTT**, with a built-in protocol factory (Modbus, CANopen, DL/T 645, NMEA, etc.) and periodic-send queues.

Rewritten from a single-file HTML prototype into a **React 18 + TypeScript + Tauri 2 (Rust)** desktop app — small binaries, fast startup, low memory. Ships with **dark / light themes** and a **bilingual (中文 / English) UI**.

## Features

| Channel | Capabilities |
|---|---|
| **Serial UART** | Any baud rate (1200 ~ 2000000) + 17 presets, USB hot-plug enumeration, full data/stop/parity/flow control, frame splitting by gap / CRLF / raw stream |
| **CAN bus** | socketCAN (auto-detected can0 / vcan0), standard / extended / RTR frames, hardware ID filtering, CANopen frame parsing |
| **TCP / UDP** | TCP client / TCP server (multi-client) / UDP client / UDP server; the server auto-replies to the latest peer |
| **MQTT** | Publish / subscribe, topic filtering, QoS, JSON demo stream |

**Protocol factory** (bidirectional frame build & parse with real checksum algorithms):
- Modbus RTU (CRC16) · Modbus ASCII (LRC) · Modbus TCP (MBAP)
- CANopen (field-level parsing of NMT / SDO / PDO / EMCY / heartbeat, plus SDO request builder)
- DL/T 645-2007 (Chinese smart-meter protocol, CS checksum) · NMEA 0183 (XOR checksum)
- SLIP escaping · Custom header frame (SUM checksum)

**Productivity tools**:
- Periodic send queue per channel: toggle / countdown / cyclic firing
- Right-click any line → pick a protocol → field-by-field parse popup (with checksum-mismatch location)
- CRC utility: SUM-8 / CRC-8 / CRC16-Modbus / CRC16-CCITT, auto-appended on send
- Data export via native "Save As" dialog: timestamp + HEX + ASCII columns; merged 4-console session export
- Dark / light theme + 5 accent colors + 中文 / English UI, all persisted

## Screenshots

### Serial monitor — dark / light

| Dark | Light |
|---|---|
| ![serial](docs/screenshots/serial.png) | ![light-serial](docs/screenshots/light-serial.png) |

### CAN bus — dark / light

| Dark | Light |
|---|---|
| ![can](docs/screenshots/can.png) | ![light-can](docs/screenshots/light-can.png) |

### TCP / UDP — dark / light

| Dark | Light |
|---|---|
| ![net](docs/screenshots/net.png) | ![light-net](docs/screenshots/light-net.png) |

### MQTT — dark / light

| Dark | Light |
|---|---|
| ![mqtt](docs/screenshots/mqtt.png) | ![light-mqtt](docs/screenshots/light-mqtt.png) |

### Protocol factory — dark / light

| Dark | Light |
|---|---|
| ![proto](docs/screenshots/proto.png) | ![light-proto](docs/screenshots/light-proto.png) |

### Settings (light) & English UI

| Settings (light) | English UI (dark) |
|---|---|
| ![light-settings](docs/screenshots/light-settings.png) | ![en-serial](docs/screenshots/en-serial.png) |

## Architecture

```
┌─ Frontend React 18 + TS ────────┐  IPC (20ms batch)  ┌─ Backend Tauri 2 / Rust ┐
│ 6 pages · consoles · proto lab  │ ←─────────────────→ │ serialport   serial      │
│ store · i18n · theming          │  frame-batch event  │ tokio        TCP/UDP     │
│ protocol algorithms (CRC/…)     │  invoke commands    │ rumqttc      MQTT        │
│ mock engine (auto fallback)     │                     │ socketcan    CAN (Linux) │
└─────────────────────────────────┘                     └──────────────────────────┘
```

- The backend only moves bytes and **splits frames** (gap / CRLF / fixed-length / MBAP); protocol parsing stays in the frontend as a single implementation.
- **Dual mode**: real IO when packaged; the browser preview (`pnpm dev`) automatically falls back to a mock engine. Mock can also be forced in Settings.
- **High performance**: 20 ms batched IPC + batched rendering + DOM windowing keeps the UI responsive at ~10 k frames/s, with an auto-pause guard against data floods.
- Config and queues persist locally (localStorage) and restore on restart.

## Development

```bash
pnpm install
pnpm dev          # browser preview (mock mode)
pnpm app:dev      # Tauri desktop dev (real IO, Rust toolchain required)
```

## Packaging & Release

```bash
pnpm app:build    # local build, output in src-tauri/target/release/bundle
```

| Platform | Artifacts |
|---|---|
| Linux | `.deb` · `.AppImage` |
| Windows | `.exe` (NSIS installer) · `.msi` |
| macOS | `.dmg` (universal: Apple Silicon + Intel) |

**CI**: pushing a `v*` tag builds all three platforms and publishes a GitHub Release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

See [.github/workflows/build.yml](.github/workflows/build.yml).
