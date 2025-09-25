const sharp = require('sharp');

const JPEG_OPTIONS = {
  quality: 95,
  mozjpeg: true,
  chromaSubsampling: '4:4:4'
};

const PATTERN_NAMES = {
  RIGHT_COLUMN: 'right_column',
  LEFT_COLUMN: 'left_column',
  BOTTOM_ROW: 'bottom_row',
  BOTTOM_MIDDLE_RIGHT: 'bottom_middle_right'
};

function buildOverlays(width, height, channels = 3, pattern = PATTERN_NAMES.RIGHT_COLUMN) {
  if (!width || !height) {
    throw new Error('Unable to compute overlays without valid dimensions.');
  }

  const overlays = [];
  const overlayChannels = channels === 4 ? 4 : 3;
  const overlayColor = overlayChannels === 4
    ? { r: 255, g: 255, b: 255, alpha: 1 }
    : { r: 255, g: 255, b: 255 };

  const pushOverlay = (left, top, overlayWidth, overlayHeight) => {
    if (overlayWidth <= 0 || overlayHeight <= 0) {
      return;
    }

    overlays.push({
      input: {
        create: {
          width: overlayWidth,
          height: overlayHeight,
          channels: overlayChannels,
          background: overlayColor
        }
      },
      left,
      top
    });
  };

  const leftEnd = Math.max(1, Math.floor(width / 3));
  let rightStart = Math.max(leftEnd, Math.floor((2 * width) / 3));
  let rightWidth = width - rightStart;

  if (rightWidth <= 0) {
    rightWidth = Math.min(width, Math.ceil(width / 3));
    rightStart = Math.max(0, width - rightWidth);
  }

  const leftWidth = Math.min(leftEnd, width);
  const middleStart = leftEnd;
  const middleWidth = Math.max(0, rightStart - middleStart);

  const bottomRowHeightEstimate = Math.max(1, Math.ceil(height / 3));
  let bottomStart = Math.max(0, height - bottomRowHeightEstimate);
  let bottomHeight = height - bottomStart;

  if (bottomHeight <= 0) {
    bottomHeight = Math.min(height, bottomRowHeightEstimate);
    bottomStart = Math.max(0, height - bottomHeight);
  }

  switch (pattern) {
    case PATTERN_NAMES.RIGHT_COLUMN:
      pushOverlay(rightStart, 0, Math.max(1, rightWidth), height);
      break;
    case PATTERN_NAMES.LEFT_COLUMN:
      pushOverlay(0, 0, Math.max(1, leftWidth), height);
      break;
    case PATTERN_NAMES.BOTTOM_ROW:
      pushOverlay(0, bottomStart, width, Math.max(1, bottomHeight));
      break;
    case PATTERN_NAMES.BOTTOM_MIDDLE_RIGHT:
      if (middleWidth > 0) {
        pushOverlay(middleStart, bottomStart, middleWidth, Math.max(1, bottomHeight));
      }
      pushOverlay(rightStart, bottomStart, Math.max(1, rightWidth), Math.max(1, bottomHeight));
      break;
    default:
      throw new Error(`Unknown blanking pattern: ${pattern}`);
  }

  if (!overlays.length) {
    throw new Error('No overlays generated for the requested pattern.');
  }

  return overlays;
}

async function applyBlankPattern(inputPath, outputPath, pattern = PATTERN_NAMES.RIGHT_COLUMN) {
  const metadata = await sharp(inputPath).metadata();
  const { width, height, channels } = metadata;

  const overlays = buildOverlays(width, height, channels, pattern);

  await sharp(inputPath)
    .composite(overlays)
    .jpeg(JPEG_OPTIONS)
    .toFile(outputPath);
}

module.exports = {
  applyBlankPattern,
  buildOverlays,
  PATTERN_NAMES,
  JPEG_OPTIONS
};

if (require.main === module) {
  (async () => {
    const input = process.argv[2];
    const output = process.argv[3] || 'image_with_blank_pattern.jpg';
    const pattern = process.argv[4] || PATTERN_NAMES.RIGHT_COLUMN;

    if (!input) {
      console.error('Usage: node applyBlankPattern.js <input> [output] [pattern]');
      process.exitCode = 1;
      return;
    }

    try {
      await applyBlankPattern(input, output, pattern);
      console.log(`Blank pattern "${pattern}" applied. Saved to ${output}`);
    } catch (error) {
      console.error('Failed to apply blank pattern:', error);
      process.exitCode = 1;
    }
  })();
}
