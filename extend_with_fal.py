from __future__ import annotations

import argparse
import base64
import io
import os
import sys
from pathlib import Path
from typing import Tuple

import fal_client
import httpx
from PIL import Image
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Set FAL API key
fal_client.api_key = os.getenv("FAL_KEY")

MODEL_ID = "fal-ai/flux-kontext-lora"
PROMPT = "fill in the blank area on the right"
LORA_URL = "https://v3.fal.media/files/monkey/o8_EQPk4RJRPeCSQjuCtZ_adapter_model.safetensors"
NUM_ITERATIONS = 3
NUM_INFERENCE_STEPS = 30
RESOLUTION_MODE = "1:1"
ACCELERATION = "none"
OUTPUT_FORMAT = "jpeg"
GUIDANCE_SCALE = 2.5
TRACE_DIR_NAME = "trace"


def ensure_white_tuple(mode: str) -> Tuple[int, ...]:
    if mode == "RGB":
        return (255, 255, 255)
    if mode == "RGBA":
        return (255, 255, 255, 255)
    if mode == "L":
        return (255,)
    if mode == "LA":
        return (255, 255)
    raise ValueError(f"Unsupported image mode for sliding: {mode}")


def slide_image_left(image: Image.Image) -> Image.Image:
    width, height = image.size

    if width <= 0 or height <= 0:
        raise ValueError("Image has invalid dimensions.")

    col1_end = width // 3
    col2_end = (2 * width) // 3

    if col1_end == col2_end:
        raise ValueError("Image width too small to form three distinct columns.")

    white = ensure_white_tuple(image.mode)
    output_image = Image.new(image.mode, image.size, white)

    middle_slice = image.crop((col1_end, 0, col2_end, height))
    right_slice = image.crop((col2_end, 0, width, height))

    output_image.paste(middle_slice, (0, 0))
    output_image.paste(right_slice, (col1_end, 0))

    return output_image


def extract_right_third(image: Image.Image) -> Image.Image:
    width, height = image.size
    col2_end = (2 * width) // 3
    third_width = width - col2_end
    if third_width <= 0:
        raise ValueError("Failed to compute right third width.")
    return image.crop((col2_end, 0, width, height))


def append_column(base: Image.Image, column: Image.Image) -> Image.Image:
    if base.mode != column.mode:
        column = column.convert(base.mode)
    if base.height != column.height:
        column = column.resize((column.width, base.height), Image.LANCZOS)
    new_width = base.width + column.width
    output = Image.new(base.mode, (new_width, base.height))
    output.paste(base, (0, 0))
    output.paste(column, (base.width, 0))
    return output


def download_image(url: str) -> Image.Image:
    if url.startswith("data:"):
        header, b64_data = url.split(",", 1)
        image_bytes = base64.b64decode(b64_data)
        return Image.open(io.BytesIO(image_bytes))

    response = httpx.get(url, timeout=60.0)
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content))


def call_fal(image: Image.Image, expected_size: Tuple[int, int], dry_run: bool) -> Image.Image:
    if dry_run:
        return image.copy()

    upload_url = fal_client.upload_image(image, format="png")
    result = fal_client.subscribe(
        MODEL_ID,
        arguments={
            "prompt": PROMPT,
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
        raise RuntimeError("No images returned from FAL API.")
    image_url = images[0]["url"]
    result_image = download_image(image_url)
    if result_image.size != expected_size:
        result_image = result_image.resize(expected_size, Image.LANCZOS)
    return result_image.convert(image.mode)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extend seed image using FAL flux kontext LoRA")
    parser.add_argument("--seed", default="seed.png", help="Path to the seed image")
    parser.add_argument("--output", default="seed_extended.png", help="Path for the extended output image")
    parser.add_argument("--trace-dir", default=TRACE_DIR_NAME, help="Directory to store trace assets")
    parser.add_argument("--iterations", type=int, default=NUM_ITERATIONS, help="Number of extension iterations")
    parser.add_argument("--dry-run", action="store_true", help="Skip FAL calls and reuse the slid image for testing")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args(sys.argv[1:])

    if not args.dry_run and "FAL_KEY" not in os.environ:
        print("FAL_KEY environment variable is required to call the FAL API.")
        sys.exit(1)

    seed_path = Path(args.seed)
    output_path = Path(args.output)
    trace_dir = Path(args.trace_dir)
    trace_dir.mkdir(exist_ok=True)

    base_image = Image.open(seed_path).convert("RGB")
    base_image.save(trace_dir / "00_seed.png")

    accumulated_image = base_image.copy()
    context_image = base_image

    for iteration in range(1, args.iterations + 1):
        prefix = f"{iteration:02d}"
        context_save_path = trace_dir / f"{prefix}_context.png"
        context_image.save(context_save_path)

        slid_image = slide_image_left(context_image)
        slid_save_path = trace_dir / f"{prefix}_slid.png"
        slid_image.save(slid_save_path)

        try:
            filled_image = call_fal(slid_image, slid_image.size, args.dry_run)
        except Exception as exc:  # pylint: disable=broad-except
            print(f"Iteration {iteration}: failed to call FAL API - {exc}")
            raise

        filled_save_path = trace_dir / f"{prefix}_fal_result.jpg"
        filled_image.convert("RGB").save(filled_save_path, format="JPEG", quality=95)

        new_column = extract_right_third(filled_image)
        new_column_save_path = trace_dir / f"{prefix}_new_column.png"
        new_column.save(new_column_save_path)

        accumulated_image = append_column(accumulated_image, new_column)
        extended_save_path = trace_dir / f"{prefix}_extended.png"
        accumulated_image.save(extended_save_path)

        context_image = filled_image

    accumulated_image.save(output_path)
    print(f"Extended image saved to {output_path}")


if __name__ == "__main__":
    main()
