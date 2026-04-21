#!/usr/bin/env node
import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff"]);
let sharpInstance = null;

async function getSharp() {
  if (sharpInstance) {
    return sharpInstance;
  }

  try {
    const module = await import("sharp");
    sharpInstance = module.default;
    return sharpInstance;
  } catch {
    throw new Error("sharp is not installed. Run `npm install` before batch processing.");
  }
}

function printHelp() {
  console.log(`Usage:
  npm run batch -- [options] <file-or-directory...>

Options:
  --crop x,y,width,height       Crop rectangle in pixels. Omit to use the full image.
  --resize none                 Do not resize after cropping. Default.
  --resize width --width 800    Resize by output width, keeping aspect ratio.
  --resize height --height 600  Resize by output height, keeping aspect ratio.
  --resize percent --percent 50 Resize by percentage of the cropped size.
  --out-dir <dir>               Output directory. Default: batch-output
  --format png|jpeg|webp        Output format. Default: png
  --quality <1-100>             JPEG/WebP quality. Default: 90
  --suffix <text>               Output filename suffix. Default: -processed

Examples:
  npm run batch -- --crop 100,80,1200,800 --resize width --width 640 img1.jpg img2.png
  npm run batch -- --crop 0,0,1080,1080 --resize none --out-dir out ./images
  npm run batch -- --resize percent --percent 50 ./images`);
}

function readOption(args, index) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${args[index]} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    crop: null,
    resize: "none",
    width: null,
    height: null,
    percent: null,
    outDir: "batch-output",
    format: "png",
    quality: 90,
    suffix: "-processed",
    inputs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--crop") {
      const raw = readOption(argv, i);
      const values = raw.split(",").map((value) => Number(value.trim()));
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        throw new Error("--crop must be x,y,width,height");
      }
      options.crop = {
        x: Math.round(values[0]),
        y: Math.round(values[1]),
        width: Math.round(values[2]),
        height: Math.round(values[3]),
      };
      i += 1;
      continue;
    }

    if (arg === "--resize") {
      options.resize = readOption(argv, i);
      i += 1;
      continue;
    }

    if (arg === "--width") {
      options.width = Number(readOption(argv, i));
      i += 1;
      continue;
    }

    if (arg === "--height") {
      options.height = Number(readOption(argv, i));
      i += 1;
      continue;
    }

    if (arg === "--percent") {
      options.percent = Number(readOption(argv, i));
      i += 1;
      continue;
    }

    if (arg === "--out-dir") {
      options.outDir = readOption(argv, i);
      i += 1;
      continue;
    }

    if (arg === "--format") {
      options.format = readOption(argv, i).toLowerCase();
      i += 1;
      continue;
    }

    if (arg === "--quality") {
      options.quality = Number(readOption(argv, i));
      i += 1;
      continue;
    }

    if (arg === "--suffix") {
      options.suffix = readOption(argv, i);
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.inputs.push(arg);
  }

  return options;
}

function validateOptions(options) {
  if (options.help) {
    return;
  }

  if (!["none", "width", "height", "percent"].includes(options.resize)) {
    throw new Error("--resize must be one of: none, width, height, percent");
  }

  if (!["png", "jpeg", "webp"].includes(options.format)) {
    throw new Error("--format must be one of: png, jpeg, webp");
  }

  if (options.resize === "width" && (!Number.isFinite(options.width) || options.width < 1)) {
    throw new Error("--resize width requires --width 1 or greater");
  }

  if (options.resize === "height" && (!Number.isFinite(options.height) || options.height < 1)) {
    throw new Error("--resize height requires --height 1 or greater");
  }

  if (options.resize === "percent" && (!Number.isFinite(options.percent) || options.percent < 1)) {
    throw new Error("--resize percent requires --percent 1 or greater");
  }

  if (!Number.isFinite(options.quality) || options.quality < 1 || options.quality > 100) {
    throw new Error("--quality must be 1-100");
  }

  if (options.crop && (options.crop.width < 1 || options.crop.height < 1)) {
    throw new Error("--crop width and height must be 1 or greater");
  }

  if (options.inputs.length === 0) {
    throw new Error("At least one file or directory is required");
  }
}

async function collectInputFiles(paths) {
  const files = [];

  for (const path of paths) {
    if (!existsSync(path)) {
      console.warn(`Skip missing path: ${path}`);
      continue;
    }

    const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
        files.push(path);
      }
      continue;
    }

    for (const entry of entries) {
      const childPath = join(path, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectInputFiles([childPath])));
      } else if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(childPath);
      }
    }
  }

  return files;
}

function clampCrop(crop, width, height) {
  const left = Math.max(0, Math.min(crop.x, width - 1));
  const top = Math.max(0, Math.min(crop.y, height - 1));
  const cropWidth = Math.max(1, Math.min(crop.width, width - left));
  const cropHeight = Math.max(1, Math.min(crop.height, height - top));

  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
  };
}

function getOutputSize(options, crop) {
  if (options.resize === "none") {
    return {
      width: crop.width,
      height: crop.height,
    };
  }

  if (options.resize === "width") {
    return {
      width: Math.round(options.width),
      height: Math.max(1, Math.round((options.width / crop.width) * crop.height)),
    };
  }

  if (options.resize === "height") {
    return {
      width: Math.max(1, Math.round((options.height / crop.height) * crop.width)),
      height: Math.round(options.height),
    };
  }

  return {
    width: Math.max(1, Math.round(crop.width * (options.percent / 100))),
    height: Math.max(1, Math.round(crop.height * (options.percent / 100))),
  };
}

function outputPathFor(inputPath, options) {
  const name = basename(inputPath, extname(inputPath));
  return join(options.outDir, `${name}${options.suffix}.${options.format}`);
}

async function processFile(inputPath, options) {
  const sharp = await getSharp();
  const normalized = await sharp(inputPath).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = normalized.info;
  const crop = clampCrop(options.crop ?? { x: 0, y: 0, width, height }, width, height);
  const outputSize = getOutputSize(options, crop);
  const outputPath = outputPathFor(inputPath, options);

  await sharp(normalized.data)
    .extract(crop)
    .resize(outputSize)
    .toFormat(options.format, {
      quality: Math.round(options.quality),
    })
    .toFile(outputPath);

  console.log(`${inputPath} -> ${outputPath} (${outputSize.width}x${outputSize.height})`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  validateOptions(options);
  await mkdir(options.outDir, { recursive: true });

  const files = await collectInputFiles(options.inputs);
  if (files.length === 0) {
    throw new Error("No supported image files found");
  }

  for (const file of files) {
    await processFile(file, options);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
