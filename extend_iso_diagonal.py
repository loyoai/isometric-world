#!/usr/bin/env python3
"""Bidirectional isometric extension pipeline with FAL tracing.

This script extends an isometric seed tile horizontally (left/right), then
builds vertical stacks (upwards/downwards) using diagonal tiles as contextual
anchors so seams remain coherent. Every intermediate artefact is written to a
trace directory for inspection.

The workflow purposely keeps the FAL input footprint equal to a single tile
with one third of its area left blank, matching the model's expected framing.

Example usage:

    python extend_iso_diagonal.py \
        --seed seed.png \
        --horizontal 3 \
        --up 3 --down 3 \
        --trace-dir trace_full

Environment:
    export FAL_KEY=...  # required unless --dry-run is used
"""

from __future__ import annotations

import argparse
import base64
import io
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import fal_client
import httpx
from PIL import Image
from dotenv import load_dotenv


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MODEL_ID = "fal-ai/flux-kontext-lora"
LORA_URL = "https://v3.fal.media/files/monkey/o8_EQPk4RJRPeCSQjuCtZ_adapter_model.safetensors"
NUM_INFERENCE_STEPS = 30
GUIDANCE_SCALE = 2.5
RESOLUTION_MODE = "1:1"
ACCELERATION = "none"
OUTPUT_FORMAT = "jpeg"

PROMPTS = {
    "right": "fill in the blank area on the right",
    "left": "fill in the blank area on the left",
    "up": "fill in the blank area on the top",
    "down": "fill in the blank area on the bottom",
}


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def ensure_white_tuple(mode: str) -> Tuple[int, ...]:
    if mode == "RGB":
        return (255, 255, 255)
    if mode == "RGBA":
        return (255, 255, 255, 255)
    if mode == "L":
        return (255,)
    raise ValueError(f"Unsupported image mode: {mode}")


def download_image(url: str) -> Image.Image:
    if url.startswith("data:"):
        _, b64 = url.split(",", 1)
        return Image.open(io.BytesIO(base64.b64decode(b64)))
    response = httpx.get(url, timeout=60.0)
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content))


# ---------------------------------------------------------------------------
# Trace recorder
# ---------------------------------------------------------------------------


@dataclass
class TraceRecorder:
    root: Path

    def save(self, step: str, name: str, image: Image.Image, fmt: Optional[str] = None) -> Path:
        step_dir = self.root / step
        step_dir.mkdir(parents=True, exist_ok=True)
        ext = (fmt or "PNG").lower()
        filename = f"{name}.{ 'jpg' if ext == 'jpeg' else ext }"
        path = step_dir / filename
        if ext == "jpeg":
            image.convert("RGB").save(path, format="JPEG", quality=95)
        else:
            image.save(path, format=fmt or "PNG")
        return path


# ---------------------------------------------------------------------------
# Image transforms (horizontal)
# ---------------------------------------------------------------------------


def slide_image_left(image: Image.Image) -> Image.Image:
    width, height = image.size
    col1_end = width // 3
    col2_end = (2 * width) // 3
    white = ensure_white_tuple(image.mode)

    middle = image.crop((col1_end, 0, col2_end, height))
    right = image.crop((col2_end, 0, width, height))

    output = Image.new(image.mode, image.size, white)
    output.paste(middle, (0, 0))
    output.paste(right, (col1_end, 0))
    return output


def slide_image_right(image: Image.Image) -> Image.Image:
    width, height = image.size
    col1_end = width // 3
    col2_end = (2 * width) // 3
    white = ensure_white_tuple(image.mode)

    left = image.crop((0, 0, col1_end, height))
    middle = image.crop((col1_end, 0, col2_end, height))

    output = Image.new(image.mode, image.size, white)
    output.paste(middle, (width - (col2_end - col1_end), 0))
    output.paste(left, (width - (col2_end - col1_end) - col1_end, 0))
    return output


def extract_right_third(image: Image.Image) -> Image.Image:
    width, height = image.size
    col2_end = (2 * width) // 3
    return image.crop((col2_end, 0, width, height))


def extract_left_third(image: Image.Image) -> Image.Image:
    width, height = image.size
    col1_end = width // 3
    return image.crop((0, 0, col1_end, height))


# ---------------------------------------------------------------------------
# Image transforms (vertical)
# ---------------------------------------------------------------------------


