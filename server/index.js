const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { fal } = require('@fal-ai/client');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MODEL_ID = 'fal-ai/flux-kontext-lora';
const PROMPT = 'fill in the blank area on the right';
const LORA_URL = 'https://v3.fal.media/files/monkey/o8_EQPk4RJRPeCSQjuCtZ_adapter_model.safetensors';
const NUM_INFERENCE_STEPS = 30;
const RESOLUTION_MODE = '1:1';
const ACCELERATION = 'none';
const OUTPUT_FORMAT = 'jpeg';
const GUIDANCE_SCALE = 2.5;
const ITERATIONS = 3;

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

async function extendSeed(buffer, iterations = ITERATIONS) {
  const seedBuffer = await ensureRgbPng(buffer);
  let accumulatedBuffer = seedBuffer;
  let contextBuffer = seedBuffer;
  const steps = [];

  const seedMeta = await sharp(seedBuffer).metadata();
  const expectedSize = { width: seedMeta.width || 0, height: seedMeta.height || 0 };

  for (let index = 0; index < iterations; index += 1) {
    const slidBuffer = await slideImageLeft(contextBuffer);
    const falBuffer = await callFal(slidBuffer, expectedSize);
    const newColumnBuffer = await extractRightThird(falBuffer);
    accumulatedBuffer = await appendColumn(accumulatedBuffer, newColumnBuffer);
    contextBuffer = falBuffer;

    steps.push({
      iteration: index + 1,
      slid: slidBuffer,
      fal: falBuffer,
      column: newColumnBuffer,
      extended: accumulatedBuffer,
    });
  }

  return { seed: seedBuffer, extended: accumulatedBuffer, steps };
}

function toDataUrl(buffer, mime = 'image/png') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

app.post('/api/extend', upload.single('seed'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Missing seed image upload' });
      return;
    }

    const iterations = Number.parseInt(req.body.iterations, 10) || ITERATIONS;
    const result = await extendSeed(req.file.buffer, iterations);

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
      },
      steps: result.steps.map((step) => ({
        iteration: step.iteration,
        slid: toDataUrl(step.slid),
        fal: toDataUrl(step.fal),
        column: toDataUrl(step.column),
        extended: toDataUrl(step.extended),
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
