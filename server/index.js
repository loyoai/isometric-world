const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { fal } = require('@fal-ai/client');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MODEL_ID = 'fal-ai/flux-kontext-lora';
const PROMPT = 'fill in the blank area';
const LORA_URL = 'https://v3.fal.media/files/elephant/m0POB_Ptb3U0o5Lmg10P1_adapter_model.safetensors';
const NUM_INFERENCE_STEPS = 30;
const RESOLUTION_MODE = '1:1';
const ACCELERATION = 'none';
const OUTPUT_FORMAT = 'jpeg';
const GUIDANCE_SCALE = 2.5;
const ITERATIONS = 3;

const TEXT_TO_IMAGE_MODEL = 'fal-ai/flux-pro/v1.1-ultra';
const DEFAULT_TEXT_PROMPT =
  'An isometric pixel art scene in top-down RPG style, showing a close-up Paris café. The frame is filled with outdoor tables, umbrellas, cobblestone streets, flower boxes, bicycles, and waiters serving customers. No sky, only terrain and objects. Retro 16-bit pixel game aesthetic, charming and colorful, shadows cast at 45 degrees.';

if (!process.env.FAL_KEY) {
  console.warn('FAL_KEY is not set. API calls will fail until it is configured.');
}

fal.config({
  credentials: process.env.FAL_KEY,
});

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.use(express.json({ limit: '1mb' }));

function createWhiteBackground(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });
}

async function ensureRgbPng(buffer) {
  return sharp(buffer).toColourspace('srgb').png().toBuffer();
}