def slide_image_up(image: Image.Image) -> Image.Image:
    width, height = image.size
    row1_end = height // 3
    row2_end = (2 * height) // 3
    white = ensure_white_tuple(image.mode)

    middle = image.crop((0, row1_end, width, row2_end))
    bottom = image.crop((0, row2_end, width, height))

    output = Image.new(image.mode, image.size, white)
    output.paste(middle, (0, row1_end))
    output.paste(bottom, (0, row1_end + (row2_end - row1_end)))
    return output


def slide_image_down(image: Image.Image) -> Image.Image:
    width, height = image.size
    row1_end = height // 3
    row2_end = (2 * height) // 3
    white = ensure_white_tuple(image.mode)

    top = image.crop((0, 0, width, row1_end))
    middle = image.crop((0, row1_end, width, row2_end))

    output = Image.new(image.mode, image.size, white)
    output.paste(top, (0, 0))
    output.paste(middle, (0, row1_end))
    return output


def extract_top_third(image: Image.Image) -> Image.Image:
    width, height = image.size
    row1_end = height // 3
    return image.crop((0, 0, width, row1_end))


def extract_bottom_third(image: Image.Image) -> Image.Image:
    width, height = image.size
    row2_end = (2 * height) // 3
    return image.crop((0, row2_end, width, height))


def apply_vertical_edge_hints(
    context_img: Image.Image,
    direction: str,
    left_hint: Optional[Image.Image],
    right_hint: Optional[Image.Image],
    hint_ratio: float = 0.18,
) -> Image.Image:
    """Inject vertical edge strips from neighbour tiles into the blank band."""

    if left_hint is None and right_hint is None:
        return context_img

    width, height = context_img.size
    blank_height = height // 3
    hint_width = max(1, int(width * hint_ratio))
    y_offset = 0 if direction == "up" else height - blank_height

    if left_hint is not None:
        strip = left_hint.crop((left_hint.width - hint_width, 0, left_hint.width, left_hint.height))
        strip = strip.resize((hint_width, blank_height), Image.LANCZOS)
        context_img.paste(strip, (0, y_offset))

    if right_hint is not None:
        strip = right_hint.crop((0, 0, hint_width, right_hint.height))
        strip = strip.resize((hint_width, blank_height), Image.LANCZOS)
        context_img.paste(strip, (width - hint_width, y_offset))

    return context_img


# ---------------------------------------------------------------------------
# FAL interaction
# ---------------------------------------------------------------------------


