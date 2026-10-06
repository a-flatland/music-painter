from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_LAYERS = ROOT / "public/images/cloud-layers"
SOURCE_PANOS = ROOT / "public/images/cloud-layers-pano-v2"
OUT = ROOT / "public/images/cloud-layers-pano-v3"
GRADED = OUT / "first-scene-graded"
SEAM_PATCHES = ROOT / "public/images/codex/cloud-pano-v3-reference/seam-repair-patches"
PANEL_WIDTH = 2172

LAYERS = (
    ("01-background-sky-sun.png", "01-background-sky-sun-pano.png"),
    ("02-far-middle-clouds.png", "02-far-middle-clouds-pano.png"),
    ("03-near-middle-clouds.png", "03-near-middle-clouds-pano.png"),
    ("04-foreground-clouds.png", "04-foreground-clouds-pano.png"),
)


def smoothstep(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def grade_with_strength(image: Image.Image, spatial_strength: np.ndarray) -> Image.Image:
    """Lift blue-violet shadows toward the neighboring lavender cloud palette."""
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3:4]
    luminance = (
        rgb[:, :, 0:1] * 0.2126
        + rgb[:, :, 1:2] * 0.7152
        + rgb[:, :, 2:3] * 0.0722
    )

    # Preserve near-white/gold highlights while gently warming and lifting the
    # blue-violet shadow paint that otherwise forms a dark color wall at the join.
    shadow_weight = 1.0 - smoothstep((luminance - 0.48) / 0.42)
    midtone_weight = 1.0 - np.abs(np.clip((luminance - 0.55) / 0.45, -1.0, 1.0))
    strength = spatial_strength * (0.20 + 0.80 * shadow_weight)

    neutral = luminance + (rgb - luminance) * (1.0 - 0.04 * spatial_strength)
    lavender_target = np.array([0.72, 0.63, 0.80], dtype=np.float32)[None, None, :]
    lift = 0.48 * spatial_strength * shadow_weight
    neutral = neutral * (1.0 - lift) + lavender_target * lift
    shift = np.concatenate(
        (
            0.055 * shadow_weight + 0.018 * midtone_weight,
            0.028 * shadow_weight + 0.010 * midtone_weight,
            0.018 * shadow_weight + 0.005 * midtone_weight,
        ),
        axis=2,
    )
    graded = np.clip(neutral + shift * strength, 0.0, 1.0)

    # Do not alter fully transparent RGB pixels or any alpha value.
    graded = np.where(alpha > 0.0, graded, rgb)
    result = np.concatenate((graded, alpha), axis=2)
    return Image.fromarray(np.rint(result * 255.0).astype(np.uint8), "RGBA")


def grade_panel(image: Image.Image) -> Image.Image:
    # Strongest beside the pale extension, then settle into a subtle whole-panel
    # grade so the sun remains the visual anchor of the opening scene.
    x = np.linspace(0.0, 1.0, image.width, dtype=np.float32)[None, :, None]
    spatial_strength = 0.16 + 0.84 * (1.0 - smoothstep(np.minimum(x / 0.72, 1.0)))
    return grade_with_strength(image, spatial_strength)


def grade_neighbor_shoulder(image: Image.Image) -> Image.Image:
    # Feather the same treatment into the preceding panel so the join cannot
    # expose a one-pixel color boundary.
    shoulder = 900
    x = np.linspace(0.0, 1.0, shoulder, dtype=np.float32)[None, :, None]
    strength = 0.16 * smoothstep(x)
    result = image.convert("RGBA")
    crop = result.crop((result.width - shoulder, 0, result.width, result.height))
    result.paste(grade_with_strength(crop, strength), (result.width - shoulder, 0))
    return result


def blend_seam_patch(base: Image.Image, patch: Image.Image) -> None:
    """Blend the already-painted native-res bridge across both sides of the join."""
    patch = patch.convert("RGBA")
    x = np.arange(patch.width, dtype=np.float32)
    weight = np.zeros(patch.width, dtype=np.float32)
    entering = (x >= 350) & (x < 600)
    weight[entering] = smoothstep((x[entering] - 350) / 250)
    weight[(x >= 600) & (x <= 1572)] = 1.0
    leaving = (x > 1572) & (x <= 1822)
    weight[leaving] = 1.0 - smoothstep((x[leaving] - 1572) / 250)
    weight = np.broadcast_to(weight[None, :, None], (patch.height, patch.width, 1))

    x0 = 3 * PANEL_WIDTH - patch.width // 2
    old = np.asarray(base.crop((x0, 0, x0 + patch.width, patch.height)), dtype=np.float32) / 255.0
    new = np.asarray(patch, dtype=np.float32) / 255.0
    alpha = old[:, :, 3:4] * (1.0 - weight) + new[:, :, 3:4] * weight
    premul = old[:, :, :3] * old[:, :, 3:4] * (1.0 - weight)
    premul += new[:, :, :3] * new[:, :, 3:4] * weight
    rgb = np.where(alpha > 1e-6, premul / np.maximum(alpha, 1e-6), 0.0)
    merged = np.concatenate((rgb, alpha), axis=2)
    base.paste(
        Image.fromarray(np.rint(np.clip(merged, 0.0, 1.0) * 255.0).astype(np.uint8), "RGBA"),
        (x0, 0),
    )


OUT.mkdir(parents=True, exist_ok=True)
GRADED.mkdir(parents=True, exist_ok=True)

for layer_number, (source_name, pano_name) in enumerate(LAYERS, start=1):
    source = Image.open(SOURCE_LAYERS / source_name)
    graded = grade_panel(source)
    graded_path = GRADED / source_name
    if layer_number == 1:
        graded.convert("RGB").save(graded_path, optimize=True)
    else:
        graded.save(graded_path, optimize=True)

    previous = Image.open(SOURCE_PANOS / pano_name).convert("RGBA")
    rebuilt = Image.new("RGBA", previous.size)
    extension = previous.crop((0, 0, 3 * PANEL_WIDTH, previous.height))
    extension = grade_neighbor_shoulder(extension)
    rebuilt.paste(extension, (0, 0))
    rebuilt.paste(graded, (3 * PANEL_WIDTH, 0))
    blend_seam_patch(
        rebuilt,
        Image.open(SEAM_PATCHES / f"fixed-{layer_number:02d}-seam-3.png"),
    )
    if layer_number == 1:
        rebuilt.convert("RGB").save(OUT / pano_name, optimize=True)
    else:
        rebuilt.save(OUT / pano_name, optimize=True)

preview = Image.open(OUT / LAYERS[0][1]).convert("RGBA")
for _, pano_name in LAYERS[1:]:
    preview.alpha_composite(Image.open(OUT / pano_name).convert("RGBA"))
preview.convert("RGB").save(
    "/private/tmp/cloud-pano-v3-color-matched-preview.jpg",
    quality=96,
)
