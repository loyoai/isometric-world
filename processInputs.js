const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { applyBlankPattern, PATTERN_NAMES, JPEG_OPTIONS } = require('./applyBlankPattern');

const DEFAULT_INPUT_DIR = 'inputs';
const DEFAULT_OUTPUT_DIR = 'output';
const OUTPUT_EXTENSION = '.jpg';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);

const PATTERN_DISTRIBUTION = [
  { pattern: PATTERN_NAMES.RIGHT_COLUMN, count: 5 },
  { pattern: PATTERN_NAMES.LEFT_COLUMN, count: 5 },
  { pattern: PATTERN_NAMES.BOTTOM_ROW, count: 5 },
  { pattern: PATTERN_NAMES.BOTTOM_MIDDLE_RIGHT, count: 4 }
];

const EXPECTED_IMAGE_COUNT = PATTERN_DISTRIBUTION.reduce((acc, { count }) => acc + count, 0);

function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

async function processAll(inputDir = DEFAULT_INPUT_DIR, outputDir = DEFAULT_OUTPUT_DIR) {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && isImageFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const assignments = createPatternAssignments(files.length);

  await fs.mkdir(outputDir, { recursive: true });

  for (let i = 0; i < files.length; i += 1) {
    const filename = files[i];
    const index = String(i + 1).padStart(4, '0');
    const inputPath = path.join(inputDir, filename);
    const startName = `${index}_start${OUTPUT_EXTENSION}`;
    const endName = `${index}_end${OUTPUT_EXTENSION}`;
    const startPath = path.join(outputDir, startName);
    const endPath = path.join(outputDir, endName);
    const pattern = assignments[i];

    await applyBlankPattern(inputPath, startPath, pattern);
    await sharp(inputPath).jpeg(JPEG_OPTIONS).toFile(endPath);
    console.log(`Processed ${filename} -> ${startName} (${pattern}), ${endName}`);
  }

  if (!files.length) {
    console.warn('No image files found to process.');
  }
}

function createPatternAssignments(total) {
  if (total !== EXPECTED_IMAGE_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_IMAGE_COUNT} input images, found ${total}.`);
  }

  const assignments = PATTERN_DISTRIBUTION.flatMap(({ pattern, count }) =>
    Array.from({ length: count }, () => pattern)
  );

  return shuffle(assignments);
}

function shuffle(original) {
  const array = original.slice();

  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

(async () => {
  const inputDir = process.argv[2] || DEFAULT_INPUT_DIR;
  const outputDir = process.argv[3] || DEFAULT_OUTPUT_DIR;

  try {
    await processAll(inputDir, outputDir);
  } catch (error) {
    console.error('Failed to process images:', error);
    process.exitCode = 1;
  }
})();
