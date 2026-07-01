const MAX_PREVIEW_EDGE = 1800;

export const DEFAULT_SETTINGS = {
  contrast: 1.45,
  exposure: 0.08,
  blueIntensity: 1.05,
  textureStrength: 0.35,
  artifactStrength: 0.28,
  seed: 9482,
};

const PALETTE = [
  [11, 29, 58],
  [15, 47, 107],
  [31, 90, 166],
  [230, 242, 255],
];

export function createCanvasFromImage(image, maxEdge = MAX_PREVIEW_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function processCyanotype(sourceCanvas, settings = DEFAULT_SETTINGS, scale = 1) {
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  outputCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));

  const ctx = outputCanvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, 0, outputCanvas.width, outputCanvas.height);

  const imageData = ctx.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
  const pixels = imageData.data;
  const width = outputCanvas.width;
  const height = outputCanvas.height;
  const random = mulberry32(settings.seed);
  const stains = createStains(settings, width, height, random);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      const exposureMap = unevenExposure(x, y, width, height, settings.seed);
      const fiber = paperFiber(x, y, settings.seed);
      const grain = valueNoise(x * 0.85, y * 0.85, settings.seed + 41) - 0.5;
      const softDither = bayerDither(x, y) * 0.025 * settings.artifactStrength;
      const stain = sampleStains(x, y, stains);

      let tone = 1 - luminance;
      tone = applyLevels(tone + settings.exposure + exposureMap * settings.artifactStrength);
      tone = sigmoid(tone + softDither, settings.contrast);
      tone += (grain * 0.09 + fiber * 0.06) * settings.textureStrength;
      tone += stain * settings.artifactStrength * 0.5;
      tone = clamp(tone, 0, 1);

      const bleedTone = clamp(tone + edgeBleed(luminance, x, y, width, height, settings), 0, 1);
      const color = cyanotypeMap(bleedTone, settings.blueIntensity);
      const paperNoise = (grain * 10 + fiber * 16) * settings.textureStrength;

      pixels[index] = clampByte(color[0] + paperNoise);
      pixels[index + 1] = clampByte(color[1] + paperNoise * 0.78);
      pixels[index + 2] = clampByte(color[2] + paperNoise * 1.1);
      pixels[index + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  applySoftBloom(ctx, outputCanvas, settings);
  return outputCanvas;
}

function applyLevels(value) {
  return clamp((value - 0.04) / 0.92, 0, 1);
}

function sigmoid(value, contrast) {
  const centered = value - 0.5;
  return clamp(0.5 + Math.tanh(centered * contrast * 2.35) * 0.5, 0, 1);
}

function cyanotypeMap(tone, intensity) {
  const lifted = Math.pow(tone, 0.86);
  const stop = lifted < 0.5 ? lifted / 0.5 : (lifted - 0.5) / 0.5;
  const a = lifted < 0.5 ? PALETTE[3] : PALETTE[1];
  const c = lifted < 0.5 ? PALETTE[2] : PALETTE[0];
  const mixed = lerpColor(a, c, stop);
  const bluePush = clamp(intensity - 1, -0.5, 0.7);

  return [
    mixed[0] * (1 - bluePush * 0.18),
    mixed[1] * (1 - bluePush * 0.07),
    mixed[2] * (1 + bluePush * 0.12),
  ];
}

function edgeBleed(luminance, x, y, width, height, settings) {
  if (settings.artifactStrength <= 0) return 0;
  const n1 = valueNoise(x * 0.22, y * 0.22, settings.seed + 77);
  const n2 = valueNoise(x * 0.045, y * 0.045, settings.seed + 101);
  const edgeVignette =
    Math.pow(Math.abs(x / width - 0.5) * 2, 4) + Math.pow(Math.abs(y / height - 0.5) * 2, 4);
  return (1 - luminance) * (n1 - 0.48) * 0.06 * settings.artifactStrength + edgeVignette * n2 * 0.04;
}

function unevenExposure(x, y, width, height, seed) {
  const large = valueNoise((x / width) * 5, (y / height) * 5, seed + 19) - 0.5;
  const diagonal = ((x + y) / (width + height) - 0.5) * 0.06;
  return large * 0.12 + diagonal;
}

function paperFiber(x, y, seed) {
  const longFiber = valueNoise(x * 0.018, y * 0.24, seed + 7) - 0.5;
  const crossFiber = valueNoise(x * 0.18, y * 0.026, seed + 13) - 0.5;
  return longFiber * 0.75 + crossFiber * 0.35;
}

function createStains(settings, width, height, random) {
  const count = Math.round(7 + settings.artifactStrength * 20);
  return Array.from({ length: count }, () => ({
    x: random() * width,
    y: random() * height,
    radius: (0.04 + random() * 0.18) * Math.min(width, height),
    strength: (random() - 0.35) * 0.22,
  }));
}

function sampleStains(x, y, stains) {
  let value = 0;
  for (const stain of stains) {
    const dx = x - stain.x;
    const dy = y - stain.y;
    const distance = Math.sqrt(dx * dx + dy * dy) / stain.radius;
    if (distance < 1) {
      value += (1 - smoothstep(0, 1, distance)) * stain.strength;
    }
  }
  return value;
}

function applySoftBloom(ctx, canvas, settings) {
  if (settings.artifactStrength <= 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = settings.artifactStrength * 0.12;
  ctx.filter = `blur(${Math.max(0.4, canvas.width / 1600)}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}

function bayerDither(x, y) {
  const matrix = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  return matrix[y & 3][x & 3] / 15 - 0.5;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = smoothstep(0, 1, x - x0);
  const yf = smoothstep(0, 1, y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695041;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function lerpColor(a, b, amount) {
  return [lerp(a[0], b[0], amount), lerp(a[1], b[1], amount), lerp(a[2], b[2], amount)];
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampByte(value) {
  return Math.round(clamp(value, 0, 255));
}