def call_fal(
    image: Image.Image,
    prompt: str,
    expected_size: Tuple[int, int],
    dry_run: bool,
) -> Image.Image:
    if dry_run:
        return image.copy()

    upload_url = fal_client.upload_image(image, format="png")
    result = fal_client.subscribe(
        MODEL_ID,
        arguments={
            "prompt": prompt,
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

    images = result.get("images") or []
    if not images:
        raise RuntimeError("FAL API returned no images")

    image_url = images[0]["url"]
    fetched = download_image(image_url).convert(image.mode)
    if fetched.size != expected_size:
        fetched = fetched.resize(expected_size, Image.LANCZOS)
    return fetched


# ---------------------------------------------------------------------------
# Extension routines
# ---------------------------------------------------------------------------


def extend_horizontal(
    base_tile: Image.Image,
    iterations: int,
    direction: str,
    recorder: TraceRecorder,
    dry_run: bool,
) -> List[Image.Image]:
    assert direction in {"left", "right"}
    tiles: List[Image.Image] = []
    context = base_tile

    for idx in range(1, iterations + 1):
        step_id = f"{direction}_h_{idx:02d}"
        recorder.save(step_id, "context", context)

        if direction == "right":
            slid = slide_image_left(context)
        else:
            slid = slide_image_right(context)
        recorder.save(step_id, "input", slid)

        filled = call_fal(slid, PROMPTS[direction], slid.size, dry_run)
        recorder.save(step_id, "fal_result", filled, fmt="jpeg")

        if direction == "right":
            column = extract_right_third(filled)
        else:
            column = extract_left_third(filled)
        recorder.save(step_id, "column", column)

        tiles.append(filled)
        context = filled

    return tiles


def extend_vertical_chain(
    base_tile: Image.Image,
    iterations: int,
    direction: str,
    column_label: str,
    recorder: TraceRecorder,
    dry_run: bool,
) -> List[Image.Image]:
    assert direction in {"up", "down"}
    tiles: List[Image.Image] = []
    context = base_tile

    for idx in range(1, iterations + 1):
        step_id = f"{column_label}_{direction}_{idx:02d}"
        recorder.save(step_id, "context", context)

        slid = slide_image_up(context) if direction == "up" else slide_image_down(context)
        recorder.save(step_id, "input", slid)

        filled = call_fal(slid, PROMPTS[direction], slid.size, dry_run)
        recorder.save(step_id, "fal_result", filled, fmt="jpeg")

        crop = extract_top_third(filled) if direction == "up" else extract_bottom_third(filled)
        recorder.save(step_id, "band", crop)

        tiles.append(filled)
        context = filled

    return tiles


def extend_vertical_center(
    base_tile: Image.Image,
    iterations: int,
    direction: str,
    left_refs: Iterable[Image.Image],
    right_refs: Iterable[Image.Image],
    label: str,
    recorder: TraceRecorder,
    dry_run: bool,
    hint_ratio: float,
) -> List[Image.Image]:
    assert direction in {"up", "down"}

    left_list = list(left_refs)
    right_list = list(right_refs)
    if len(left_list) < iterations or len(right_list) < iterations:
        raise ValueError("Not enough diagonal tiles to guide centre vertical expansion")

    tiles: List[Image.Image] = []
    context = base_tile

    for idx in range(1, iterations + 1):
        step_id = f"{label}_{direction}_{idx:02d}"
        recorder.save(step_id, "context", context)

        slid = slide_image_up(context) if direction == "up" else slide_image_down(context)
        hint_image = apply_vertical_edge_hints(
            slid.copy(),
            direction,
            left_list[idx - 1],
            right_list[idx - 1],
            hint_ratio,
        )
        recorder.save(step_id, "input", hint_image)

        filled = call_fal(hint_image, PROMPTS[direction], hint_image.size, dry_run)
        recorder.save(step_id, "fal_result", filled, fmt="jpeg")

        band = extract_top_third(filled) if direction == "up" else extract_bottom_third(filled)
        recorder.save(step_id, "band", band)

        tiles.append(filled)
        context = filled

    return tiles


# ---------------------------------------------------------------------------
# Compositing utilities
# ---------------------------------------------------------------------------


def stitch_grid(tile_map: Dict[Tuple[int, int], Image.Image]) -> Image.Image:
    xs = [coord[0] for coord in tile_map]
    ys = [coord[1] for coord in tile_map]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    sample_tile = next(iter(tile_map.values()))
    tile_w, tile_h = sample_tile.size

    grid_width = (x_max - x_min + 1) * tile_w
    grid_height = (y_max - y_min + 1) * tile_h

    canvas = Image.new(sample_tile.mode, (grid_width, grid_height), ensure_white_tuple(sample_tile.mode))

    for (x, y), tile in tile_map.items():
        px = (x - x_min) * tile_w
        py = (y_max - y) * tile_h
        canvas.paste(tile, (px, py))

    return canvas


# ---------------------------------------------------------------------------
# CLI orchestration
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extend an isometric seed tile in all directions with FAL")
    parser.add_argument("--seed", default="seed.png", help="Path to the seed tile (square PNG recommended)")
    parser.add_argument("--horizontal", type=int, default=3, help="Number of tiles to generate per side horizontally")
    parser.add_argument("--up", type=int, default=3, help="Number of layers to grow upwards")
    parser.add_argument("--down", type=int, default=3, help="Number of layers to grow downwards")
    parser.add_argument("--hint-ratio", type=float, default=0.18, help="Width ratio for diagonal edge hints inside the blank band")
    parser.add_argument("--trace-dir", default="trace_full", help="Directory where trace artefacts will be written")
    parser.add_argument("--output", default="extended_grid.png", help="Path for the stitched grid output")
    parser.add_argument("--dry-run", action="store_true", help="Skip FAL API calls and reuse the input frame (for debugging)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    load_dotenv()
    if not args.dry_run:
        api_key = os.getenv("FAL_KEY")
        if not api_key:
            raise SystemExit("FAL_KEY environment variable is required unless --dry-run is set")
        fal_client.api_key = api_key

    seed_path = Path(args.seed)
    if not seed_path.exists():
        raise SystemExit(f"Seed image not found: {seed_path}")

    recorder = TraceRecorder(Path(args.trace_dir))

    seed_tile = Image.open(seed_path).convert("RGB")
    recorder.save("seed", "seed", seed_tile)

    tile_map: Dict[Tuple[int, int], Image.Image] = {(0, 0): seed_tile}

    # Horizontal expansion -------------------------------------------------
    if args.horizontal <= 0:
        raise SystemExit("--horizontal must be at least 1 to provide diagonal guidance")

    right_tiles = extend_horizontal(seed_tile, args.horizontal, "right", recorder, args.dry_run)
    left_tiles = extend_horizontal(seed_tile, args.horizontal, "left", recorder, args.dry_run)

    for idx, tile in enumerate(right_tiles, start=1):
        tile_map[(idx, 0)] = tile
    for idx, tile in enumerate(left_tiles, start=1):
        tile_map[(-idx, 0)] = tile

    # Upward diagonal columns ---------------------------------------------
    up_right_tiles = extend_vertical_chain(right_tiles[0], args.up, "up", "right_col", recorder, args.dry_run) if args.up else []
    up_left_tiles = extend_vertical_chain(left_tiles[0], args.up, "up", "left_col", recorder, args.dry_run) if args.up else []

    for level, tile in enumerate(up_right_tiles, start=1):
        tile_map[(1, level)] = tile
    for level, tile in enumerate(up_left_tiles, start=1):
        tile_map[(-1, level)] = tile

    up_center_tiles = (
        extend_vertical_center(
            seed_tile,
            args.up,
            "up",
            up_left_tiles,
            up_right_tiles,
            "center_column",
            recorder,
            args.dry_run,
            args.hint_ratio,
        )
        if args.up
        else []
    )

    for level, tile in enumerate(up_center_tiles, start=1):
        tile_map[(0, level)] = tile

    # Downward diagonal columns -------------------------------------------
    down_right_tiles = extend_vertical_chain(right_tiles[0], args.down, "down", "right_col", recorder, args.dry_run) if args.down else []
    down_left_tiles = extend_vertical_chain(left_tiles[0], args.down, "down", "left_col", recorder, args.dry_run) if args.down else []

    for level, tile in enumerate(down_right_tiles, start=1):
        tile_map[(1, -level)] = tile
    for level, tile in enumerate(down_left_tiles, start=1):
        tile_map[(-1, -level)] = tile

    down_center_tiles = (
        extend_vertical_center(
            seed_tile,
            args.down,
            "down",
            down_left_tiles,
            down_right_tiles,
            "center_column",
            recorder,
            args.dry_run,
            args.hint_ratio,
        )
        if args.down
        else []
    )

    for level, tile in enumerate(down_center_tiles, start=1):
        tile_map[(0, -level)] = tile

    # Additional diagonals (optional, beyond immediate neighbours) --------
    # If more than one horizontal step was generated, cascade the diagonal
    # chains to the outer columns to keep corners populated.
    for offset, right_tile in enumerate(right_tiles[1:], start=2):
        label = f"right_col_{offset}"
        tiles = extend_vertical_chain(right_tile, args.up, "up", label, recorder, args.dry_run) if args.up else []
        for level, tile in enumerate(tiles, start=1):
            tile_map[(offset, level)] = tile

        tiles_down = extend_vertical_chain(right_tile, args.down, "down", label, recorder, args.dry_run) if args.down else []
        for level, tile in enumerate(tiles_down, start=1):
            tile_map[(offset, -level)] = tile

    for offset, left_tile in enumerate(left_tiles[1:], start=2):
        label = f"left_col_{offset}"
        tiles = extend_vertical_chain(left_tile, args.up, "up", label, recorder, args.dry_run) if args.up else []
        for level, tile in enumerate(tiles, start=1):
            tile_map[(-offset, level)] = tile

        tiles_down = extend_vertical_chain(left_tile, args.down, "down", label, recorder, args.dry_run) if args.down else []
        for level, tile in enumerate(tiles_down, start=1):
            tile_map[(-offset, -level)] = tile

    # Stitch composite grid for convenience --------------------------------
    grid_image = stitch_grid(tile_map)
    grid_path = Path(args.output)
    grid_image.save(grid_path)

    print(f"Trace written to {recorder.root.resolve()}")
    print(f"Grid exported to {grid_path.resolve()}")


if __name__ == "__main__":
    main()
