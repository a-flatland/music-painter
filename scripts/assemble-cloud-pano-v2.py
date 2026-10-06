from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/images/cloud-layers-pano-v2"
ORIGINAL = ROOT / "public/images/cloud-layers"
PATCHES = ROOT / "public/images/codex/cloud-pano-v3-reference/seam-repair-patches"
WIDTH, HEIGHT = 8688, 724
PANEL_WIDTH = 2172
PATCH_WIDTH = 2172
SEAMS = (2172, 4344, 6516)

LAYERS = (
    ("01-background-sky-sun-pano.png", "01-background-sky-sun.png"),
    ("02-far-middle-clouds-pano.png", "02-far-middle-clouds.png"),
    ("03-near-middle-clouds-pano.png", "03-near-middle-clouds.png"),
    ("04-foreground-clouds-pano.png", "04-foreground-clouds.png"),
)


def smoothstep(values: np.ndarray) -> np.ndarray:
    return values * values * (3.0 - 2.0 * values)


def repair_mask(seam_number: int) -> np.ndarray:
    x = np.arange(PATCH_WIDTH, dtype=np.float32)
    weight = np.zeros(PATCH_WIDTH, dtype=np.float32)
    entering = (x >= 350) & (x < 600)
    weight[entering] = smoothstep((x[entering] - 350) / 250)
    if seam_number < 3:
        weight[(x >= 600) & (x <= 1572)] = 1.0
        leaving = (x > 1572) & (x <= 1822)
        weight[leaving] = 1.0 - smoothstep((x[leaving] - 1572) / 250)
    else:
        # The fourth/rightmost panel is immutable; repair only the extension side.
        weight[(x >= 600) & (x < 1086)] = 1.0
    return np.broadcast_to(weight[None, :, None], (HEIGHT, PATCH_WIDTH, 1))


def blend_patch(base: Image.Image, patch: Image.Image, seam_x: int, seam_number: int) -> None:
    patch = patch.convert("RGBA").resize((PATCH_WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    x0 = seam_x - PATCH_WIDTH // 2
    old = base.crop((x0, 0, x0 + PATCH_WIDTH, HEIGHT))
    a = np.asarray(old).astype(np.float32) / 255.0
    b = np.asarray(patch).astype(np.float32) / 255.0
    w = repair_mask(seam_number)
    alpha = a[:, :, 3:4] * (1.0 - w) + b[:, :, 3:4] * w
    premul = a[:, :, :3] * a[:, :, 3:4] * (1.0 - w)
    premul += b[:, :, :3] * b[:, :, 3:4] * w
    rgb = np.where(alpha > 1e-6, premul / np.maximum(alpha, 1e-6), 0.0)
    merged = np.concatenate((rgb, alpha), axis=2)
    base.paste(Image.fromarray(np.clip(merged * 255, 0, 255).astype(np.uint8), "RGBA"), (x0, 0))


for layer_number, (pano_name, original_name) in enumerate(LAYERS, start=1):
    pano = Image.open(OUT / pano_name).convert("RGBA")
    for seam_number, seam_x in enumerate(SEAMS, start=1):
        patch = Image.open(PATCHES / f"fixed-{layer_number:02d}-seam-{seam_number}.png")
        blend_patch(pano, patch, seam_x, seam_number)

    # Guarantee the user's locked right quarter is byte-for-byte pixel-identical.
    original = Image.open(ORIGINAL / original_name).convert("RGBA")
    pano.paste(original, (3 * PANEL_WIDTH, 0))
    if layer_number == 1:
        pano.convert("RGB").save(OUT / pano_name, optimize=True)
    else:
        pano.save(OUT / pano_name, optimize=True)

preview = Image.open(OUT / LAYERS[0][0]).convert("RGBA")
for pano_name, _ in LAYERS[1:]:
    preview.alpha_composite(Image.open(OUT / pano_name).convert("RGBA"))
preview.convert("RGB").save("/private/tmp/cloud-pano-v2-final-preview.jpg", quality=96)
