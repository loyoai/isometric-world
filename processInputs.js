const fs = require('fs/promises');
const path = require('path');
const replaceRightThird = require('./replaceRightThird');

const DEFAULT_INPUT_DIR = 'inputs';
const DEFAULT_OUTPUT_DIR = 'output';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);

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

  await fs.mkdir(outputDir, { recursive: true });

  for (let i = 0; i < files.length; i += 1) {
    const filename = files[i];
    const index = String(i + 1).padStart(4, '0');
    const ext = path.extname(filename);
    const inputPath = path.join(inputDir, filename);
    const startName = `${index}_start${ext}`;
    const endName = `${index}_end${ext}`;
    const startPath = path.join(outputDir, startName);
    const endPath = path.join(outputDir, endName);

    await replaceRightThird(inputPath, startPath);
    await fs.copyFile(inputPath, endPath);
    console.log(`Processed ${filename} -> ${startName}, ${endName}`);
  }

  if (!files.length) {
    console.warn('No image files found to process.');
  }
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
