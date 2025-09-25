const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const DEFAULT_SOURCE_DIR = 'output';
const DEFAULT_TARGET_DIR = 'output_jpeg';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);

function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

async function convertAll(sourceDir = DEFAULT_SOURCE_DIR, targetDir = DEFAULT_TARGET_DIR) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && isImageFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  await fs.mkdir(targetDir, { recursive: true });

  for (const filename of files) {
    const sourcePath = path.join(sourceDir, filename);
    const { name } = path.parse(filename);
    const targetPath = path.join(targetDir, `${name}.jpg`);

    await sharp(sourcePath)
      .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toFile(targetPath);
    console.log(`Converted ${filename} -> ${name}.jpg`);
  }

  if (!files.length) {
    console.warn('No image files found to convert.');
  }
}

(async () => {
  const sourceDir = process.argv[2] || DEFAULT_SOURCE_DIR;
  const targetDir = process.argv[3] || DEFAULT_TARGET_DIR;

  try {
    await convertAll(sourceDir, targetDir);
  } catch (error) {
    console.error('Failed to convert images:', error);
    process.exitCode = 1;
  }
})();