async function slideImageLeft(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('Invalid image dimensions');
  }

  const col1End = Math.floor(width / 3);
  const col2End = Math.floor((2 * width) / 3);
  const thirdWidth = width - col2End;

  if (col1End <= 0 || col2End <= col1End || thirdWidth <= 0) {
    throw new Error('Image width is too small to split into thirds');
  }

  const middleSlice = await image
    .clone()
    .extract({ left: col1End, top: 0, width: col2End - col1End, height })
    .png()
    .toBuffer();

  const rightSlice = await image
    .clone()
    .extract({ left: col2End, top: 0, width: thirdWidth, height })
    .png()
    .toBuffer();

  return createWhiteBackground(width, height)
    .composite([
      { input: middleSlice, left: 0, top: 0 },
      { input: rightSlice, left: col1End, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function slideImageRight(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('Invalid image dimensions');
  }

  const col1End = Math.floor(width / 3);
  const col2End = Math.floor((2 * width) / 3);
  const leftWidth = col1End;
  const rightWidth = width - col2End;

  if (leftWidth <= 0 || rightWidth <= 0 || col2End <= col1End) {
    throw new Error('Image width is too small to split into thirds');
  }

  const leftSlice = await image
    .clone()
    .extract({ left: 0, top: 0, width: leftWidth, height })
    .png()
    .toBuffer();

  const middleSlice = await image
    .clone()
    .extract({ left: col1End, top: 0, width: col2End - col1End, height })
    .png()
    .toBuffer();

  return createWhiteBackground(width, height)
    .composite([
      { input: leftSlice, left: rightWidth, top: 0 },
      { input: middleSlice, left: rightWidth + leftWidth, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function extractRightThird(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('Invalid image dimensions');
  }

  const col2End = Math.floor((2 * width) / 3);
  const thirdWidth = width - col2End;

  if (thirdWidth <= 0) {
    throw new Error('Failed to compute right third width');
  }

  return image
    .extract({ left: col2End, top: 0, width: thirdWidth, height })
    .png()
    .toBuffer();
}


async function slideImageUp(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('Invalid image dimensions');
  }

  const tileHeight = Math.floor(height / 3);
  const keepHeight = height - tileHeight;

  if (keepHeight <= 0) {
    throw new Error('Image height is too small to slide up');
  }

  const topPortion = await image
    .clone()
    .extract({ left: 0, top: 0, width, height: keepHeight })
    .png()
    .toBuffer();

  return createWhiteBackground(width, height)
    .composite([{ input: topPortion, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function extractBottomThird(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('Invalid image dimensions');
  }

  const row2End = Math.floor((2 * height) / 3);
  const bandHeight = height - row2End;

  if (bandHeight <= 0) {
    throw new Error('Failed to compute bottom band height');
  }

  return image
    .extract({ left: 0, top: row2End, width, height: bandHeight })
    .png()
    .toBuffer();
}

async function compositeBottomSegment(baseBuffer, segmentBuffer, left, top) {
  const baseImage = sharp(baseBuffer);
  const baseMeta = await baseImage.metadata();
  const segmentMeta = await sharp(segmentBuffer).metadata();

  if (!baseMeta.width || !baseMeta.height) {
    throw new Error('Invalid base image dimensions');
  }
  if (!segmentMeta.width || !segmentMeta.height) {
    return baseBuffer;
  }

  const maxWidth = baseMeta.width;
  let effectiveLeft = Math.max(0, Math.min(left, Math.max(0, maxWidth - segmentMeta.width)));
  let segment = segmentBuffer;
  let segmentWidth = segmentMeta.width;

  if (effectiveLeft + segmentWidth > maxWidth) {
    const clampedWidth = Math.max(0, maxWidth - effectiveLeft);
    if (clampedWidth === 0) {
      return baseBuffer;
    }
    segment = await sharp(segmentBuffer)
      .extract({ left: 0, top: 0, width: clampedWidth, height: segmentMeta.height })
      .png()
      .toBuffer();
    segmentWidth = clampedWidth;
  }

  return sharp(baseBuffer)
    .composite([{ input: segment, left: effectiveLeft, top }])
    .png()
    .toBuffer();
}
async function extractLeftThird(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('Invalid image dimensions');
  }

  const leftWidth = Math.floor(width / 3);

  if (leftWidth <= 0) {
    throw new Error('Failed to compute left third width');
  }

  return image
    .extract({ left: 0, top: 0, width: leftWidth, height })
    .png()
    .toBuffer();
}

async function extractBottomTile(columnBuffer, tileHeight) {
  const image = sharp(columnBuffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('Invalid column dimensions');
  }

  const bandHeight = Math.min(tileHeight, height);
  const top = Math.max(0, height - bandHeight);

  return image
    .extract({ left: 0, top, width, height: bandHeight })
    .png()
    .toBuffer();
}

async function extendBottomRow(baseBuffer, seedMeta, steps) {
  const baseMeta = await sharp(baseBuffer).metadata();
  const seedWidth = seedMeta.width || 0;
  const seedHeight = seedMeta.height || 0;
  const finalWidth = baseMeta.width || 0;
  const finalHeight = baseMeta.height || 0;

  const tileWidth = Math.floor(seedWidth / 3);
  const tileHeight = Math.floor(seedHeight / 3);

  if (!finalWidth || !finalHeight || tileWidth <= 0 || tileHeight <= 0) {
    return baseBuffer;
  }

  const blockWidth = Math.min(tileWidth * 3, finalWidth);
  if (blockWidth <= 0) {
    return baseBuffer;
  }

  let workingBuffer = await createWhiteBackground(finalWidth, finalHeight + tileHeight)
    .composite([{ input: baseBuffer, left: 0, top: 0 }])
    .png()
    .toBuffer();

  let context = await sharp(workingBuffer)
    .extract({ left: 0, top: 0, width: blockWidth, height: finalHeight })
    .png()
    .toBuffer();

  const contextMeta = await sharp(context).metadata();
  const verticalExpected = { width: contextMeta.width || 0, height: contextMeta.height || 0 };

  const slidUp = await slideImageUp(context);
  const falVertical = await callFal(slidUp, verticalExpected);
  const bottomBand = await extractBottomThird(falVertical);

  workingBuffer = await compositeBottomSegment(workingBuffer, bottomBand, 0, finalHeight);

  steps.push({
    iteration: steps.length + 1,
    direction: 'down',
    stage: 'vertical',
    column: bottomBand,
  });

  context = falVertical;
  const bottomBandMeta = await sharp(bottomBand).metadata();
  let currentOffset = Math.min(bottomBandMeta.width || blockWidth, finalWidth);

  while (currentOffset < finalWidth) {
    const slid = await slideImageLeft(context);
    const slidMeta = await sharp(slid).metadata();
    const horizontalExpected = { width: slidMeta.width || 0, height: slidMeta.height || 0 };
    const falHorizontal = await callFal(slid, horizontalExpected);
    const newColumn = await extractRightThird(falHorizontal);
    const bottomTile = await extractBottomTile(newColumn, tileHeight);
    const bottomTileMeta = await sharp(bottomTile).metadata();

    workingBuffer = await compositeBottomSegment(workingBuffer, bottomTile, currentOffset, finalHeight);

    steps.push({
      iteration: steps.length + 1,
      direction: 'down',
      stage: 'horizontal',
      column: bottomTile,
    });

    context = falHorizontal;
    const availableWidth = Math.max(0, finalWidth - currentOffset);
    const increment = Math.min(bottomTileMeta.width || tileWidth, availableWidth);
    if (!increment) {
      break;
    }
    currentOffset += increment;
  }

  return workingBuffer;
}

async function appendColumn(baseBuffer, columnBuffer) {
  const baseImage = sharp(baseBuffer);
  const columnImage = sharp(columnBuffer);

  const [baseMeta, columnMeta] = await Promise.all([
    baseImage.metadata(),
    columnImage.metadata(),
  ]);

  if (!baseMeta.width || !baseMeta.height) {
    throw new Error('Invalid base image dimensions');
  }
  if (!columnMeta.width || !columnMeta.height) {
    throw new Error('Invalid column image dimensions');
  }

  let adjustedColumnBuffer = columnBuffer;
  let adjustedColumnMeta = columnMeta;

  if (columnMeta.height !== baseMeta.height) {
    adjustedColumnBuffer = await columnImage
      .resize({
        width: columnMeta.width,
        height: baseMeta.height,
        fit: 'fill',
      })
      .png()
      .toBuffer();
    adjustedColumnMeta = await sharp(adjustedColumnBuffer).metadata();
  }

  const newWidth = baseMeta.width + (adjustedColumnMeta.width || 0);

  return createWhiteBackground(newWidth, baseMeta.height)
    .composite([
      { input: baseBuffer, left: 0, top: 0 },
      { input: adjustedColumnBuffer, left: baseMeta.width, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function prependColumn(baseBuffer, columnBuffer) {
  const baseImage = sharp(baseBuffer);
  const columnImage = sharp(columnBuffer);

  const [baseMeta, columnMeta] = await Promise.all([
    baseImage.metadata(),
    columnImage.metadata(),
  ]);

  if (!baseMeta.width || !baseMeta.height) {
    throw new Error('Invalid base image dimensions');
  }
  if (!columnMeta.width || !columnMeta.height) {
    throw new Error('Invalid column image dimensions');
  }

  let adjustedColumnBuffer = columnBuffer;
  let adjustedColumnMeta = columnMeta;

  if (columnMeta.height !== baseMeta.height) {
    adjustedColumnBuffer = await columnImage
      .resize({
        width: columnMeta.width,
        height: baseMeta.height,
        fit: 'fill',
      })
      .png()
      .toBuffer();
    adjustedColumnMeta = await sharp(adjustedColumnBuffer).metadata();
  }

  const columnWidth = adjustedColumnMeta.width || 0;
  const newWidth = columnWidth + baseMeta.width;

  return createWhiteBackground(newWidth, baseMeta.height)
    .composite([
      { input: adjustedColumnBuffer, left: 0, top: 0 },
      { input: baseBuffer, left: columnWidth, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function downloadImageBuffer(url) {
  if (url.startsWith('data:')) {
    const [, dataPart] = url.split(',');
    return Buffer.from(dataPart, 'base64');
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function generateSeedFromPrompt(promptText) {
  if (!process.env.FAL_KEY) {
    throw new Error('FAL_KEY is not configured');
  }

  const result = await fal.subscribe(TEXT_TO_IMAGE_MODEL, {
    input: {
      prompt: promptText,
      aspect_ratio: '1:1',
      num_images: 1,
      enable_safety_checker: true,
      output_format: 'png',
      sync_mode: true,
    },
    logs: true,
  });

  const images = result?.data?.images || result?.images || [];
  if (!images.length || !images[0].url) {
    throw new Error('FAL text-to-image returned no image');
  }

  const buffer = await downloadImageBuffer(images[0].url);
  const pngBuffer = await sharp(buffer).toColourspace('srgb').png().toBuffer();
  const metadata = await sharp(pngBuffer).metadata();

  return {
    buffer: pngBuffer,
    width: metadata.width || 0,
    height: metadata.height || 0,
    seed: result?.data?.seed ?? result?.seed ?? null,
  };
}

async function callFal(slidBuffer, expectedSize) {
  if (!process.env.FAL_KEY) {
    throw new Error('FAL_KEY is not configured');
  }

  const blob = new Blob([slidBuffer], { type: 'image/png' });
  const uploadUrl = await fal.storage.upload(blob);

  const result = await fal.subscribe(MODEL_ID, {
    input: {
      prompt: PROMPT,
      image_url: uploadUrl,
      num_inference_steps: NUM_INFERENCE_STEPS,
      guidance_scale: GUIDANCE_SCALE,
      num_images: 1,
      enable_safety_checker: true,
      output_format: OUTPUT_FORMAT,
      loras: [{ path: LORA_URL, scale: 1 }],
      acceleration: ACCELERATION,
      resolution_mode: RESOLUTION_MODE,
      sync_mode: true,
    },
    logs: true,
  });

  const images = result?.data?.images || [];
  if (!images.length || !images[0].url) {
    throw new Error('FAL API returned no images');
  }

  const downloadedBuffer = await downloadImageBuffer(images[0].url);
  let image = sharp(downloadedBuffer).toColourspace('srgb');
  const meta = await image.metadata();

  const expectedWidth = expectedSize.width;
  const expectedHeight = expectedSize.height;

  if (meta.width !== expectedWidth || meta.height !== expectedHeight) {
    image = image.resize({
      width: expectedWidth,
      height: expectedHeight,
      fit: 'fill',
    });
  }

  return image.png().toBuffer();
}

async function extendSeed(buffer, iterations = ITERATIONS, extendBottom = false) {
  const seedBuffer = await ensureRgbPng(buffer);
  const steps = [];

  const seedMeta = await sharp(seedBuffer).metadata();
  const expectedSize = { width: seedMeta.width || 0, height: seedMeta.height || 0 };

  const rightColumns = [];
  let rightContextBuffer = seedBuffer;
  let rightAccumulated = seedBuffer;

  for (let index = 0; index < iterations; index += 1) {
    const slidBuffer = await slideImageLeft(rightContextBuffer);
    const falBuffer = await callFal(slidBuffer, expectedSize);
    const newColumnBuffer = await extractRightThird(falBuffer);
    rightAccumulated = await appendColumn(rightAccumulated, newColumnBuffer);
    rightContextBuffer = falBuffer;
    rightColumns.push(newColumnBuffer);

    steps.push({
      iteration: steps.length + 1,
      direction: 'right',
      slid: slidBuffer,
      fal: falBuffer,
      column: newColumnBuffer,
      extended: rightAccumulated,
    });
  }

  const leftColumns = [];
  let leftContextBuffer = seedBuffer;
  let leftAccumulated = seedBuffer;

  for (let index = 0; index < iterations; index += 1) {
    const slidBuffer = await slideImageRight(leftContextBuffer);
    const falBuffer = await callFal(slidBuffer, expectedSize);
    const newColumnBuffer = await extractLeftThird(falBuffer);
    leftAccumulated = await prependColumn(leftAccumulated, newColumnBuffer);
    leftContextBuffer = falBuffer;
    leftColumns.unshift(newColumnBuffer);

    steps.push({
      iteration: steps.length + 1,
      direction: 'left',
      slid: slidBuffer,
      fal: falBuffer,
      column: newColumnBuffer,
      extended: leftAccumulated,
    });
  }

  let finalBuffer = leftAccumulated;
  for (const columnBuffer of rightColumns) {
    finalBuffer = await appendColumn(finalBuffer, columnBuffer);
  }

  const leftMeta = await sharp(leftAccumulated).metadata();
  if (extendBottom) {
    finalBuffer = await extendBottomRow(finalBuffer, seedMeta, steps);
  }

  const leftExtensionWidth = Math.max(
    0,
    (leftMeta.width || 0) - (seedMeta.width || 0),
  );

  return { seed: seedBuffer, extended: finalBuffer, steps, leftExtensionWidth };
}

function toDataUrl(buffer, mime = 'image/png') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

app.post('/api/generate', async (req, res) => {
  try {
    const promptText = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
      ? req.body.prompt.trim()
      : DEFAULT_TEXT_PROMPT;

    const seedResult = await generateSeedFromPrompt(promptText);

    res.json({
      prompt: promptText,
      width: seedResult.width,
      height: seedResult.height,
      seed: seedResult.seed,
      image: toDataUrl(seedResult.buffer),
    });
  } catch (error) {
    console.error('Seed generation failed:', error);
    res.status(500).json({ error: error.message || 'Failed to generate seed image' });
  }
});

app.post('/api/extend', upload.single('seed'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Missing seed image upload' });
      return;
    }

    const iterations = Number.parseInt(req.body.iterations, 10) || ITERATIONS;
    const extendAllDirections = req.body.extendAllDirections === 'true';
    const result = await extendSeed(req.file.buffer, iterations, extendAllDirections);

    const seedMeta = await sharp(result.seed).metadata();
    const extendedMeta = await sharp(result.extended).metadata();

    res.json({
      seed: {
        width: seedMeta.width,
        height: seedMeta.height,
        image: toDataUrl(result.seed),
      },
      extended: {
        width: extendedMeta.width,
        height: extendedMeta.height,
        image: toDataUrl(result.extended),
        seedOffset: result.leftExtensionWidth,
      },
      steps: result.steps.map((step) => ({
        iteration: step.iteration,
        direction: step.direction,
        stage: step.stage || null,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to extend image' });
  }
});

const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
