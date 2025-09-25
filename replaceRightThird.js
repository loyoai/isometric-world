const sharp = require('sharp');

async function replaceRightThird(inputPath, outputPath) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const { width, height, channels } = metadata;

  if (!width || !height) {
    throw new Error('Unable to read image dimensions.');
  }

  if (width !== height) {
    console.warn('Warning: image is not square; proceeding with rightmost third replacement.');
  }

  const startX = Math.floor((2 * width) / 3);
  const thirdWidth = width - startX;

  if (thirdWidth <= 0) {
    throw new Error('Computed third column width is non-positive.');
  }

  const overlay = {
    input: {
      create: {
        width: thirdWidth,
        height,
        channels: channels === 4 ? 4 : 3,
        background: channels === 4 ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 255, g: 255, b: 255 }
      }
    },
    left: startX,
    top: 0
  };

  await image.composite([overlay]).toFile(outputPath);
}

module.exports = replaceRightThird;

if (require.main === module) {
  (async () => {
    const input = process.argv[2] || 'image.png';
    const output = process.argv[3] || 'image_with_white_third.png';

    try {
      await replaceRightThird(input, output);
      console.log(`Processed image saved to ${output}`);
    } catch (error) {
      console.error('Failed to process image:', error);
      process.exitCode = 1;
    }
  })();
}
