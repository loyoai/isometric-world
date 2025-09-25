from __future__ import annotations

import base64
import io
import os
from pathlib import Path
from typing import Dict, Tuple

import fal_client
import httpx
from PIL import Image, ImageChops, ImageDraw

MODEL_ID = "fal-ai/flux-kontext-lora"
PROMPTS: Dict[str, str] = {
    "east": "extend the scene naturally into the blank band on the top-right, keeping the same isometric style",
    "south": "extend the scene naturally into the blank band on the bottom-right, keeping the same isometric style",
    "west": "extend the scene naturally into the blank band on the top-left, keeping the same isometric style",
    "north": "extend the scene naturally into the blank band on the bottom-left, keeping the same isometric style",
}
LORA_URL = "https://v3.fal.media/files/monkey/o8_EQPk4RJRPeCSQjuCtZ_adapter_model.safetensors"
NUM_INFERENCE_STEPS = 30
RESOLUTION_MODE = "1:1"
ACCELERATION = "none"
OUTPUT_FORMAT = "jpeg"
GUIDANCE_SCALE = 2.5
TRACE_DIR = Path("trace_iso")
SEED_PATH = Path("seed.png")
OUTPUT_PATH = Path("seed_iso_extended.png")

BAND_FRACTION = 1 / 3
ISO_RATIO = 0.5
DIRECTIONS = ["east", "south", "west", "north"]

VECTOR = {
    "east": (1, -1),
    "south": (1, 1),
    "west": (-1, -1),
    "north": (-1, 1),
}


def ensure_env() -> None:
    if "FAL_KEY" not in os.environ:
        raise EnvironmentError("FAL_KEY environment variable must be set")


def download_image(url: str) -> Image.Image:
    if url.startswith("data:"):
        _, data = url.split(",", 1)
        return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")
    response = httpx.get(url, timeout=60.0)
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def call_fal(context: Image.Image, direction: str) -> Image.Image:
    upload_url = fal_client.upload_image(context, format="png")
    result = fal_client.subscribe(
        MODEL_ID,
        arguments={
            "prompt": PROMPTS[direction],
            "image_url": upload_url,
            "num_inference_steps": NUM_INFERENCE_STEPS,
            "guidance_scale": GUIDANCE_SCALE,
            "num_images": 1,
            "enable_safety_checker": True,
            "output_format": OUTPUT_FORMAT,
            "loras": [{"path": LORA_URL, "scale": 1.0}],
            "acceleration": ACCELERATION,
            "resolution_mode": RESOLUTION_MODE,
            "sync_mode": True,
        },
        with_logs=True,
    )
    payload = result.data if hasattr(result, "data") else result
    images = payload.get("images") if isinstance(payload, dict) else []
    if not images:
        raise RuntimeError("FAL API returned no images")
    return download_image(images[0]["url"])  # expect png/jpeg


def make_context(base: Image.Image, direction: str, band: int, lift: int) -> Tuple[Image.Image, Image.Image, Tuple[int, int]]:
    vx, vy = VECTOR[direction]
    width, height = base.size

    new_width = width + band
    new_height = height + lift

    offset_x = band if vx < 0 else 0
    offset_y = lift if vy < 0 else 0

    context = Image.new("RGB", (new_width, new_height), (255, 255, 255))
    context.paste(base, (offset_x, offset_y))

    occupancy = Image.new("L", (new_width, new_height), 0)
    full_alpha = Image.new("L", base.size, 255)
    occupancy.paste(full_alpha, (offset_x, offset_y))
    blank_mask = ImageChops.invert(occupancy)

    return context, blank_mask, (offset_x, offset_y)


def composite_with_base(base: Image.Image, context: Image.Image, blank_mask: Image.Image, filled: Image.Image, offsets: Tuple[int, int]) -> Image.Image:
    width, height = base.size
    new_width, new_height = context.size
    offset_x, offset_y = offsets

    # Preserve original base pixels
    preserved = Image.new("RGB", (new_width, new_height), (255, 255, 255))
    preserved.paste(base, (offset_x, offset_y))

    addition = Image.composite(filled, preserved, blank_mask)

    combined = preserved.copy()
    combined.paste(addition, mask=blank_mask)

    return combined


def extend_direction(base: Image.Image, direction: str, step: int, band: int, lift: int) -> Image.Image:
    context, mask, offsets = make_context(base, direction, band, lift)

    TRACE_DIR.mkdir(exist_ok=True)
    context.save(TRACE_DIR / f"{direction}_{step}_context.png")
    mask.save(TRACE_DIR / f"{direction}_{step}_mask.png")

    fal_result = call_fal(context, direction)
    if fal_result.size != context.size:
        fal_result = fal_result.resize(context.size, Image.LANCZOS)
    fal_result.save(TRACE_DIR / f"{direction}_{step}_fal.png")

    combined = composite_with_base(base, context, mask, fal_result, offsets)
    combined.save(TRACE_DIR / f"{direction}_{step}_extended.png")
    return combined


def main() -> None:
    ensure_env()
    if not SEED_PATH.exists():
        raise FileNotFoundError("seed.png not found")

    base = Image.open(SEED_PATH).convert("RGB")

    TRACE_DIR.mkdir(exist_ok=True)
    base.save(TRACE_DIR / "seed_base.png")

    for step, direction in enumerate(DIRECTIONS, start=1):
        band = max(1, round(base.width * BAND_FRACTION))
        lift = max(1, round(band * ISO_RATIO))
        base = extend_direction(base, direction, step, band, lift)

    base.save(OUTPUT_PATH)
    print(f"Extended image saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
