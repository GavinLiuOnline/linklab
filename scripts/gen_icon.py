#!/usr/bin/env python3
"""生成 LinkLab 应用图标源图（1024x1024 PNG，纯标准库实现）。
深色圆角底 + 琥珀脉冲折线，与 UI logo 一致。
输出: src-tauri/icons/source.png
"""
import math
import struct
import sys
import zlib
from pathlib import Path

S = 1024
R = 220  # 圆角半径
BG_TOP = (26, 33, 43)      # #1a212b
BG_BOT = (15, 18, 22)      # #0f1216
AMBER_A = (245, 166, 35)   # #f5a623
AMBER_B = (255, 138, 61)   # #ff8a3d
HALF = 26.0                # 线宽半径

# 脉冲折线：M4 12h3l2-5 3 10 2-5h6 → 24 坐标映射到画布
PTS = [(4, 12), (7, 12), (9, 7), (12, 17), (14, 12), (20, 12)]
SCALE = 34.0
OX = S / 2 - 12 * SCALE
OY = S / 2 - 12 * SCALE
SEGS = [(PTS[i], PTS[i + 1]) for i in range(len(PTS) - 1)]


def dist_seg(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    t = max(0.0, min(1.0, (vx * wx + vy * wy) / (vx * vx + vy * vy or 1.0)))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return math.hypot(dx, dy)


def smooth(d):
    """1 in core, 0 outside, 平滑过渡 2px 抗锯齿"""
    if d <= -1:
        return 1.0
    if d >= 1:
        return 0.0
    return 0.5 * (1.0 - d)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "src-tauri/icons/source.png")
    out.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    for y in range(S):
        row = bytearray([0])  # filter: none
        ty = y / S
        for x in range(S):
            # 圆角矩形 mask（SDF）
            cx = min(max(x, R), S - R) - x
            cy = min(max(y, R), S - R) - y
            d_rect = math.hypot(cx, cy) - R
            a_rect = smooth(d_rect / 2.0)
            if a_rect <= 0:
                row += b"\x00\x00\x00\x00"
                continue
            # 背景渐变
            t = y / S
            bg = tuple(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t for i in range(3))
            # 琥珀折线 mask：画布像素 → 24 空间坐标
            px, py = (x - OX) / SCALE, (y - OY) / SCALE
            d24 = min(dist_seg(px, py, a[0], a[1], b[0], b[1]) for a, b in SEGS)
            d_pix = d24 * SCALE - HALF  # 24 空间距离换算回像素再减线宽半径
            a_line = smooth(d_pix / 2.0)
            # 线上渐变色（沿折线 y 方向 7→17）
            tg = (py - 7.0) / 10.0
            line = tuple(AMBER_A[i] + (AMBER_B[i] - AMBER_A[i]) * max(0.0, min(1.0, tg)) for i in range(3))
            a_line = max(0.0, min(1.0, a_line))
            r_ = int(bg[0] * (1 - a_line) + line[0] * a_line)
            g_ = int(bg[1] * (1 - a_line) + line[1] * a_line)
            b_ = int(bg[2] * (1 - a_line) + line[2] * a_line)
            alpha = int(a_rect * 255)
            row += bytes((r_, g_, b_, alpha))
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    out.write_bytes(png)
    print(f"icon written: {out} ({len(png)} bytes)")


if __name__ == "__main__":
    main()
