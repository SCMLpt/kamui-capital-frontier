"""Render a captioned demo from the verified Arbitrum Sepolia report.

This is an edited visualization of actual CLI/RPC output, not a live recording
or a claim that a genuine Safe has been tested.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "outputs/Arbitrum-Open-House-2026-09-25"
REPORT = json.loads((OUT / "testnet-demo-report-cli.json").read_text())
DEPLOY = json.loads((OUT / "testnet-demo-deployment.json").read_text())
WIDTH, HEIGHT = 1280, 720
BG = (7, 13, 24)
PANEL = (15, 27, 43)
WHITE = (237, 245, 250)
MUTED = (150, 172, 189)
GREEN = (139, 255, 127)
BLUE = (101, 197, 255)
ORANGE = (255, 181, 94)
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
MONO = "/System/Library/Fonts/Menlo.ttc"


def f(size: int, mono: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(MONO if mono else FONT, size)


def text(draw, xy, value, size=26, color=WHITE, mono=False):
    draw.text(xy, value, fill=color, font=f(size, mono))


def base(step: str, title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 10), fill=GREEN)
    text(draw, (56, 35), "KAMUI / CAPITAL FRONTIER", 22, GREEN, True)
    text(draw, (1040, 35), step, 20, MUTED, True)
    text(draw, (56, 110), title, 56)
    text(draw, (60, 192), subtitle, 25, MUTED)
    draw.line((60, 652, 1220, 652), fill=(55, 77, 96), width=2)
    text(draw, (60, 670), "ARBITRUM SEPOLIA  /  READ-ONLY RESEARCH PROTOTYPE", 18, MUTED, True)
    return image, draw


def panel(draw, box=(58, 270, 1222, 614)):
    draw.rounded_rectangle(box, radius=20, fill=PANEL, outline=(45, 67, 84), width=2)


def save(image, number: int) -> Path:
    path = OUT / f"demo-frame-{number:02d}.png"
    image.save(path)
    return path


def main() -> None:
    assert REPORT["chainId"] == "421614"
    assert [x["fundedPrefix"] for x in REPORT["scenarioResults"]] == [3, 2]
    assert REPORT["safe"].lower() == DEPLOY["syntheticAccount"].lower()
    assert REPORT["checker"].lower() == DEPLOY["checker"].lower()
    frames = []

    im, d = base("01 / 06", "How far can a batch go?",
                 "A reproducible cash-buffer frontier before any signature")
    panel(d)
    text(d, (95, 315), "Batch: 4 proposed calls", 36)
    text(d, (95, 380), "Scenario A: normal outflows", 30, BLUE)
    text(d, (95, 435), "Scenario B: 110% outflows + larger fee reserve", 30, ORANGE)
    text(d, (95, 545), "No wallet connection. No transaction execution.", 25, GREEN)
    frames.append(save(im, 1))

    im, d = base("02 / 06", "Actual testnet deployment",
                 "The view contract is live on chain ID 421614")
    panel(d)
    text(d, (95, 310), "CapitalFrontierView", 31, BLUE)
    text(d, (95, 375), DEPLOY["checker"], 31, WHITE, True)
    text(d, (95, 460), "Receipt: success  |  Runtime: 2,691 bytes", 29, GREEN)
    text(d, (95, 535), "Onchain runtime matches the local Solidity compile", 25, MUTED)
    frames.append(save(im, 2))

    im, d = base("03 / 06", "One fixed-block eth_call",
                 "The adapter reads onchain balances without signing")
    panel(d)
    text(d, (95, 310), "$ node scripts/inspect-batch.mjs", 29, GREEN, True)
    text(d, (95, 367), "--rpc https://sepolia-rollup.arbitrum.io/rpc", 27, WHITE, True)
    text(d, (95, 420), "--contract 0x02b3Ee4...Fe119", 27, WHITE, True)
    text(d, (95, 473), f"blockNumber: {REPORT['blockNumber']}", 27, BLUE, True)
    text(d, (95, 540), "Output: reproducible JSON frontier report", 25, MUTED)
    frames.append(save(im, 3))

    im, d = base("04 / 06", "Nominal frontier: 3 / 4",
                 "0.0009 valueless test ETH in a synthetic fixture")
    panel(d)
    for i in range(4):
        x = 95 + i * 280
        good = i < 3
        d.rounded_rectangle((x, 315, x + 230, 465), radius=18,
                            fill=(25, 62, 52) if good else (76, 55, 33))
        text(d, (x + 21, 345), f"CALL {i+1}", 25, GREEN if good else ORANGE, True)
        text(d, (x + 20, 400), "FUNDED" if good else "UNKNOWN", 25)
    text(d, (95, 540), "Fourth arbitrary call stops the reviewable prefix.", 27, MUTED)
    frames.append(save(im, 4))

    im, d = base("05 / 06", "Stress frontier: 2 / 4",
                 "110% outflow assumption + a larger native fee reserve")
    panel(d)
    for i in range(4):
        x = 95 + i * 280
        good = i < 2
        d.rounded_rectangle((x, 315, x + 230, 465), radius=18,
                            fill=(25, 62, 52) if good else (76, 55, 33))
        text(d, (x + 21, 345), f"CALL {i+1}", 25, GREEN if good else ORANGE, True)
        text(d, (x + 20, 400), "FUNDED" if good else "STOP", 25)
    text(d, (95, 540), "Third call causes a modeled shortfall.", 27, ORANGE)
    frames.append(save(im, 5))

    im, d = base("06 / 06", "Conservative by design",
                 "A decision aid for reviewers, never an execution guarantee")
    panel(d)
    text(d, (95, 308), "Fixture is Safe-shaped mock code, not an authentic Safe.", 27, ORANGE)
    text(d, (95, 370), "Token behavior, side effects and real gas are unverified.", 27)
    text(d, (95, 432), "Unknown calls stop the prefix instead of passing.", 27, GREEN)
    text(d, (95, 534), "No customer assets or mainnet fees were used.", 25, MUTED)
    frames.append(save(im, 6))

    concat = OUT / "demo-concat.txt"
    durations = [8, 9, 11, 10, 10, 10]
    lines = []
    for path, duration in zip(frames, durations):
        lines.extend([f"file '{path.name}'", f"duration {duration}"])
    lines.append(f"file '{frames[-1].name}'")
    concat.write_text("\n".join(lines) + "\n")
    video = OUT / "Kamui-Arbitrum-Capital-Frontier-58s-demo.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-safe", "0", "-f", "concat", "-i", str(concat), "-vf", "fps=30,format=yuv420p",
        "-t", str(sum(durations)), "-c:v", "libx264", "-preset", "medium", "-crf", "22",
        "-movflags", "+faststart", str(video)], check=True)
    print(video)


if __name__ == "__main__":
    main()
