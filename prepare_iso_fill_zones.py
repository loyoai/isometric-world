from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, Iterable, Tuple

from PIL import Image, ImageDraw

SEED_PATH = Path("seed.png")
OUTPUT_DIR = Path("trace")
ISO_RATIO = 0.5  # vertical drop per unit horizontal step in screen space
BAND_FRACTION = 1 / 3

Directions = Tuple[str, Tuple[Tuple[float, float], ...]]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(min(value, maximum), minimum)


def load_seed() -> Image.Image:
    if not SEED_PATH.exists():
        raise FileNotFoundError(f"Seed image not found at {SEED_PATH}")
    return Image.open(SEED_PATH).convert("RGB")


def compute_polygons(width: int, height: int) -> Dict[str, Tuple[Tuple[int, int], ...]]:
    band_w = max(1, int(round(width * BAND_FRACTION)))
    band_h = max(1, int(round(height * BAND_FRACTION)))

    iso_offset = int(round(clamp(band_w * ISO_RATIO, 0, height)))
    horizontal_slant = int(round(clamp(band_h / max(ISO_RATIO, 1e-6), 0, width)))

    polygons: Dict[str, Tuple[Tuple[int, int], ...]] = {
        "east": (
            (width - band_w, iso_offset),
            (width, 0),
            (width, height),
            (width - band_w, height - iso_offset),
        ),
        "west": (
            (0, 0),
            (band_w, iso_offset),
            (band_w, height - iso_offset),
            (0, height),
        ),
        "north": (
            (0, 0),
            (width, 0),
            (width - horizontal_slant, band_h),
            (horizontal_slant, band_h),
        ),
        "south": (
            (horizontal_slant, height - band_h),
            (width - horizontal_slant, height - band_h),
            (width, height),
            (0, height),
        ),
    }

    return polygons


def apply_fill_zone(image: Image.Image, polygon: Iterable[Tuple[int, int]]) -> Image.Image:
    canvas = image.copy()
    draw = ImageDraw.Draw(canvas, "RGBA")
    points = list(polygon)
    draw.polygon(points, fill=(255, 255, 255, 255))
    draw.line(points + [points[0]], fill=(180, 200, 255, 180), width=max(1, image.width // 200))
    return canvas


def main() -> None:
    seed = load_seed()
    width, height = seed.size
    polygons = compute_polygons(width, height)

    OUTPUT_DIR.mkdir(exist_ok=True)
    contexts = {}

    for direction, polygon in polygons.items():
        contexts[direction] = apply_fill_zone(seed, polygon)
        output_path = OUTPUT_DIR / f"seed_fill_{direction}.png"
        contexts[direction].save(output_path)
        print(f"Saved {output_path}")


if __name__ == "__main__":
    main()
