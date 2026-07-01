import { DEFAULT_SETTINGS, createCanvasFromImage, processCyanotype } from "./imageProcessor.js";

const PRESETS = {
  classic: {
    contrast: 1.45,
    exposure: 0.08,
    blueIntensity: 1.05,
    textureStrength: 0.35,
    artifactStrength: 0.28,
  },
  contrast: {
    contrast: 2.25,
    exposure: 0.02,
    blueIntensity: 1.25,
    textureStrength: 0.22,
    artifactStrength: 0.2,
  },
  fabric: {
    contrast: 1.25,
    exposure: 0.12,
    blueIntensity: 0.9,
    textureStrength: 0.78,
    artifactStrength: 0.46,
  },
};

const MAX_EXPORT_PIXELS = 67_000_000;

export class CyanotypeUI {
  constructor() {
    this.elements = {
      fileInput: document.querySelector("#fileInput"),
      uploadButton: document.querySelector("#uploadButton"),
      dropZone: document.querySelector("#dropZone"),
      canvasWrap: document.querySelector("#canvasWrap"),
      canvas: document.querySelector("#previewCanvas"),
      emptyState: document.querySelector("#emptyState"),
      exportButton: document.querySelector("#exportButton"),
      exportScale: document.querySelector("#exportScale"),
      randomSeedButton: document.querySelector("#randomSeedButton"),
      beforeAfterToggle: document.querySelector("#beforeAfterToggle"),
      presetButtons: Array.from(document.querySelectorAll(".preset-button")),
      sliders: {
        contrast: document.querySelector("#contrast"),
        exposure: document.querySelector("#exposure"),
        blueIntensity: document.querySelector("#blueIntensity"),
        textureStrength: document.querySelector("#textureStrength"),
        artifactStrength: document.querySelector("#artifactStrength"),
      },
      outputs: {
        contrast: document.querySelector("#contrastValue"),
        exposure: document.querySelector("#exposureValue"),
        blueIntensity: document.querySelector("#blueValue"),
        textureStrength: document.querySelector("#textureValue"),
        artifactStrength: document.querySelector("#artifactValue"),
      },
    };

    this.settings = { ...DEFAULT_SETTINGS };
    this.previewSource = null;
    this.fullSource = null;
    this.processedPreview = null;
    this.renderRequest = null;
  }

  init() {
    this.bindEvents();
    this.syncControls();
    this.resizeCanvas(900, 620);
  }

  bindEvents() {
    const { fileInput, uploadButton, dropZone, canvasWrap } = this.elements;

    uploadButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => this.loadFile(fileInput.files?.[0]));
    window.addEventListener("paste", (event) => this.handlePaste(event));

    [dropZone, canvasWrap].forEach((target) => {
      target.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropZone.classList.add("is-dragging");
      });
      target.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
      target.addEventListener("drop", (event) => {
        event.preventDefault();
        dropZone.classList.remove("is-dragging");
        this.loadFile(event.dataTransfer.files?.[0]);
      });
    });

    Object.entries(this.elements.sliders).forEach(([key, input]) => {
      input.addEventListener("input", () => {
        this.settings[key] = Number(input.value);
        this.elements.outputs[key].value = input.value;
        this.scheduleRender();
      });
    });

    this.elements.presetButtons.forEach((button) => {
      button.addEventListener("click", () => this.applyPreset(button.dataset.preset));
    });

    this.elements.beforeAfterToggle.addEventListener("change", () => this.drawPreview());
    this.elements.randomSeedButton.addEventListener("click", () => {
      this.settings.seed = Math.floor(Math.random() * 1_000_000_000);
      this.scheduleRender();
    });
    this.elements.exportButton.addEventListener("click", () => this.exportPng());
  }

  handlePaste(event) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    const file = imageItem?.getAsFile();

    if (!file) return;
    event.preventDefault();
    this.loadFile(file);
  }

  async loadFile(file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      window.alert("Поддерживаются только JPG, PNG и WEBP.");
      return;
    }

    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      this.previewSource = createCanvasFromImage(image, 1800);
      this.fullSource = createCanvasFromImage(image, 4200);
      this.elements.emptyState.classList.add("is-hidden");
      this.elements.exportButton.disabled = false;
      this.scheduleRender();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    this.settings = { ...this.settings, ...preset };
    this.elements.presetButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.preset === name);
    });
    this.syncControls();
    this.scheduleRender();
  }

  syncControls() {
    Object.entries(this.elements.sliders).forEach(([key, input]) => {
      input.value = this.settings[key];
      this.elements.outputs[key].value = Number(this.settings[key]).toFixed(2);
    });
  }

  scheduleRender() {
    if (!this.previewSource) return;
    cancelAnimationFrame(this.renderRequest);
    this.renderRequest = requestAnimationFrame(() => {
      this.processedPreview = processCyanotype(this.previewSource, this.settings, 1);
      this.drawPreview();
    });
  }

  drawPreview() {
    const source = this.elements.beforeAfterToggle.checked ? this.previewSource : this.processedPreview;
    if (!source) return;

    this.resizeCanvas(source.width, source.height);
    const ctx = this.elements.canvas.getContext("2d");
    ctx.clearRect(0, 0, source.width, source.height);
    ctx.drawImage(source, 0, 0);
  }

  resizeCanvas(width, height) {
    const canvas = this.elements.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  exportPng() {
    if (!this.fullSource) return;
    const requestedScale = Number(this.elements.exportScale.value);
    const maxScale = Math.sqrt(MAX_EXPORT_PIXELS / (this.fullSource.width * this.fullSource.height));
    const scale = Math.min(requestedScale, Math.max(1, maxScale));
    const output = processCyanotype(this.fullSource, this.settings, scale);

    if (scale < requestedScale) {
      window.alert("Экспорт уменьшен до безопасного размера, чтобы браузер не исчерпал память.");
    }

    const link = document.createElement("a");
    link.download = `cyanotype-${Date.now()}.png`;
    link.href = output.toDataURL("image/png");
    link.click();
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Cannot load image"));
    image.src = url;
  });
}
