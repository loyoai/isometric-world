from __future__ import annotations

import sys
from pathlib import Path
from typing import Tuple

from PIL import Image


def white_color(mode: str) -> Tuple[int, ...]:
    """Return a white color tuple appropriate for the image mode."""
    if mode == "RGB":
        return (255, 255, 255)
    if mode == "RGBA":
        return (255, 255, 255, 255)
    if mode == "L":
        return (255,)
    if mode == "LA":
        return (255, 255)
    if mode == "P":
        # Convert palette image to RGBA for reliable processing.
        raise ValueError("Palette images are not supported; convert to RGB or RGBA first.")
    # Default to best effort by filling every channel with 255.
    return tuple([255] * len(mode))


def slide_image_left(input_path: Path, output_path: Path) -> None:
    image = Image.open(input_path)
    width, height = image.size

    if width == 0 or height == 0:
        raise ValueError("Image has invalid dimensions.")

    col1_end = width // 3
    col2_end = (2 * width) // 3

    if col1_end == col2_end:
        raise ValueError("Image width too small to form three distinct columns.")

    white = white_color(image.mode)
    output_image = Image.new(image.mode, image.size, white)

    middle_slice = image.crop((col1_end, 0, col2_end, height))
    right_slice = image.crop((col2_end, 0, width, height))

    output_image.paste(middle_slice, (0, 0))
    output_image.paste(right_slice, (col1_end, 0))

    output_image.save(output_path)


def main() -> None:
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("seed.png")
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("seed_slid.png")

    try:
        slide_image_left(input_path, output_path)
        print(f"Processed image saved to {output_path}")
    except Exception as exc:  # pylint: disable=broad-except
        print(f"Failed to process image: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
