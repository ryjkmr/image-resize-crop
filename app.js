const editorCanvas = document.getElementById("editorCanvas");
const editorCtx = editorCanvas.getContext("2d");
const resultCanvas = document.getElementById("resultCanvas");
const resultCtx = resultCanvas.getContext("2d");

const fileInput = document.getElementById("fileInput");
const fileButton = document.getElementById("fileButton");
const dropZone = document.getElementById("dropZone");
const emptyState = document.getElementById("emptyState");
const imageMeta = document.getElementById("imageMeta");
const resultMeta = document.getElementById("resultMeta");
const cropInputs = {
  x: document.getElementById("cropX"),
  y: document.getElementById("cropY"),
  width: document.getElementById("cropWidth"),
  height: document.getElementById("cropHeight"),
};

const resizeFields = {
  width: document.getElementById("resizeWidth"),
  height: document.getElementById("resizeHeight"),
  percent: document.getElementById("resizePercent"),
};

const resizeSummary = document.getElementById("resizeSummary");
const applyButton = document.getElementById("applyButton");
const downloadButton = document.getElementById("downloadButton");
const resizeModeInputs = [...document.querySelectorAll('input[name="resizeMode"]')];
const presetButtons = [...document.querySelectorAll(".preset")];

const HANDLE_SIZE = 14;
const MIN_CROP_SIZE = 24;

const state = {
  image: null,
  imageName: "image.png",
  crop: null,
  aspectMode: "free",
  dragMode: null,
  dragOrigin: null,
  displayRect: null,
  output: null,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value) {
  return Math.round(value);
}

function aspectRatioFromMode() {
  if (state.aspectMode === "free") {
    return null;
  }
  if (state.aspectMode === "original") {
    return state.image ? state.image.width / state.image.height : null;
  }
  return Number(state.aspectMode);
}

function currentResizeMode() {
  return resizeModeInputs.find((input) => input.checked)?.value ?? "width";
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("画像の読み込みに失敗しました。"));
    };
    image.src = objectUrl;
  });
}

function fitRect(sourceWidth, sourceHeight, boundWidth, boundHeight) {
  const scale = Math.min(boundWidth / sourceWidth, boundHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (boundWidth - width) / 2,
    y: (boundHeight - height) / 2,
    width,
    height,
  };
}

function ensureCropWithinImage(crop) {
  if (!state.image) {
    return crop;
  }

  let next = { ...crop };
  next.width = clamp(next.width, MIN_CROP_SIZE, state.image.width);
  next.height = clamp(next.height, MIN_CROP_SIZE, state.image.height);
  next.x = clamp(next.x, 0, state.image.width - next.width);
  next.y = clamp(next.y, 0, state.image.height - next.height);
  return next;
}

function setCrop(nextCrop, syncInputs = true) {
  state.crop = ensureCropWithinImage(nextCrop);
  if (syncInputs) {
    cropInputs.x.value = round(state.crop.x);
    cropInputs.y.value = round(state.crop.y);
    cropInputs.width.value = round(state.crop.width);
    cropInputs.height.value = round(state.crop.height);
  }
  renderEditor();
}

function cropToCanvasRect(crop) {
  const rect = state.displayRect;
  return {
    x: rect.x + (crop.x / state.image.width) * rect.width,
    y: rect.y + (crop.y / state.image.height) * rect.height,
    width: (crop.width / state.image.width) * rect.width,
    height: (crop.height / state.image.height) * rect.height,
  };
}

function setAspectMode(mode) {
  state.aspectMode = mode;
  presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.aspect === mode);
  });

  if (!state.image || !state.crop) {
    return;
  }

  const ratio = aspectRatioFromMode();
  const centerX = state.crop.x + state.crop.width / 2;
  const centerY = state.crop.y + state.crop.height / 2;

  let width = state.crop.width;
  let height = state.crop.height;

  if (ratio) {
    if (width / height > ratio) {
      width = height * ratio;
    } else {
      height = width / ratio;
    }
  }

  const crop = ensureCropWithinImage({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  });

  setCrop(adjustCropToAspect(crop, ratio));
  refreshResizeSummary();
  renderOutput();
}

function adjustCropToAspect(crop, aspectRatio) {
  if (!state.image || !aspectRatio) {
    return ensureCropWithinImage(crop);
  }

  let width = crop.width;
  let height = crop.height;

  if (width / height > aspectRatio) {
    width = height * aspectRatio;
  } else {
    height = width / aspectRatio;
  }

  width = Math.min(width, state.image.width);
  height = Math.min(height, state.image.height);

  const x = clamp(crop.x, 0, state.image.width - width);
  const y = clamp(crop.y, 0, state.image.height - height);

  return ensureCropWithinImage({ x, y, width, height });
}

function initializeCrop() {
  if (!state.image) {
    return;
  }

  const padding = 0.08;
  const width = state.image.width * (1 - padding * 2);
  const height = state.image.height * (1 - padding * 2);
  const crop = {
    x: state.image.width * padding,
    y: state.image.height * padding,
    width,
    height,
  };

  state.aspectMode = "free";
  presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.aspect === "free");
  });
  setCrop(crop);
}

function renderEditor() {
  editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);

  if (!state.image) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  const rect = fitRect(state.image.width, state.image.height, editorCanvas.width, editorCanvas.height);
  state.displayRect = rect;

  editorCtx.drawImage(state.image, rect.x, rect.y, rect.width, rect.height);

  if (!state.crop) {
    return;
  }

  const cropRect = cropToCanvasRect(state.crop);

  editorCtx.save();
  editorCtx.fillStyle = "rgba(15, 22, 18, 0.52)";
  editorCtx.beginPath();
  editorCtx.rect(0, 0, editorCanvas.width, editorCanvas.height);
  editorCtx.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  editorCtx.fill("evenodd");

  editorCtx.strokeStyle = "#ffffff";
  editorCtx.lineWidth = 2;
  editorCtx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);

  editorCtx.setLineDash([6, 6]);
  editorCtx.strokeStyle = "rgba(255,255,255,0.7)";
  editorCtx.beginPath();
  editorCtx.moveTo(cropRect.x + cropRect.width / 3, cropRect.y);
  editorCtx.lineTo(cropRect.x + cropRect.width / 3, cropRect.y + cropRect.height);
  editorCtx.moveTo(cropRect.x + (cropRect.width * 2) / 3, cropRect.y);
  editorCtx.lineTo(cropRect.x + (cropRect.width * 2) / 3, cropRect.y + cropRect.height);
  editorCtx.moveTo(cropRect.x, cropRect.y + cropRect.height / 3);
  editorCtx.lineTo(cropRect.x + cropRect.width, cropRect.y + cropRect.height / 3);
  editorCtx.moveTo(cropRect.x, cropRect.y + (cropRect.height * 2) / 3);
  editorCtx.lineTo(cropRect.x + cropRect.width, cropRect.y + (cropRect.height * 2) / 3);
  editorCtx.stroke();
  editorCtx.setLineDash([]);

  for (const handle of getHandles(cropRect)) {
    editorCtx.fillStyle = "#2a6f4f";
    editorCtx.fillRect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    editorCtx.strokeStyle = "#ffffff";
    editorCtx.strokeRect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }

  editorCtx.restore();
}

function getHandles(rect) {
  return [
    { name: "nw", x: rect.x, y: rect.y },
    { name: "ne", x: rect.x + rect.width, y: rect.y },
    { name: "sw", x: rect.x, y: rect.y + rect.height },
    { name: "se", x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

function pointToCanvasSpace(clientX, clientY) {
  const bounds = editorCanvas.getBoundingClientRect();
  return {
    x: ((clientX - bounds.left) / bounds.width) * editorCanvas.width,
    y: ((clientY - bounds.top) / bounds.height) * editorCanvas.height,
  };
}

function pointToImageSpace(clientX, clientY) {
  const point = pointToCanvasSpace(clientX, clientY);
  const rect = state.displayRect;

  if (!rect) {
    return null;
  }

  return {
    x: clamp((point.x - rect.x) * (state.image.width / rect.width), 0, state.image.width),
    y: clamp((point.y - rect.y) * (state.image.height / rect.height), 0, state.image.height),
  };
}

function isPointInsideImage(point) {
  if (!state.displayRect || !point) {
    return false;
  }
  return (
    point.x >= state.displayRect.x &&
    point.x <= state.displayRect.x + state.displayRect.width &&
    point.y >= state.displayRect.y &&
    point.y <= state.displayRect.y + state.displayRect.height
  );
}

function detectDragMode(clientX, clientY) {
  if (!state.crop || !state.displayRect) {
    return null;
  }

  const point = pointToCanvasSpace(clientX, clientY);
  const cropRect = cropToCanvasRect(state.crop);

  for (const handle of getHandles(cropRect)) {
    if (
      Math.abs(point.x - handle.x) <= HANDLE_SIZE &&
      Math.abs(point.y - handle.y) <= HANDLE_SIZE
    ) {
      return handle.name;
    }
  }

  if (
    point.x >= cropRect.x &&
    point.x <= cropRect.x + cropRect.width &&
    point.y >= cropRect.y &&
    point.y <= cropRect.y + cropRect.height
  ) {
    return "move";
  }

  return isPointInsideImage(point) ? "draw" : null;
}

function buildFreeformCrop(start, current) {
  const left = clamp(Math.min(start.x, current.x), 0, state.image.width);
  const top = clamp(Math.min(start.y, current.y), 0, state.image.height);
  const right = clamp(Math.max(start.x, current.x), 0, state.image.width);
  const bottom = clamp(Math.max(start.y, current.y), 0, state.image.height);
  return ensureCropWithinImage({
    x: left,
    y: top,
    width: Math.max(MIN_CROP_SIZE, right - left),
    height: Math.max(MIN_CROP_SIZE, bottom - top),
  });
}

function buildAspectCrop(start, current, aspectRatio) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const directionX = dx >= 0 ? 1 : -1;
  const directionY = dy >= 0 ? 1 : -1;

  let width = Math.abs(dx);
  let height = Math.abs(dy);

  if (width / Math.max(height, 1) > aspectRatio) {
    height = width / aspectRatio;
  } else {
    width = height * aspectRatio;
  }

  width = Math.max(MIN_CROP_SIZE, width);
  height = Math.max(MIN_CROP_SIZE, height);

  let x = start.x + (directionX < 0 ? -width : 0);
  let y = start.y + (directionY < 0 ? -height : 0);

  x = clamp(x, 0, state.image.width - width);
  y = clamp(y, 0, state.image.height - height);

  let crop = { x, y, width, height };

  if (crop.x + crop.width > state.image.width) {
    crop.width = state.image.width - crop.x;
    crop.height = crop.width / aspectRatio;
    if (directionY < 0) {
      crop.y = start.y - crop.height;
    }
  }
  if (crop.y + crop.height > state.image.height) {
    crop.height = state.image.height - crop.y;
    crop.width = crop.height * aspectRatio;
    if (directionX < 0) {
      crop.x = start.x - crop.width;
    }
  }

  return adjustCropToAspect(ensureCropWithinImage(crop), aspectRatio);
}

function buildCropFromDrag(start, current, aspectRatio) {
  if (!aspectRatio) {
    return buildFreeformCrop(start, current);
  }
  return buildAspectCrop(start, current, aspectRatio);
}

function updateCropFromPointer(point) {
  if (!point || !state.dragOrigin || !state.crop) {
    return;
  }

  const aspectRatio = aspectRatioFromMode();
  const dx = point.x - state.dragOrigin.pointer.x;
  const dy = point.y - state.dragOrigin.pointer.y;

  if (state.dragMode === "move") {
    setCrop({
      ...state.dragOrigin.crop,
      x: state.dragOrigin.crop.x + dx,
      y: state.dragOrigin.crop.y + dy,
    });
    return;
  }

  if (state.dragMode === "draw") {
    setCrop(buildCropFromDrag(state.dragOrigin.pointer, point, aspectRatio));
    return;
  }

  const origin = state.dragOrigin.crop;
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;

  if (state.dragMode.includes("n")) {
    top = clamp(origin.y + dy, 0, bottom - MIN_CROP_SIZE);
  }
  if (state.dragMode.includes("s")) {
    bottom = clamp(origin.y + origin.height + dy, top + MIN_CROP_SIZE, state.image.height);
  }
  if (state.dragMode.includes("w")) {
    left = clamp(origin.x + dx, 0, right - MIN_CROP_SIZE);
  }
  if (state.dragMode.includes("e")) {
    right = clamp(origin.x + origin.width + dx, left + MIN_CROP_SIZE, state.image.width);
  }

  let crop = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };

  if (aspectRatio) {
    const anchorX = state.dragMode.includes("w") ? right : left;
    const anchorY = state.dragMode.includes("n") ? bottom : top;

    if (crop.width / crop.height > aspectRatio) {
      crop.height = crop.width / aspectRatio;
    } else {
      crop.width = crop.height * aspectRatio;
    }

    if (state.dragMode.includes("w")) {
      crop.x = anchorX - crop.width;
    }
    if (state.dragMode.includes("n")) {
      crop.y = anchorY - crop.height;
    }

    crop = ensureCropWithinImage(crop);
    crop = adjustCropToAspect(crop, aspectRatio);
  }

  setCrop(crop);
}

function updateResizeVisibility() {
  const mode = currentResizeMode();
  document.querySelectorAll("[data-mode]").forEach((element) => {
    element.classList.toggle("hidden", element.dataset.mode !== mode);
  });
  refreshResizeSummary();
}

function getOutputSize() {
  if (!state.crop) {
    return null;
  }

  const mode = currentResizeMode();
  if (mode === "width") {
    const width = Math.max(1, Number(resizeFields.width.value || round(state.crop.width)));
    return {
      width,
      height: Math.max(1, round((width / state.crop.width) * state.crop.height)),
    };
  }

  if (mode === "height") {
    const height = Math.max(1, Number(resizeFields.height.value || round(state.crop.height)));
    return {
      width: Math.max(1, round((height / state.crop.height) * state.crop.width)),
      height,
    };
  }

  const percent = Math.max(1, Number(resizeFields.percent.value || 100));
  return {
    width: Math.max(1, round(state.crop.width * (percent / 100))),
    height: Math.max(1, round(state.crop.height * (percent / 100))),
  };
}

function refreshResizeSummary() {
  const output = getOutputSize();
  resizeSummary.textContent = output ? `${output.width} x ${output.height}px` : "-";
}

function renderOutput() {
  if (!state.image || !state.crop) {
    resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
    resultMeta.textContent = "";
    downloadButton.disabled = true;
    return;
  }

  const output = getOutputSize();
  state.output = output;

  resultCanvas.width = output.width;
  resultCanvas.height = output.height;

  resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  resultCtx.drawImage(
    state.image,
    state.crop.x,
    state.crop.y,
    state.crop.width,
    state.crop.height,
    0,
    0,
    output.width,
    output.height,
  );

  resultMeta.textContent = `${output.width} x ${output.height}px`;
  downloadButton.disabled = false;
}

async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    return;
  }

  const image = await fileToImage(file);
  state.image = image;
  state.imageName = file.name || "image.png";
  imageMeta.textContent = `${image.width} x ${image.height}px / ${file.type || "image"}`;
  resizeFields.width.value = image.width;
  resizeFields.height.value = image.height;
  resizeFields.percent.value = 100;
  initializeCrop();
  refreshResizeSummary();
  renderOutput();
}

function handleCropInputChange() {
  if (!state.image) {
    return;
  }

  let crop = {
    x: Number(cropInputs.x.value || 0),
    y: Number(cropInputs.y.value || 0),
    width: Number(cropInputs.width.value || state.image.width),
    height: Number(cropInputs.height.value || state.image.height),
  };

  const ratio = aspectRatioFromMode();
  if (ratio) {
    crop = adjustCropToAspect(crop, ratio);
  }

  setCrop(crop, true);
  refreshResizeSummary();
}

fileButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  await loadFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  });
});

dropZone.addEventListener("drop", async (event) => {
  const [file] = [...event.dataTransfer.files];
  await loadFile(file);
});

window.addEventListener("paste", async (event) => {
  const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith("image/"));
  if (!item) {
    return;
  }
  await loadFile(item.getAsFile());
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => setAspectMode(button.dataset.aspect));
});

Object.values(cropInputs).forEach((input) => {
  input.addEventListener("input", handleCropInputChange);
});

resizeModeInputs.forEach((input) => {
  input.addEventListener("change", updateResizeVisibility);
});

Object.values(resizeFields).forEach((input) => {
  input.addEventListener("input", refreshResizeSummary);
});

applyButton.addEventListener("click", renderOutput);

downloadButton.addEventListener("click", () => {
  const link = document.createElement("a");
  const baseName = state.imageName.replace(/\.[^.]+$/, "") || "image";
  link.href = resultCanvas.toDataURL("image/png");
  link.download = `${baseName}-cropped-resized.png`;
  link.click();
});

editorCanvas.addEventListener("pointerdown", (event) => {
  if (!state.image || !state.crop) {
    return;
  }

  const dragMode = detectDragMode(event.clientX, event.clientY);
  if (!dragMode) {
    return;
  }

  const point = pointToImageSpace(event.clientX, event.clientY);
  state.dragMode = dragMode;
  state.dragOrigin = {
    pointer: point,
    crop: { ...state.crop },
  };

  if (dragMode === "draw") {
    setCrop(buildCropFromDrag(point, point, aspectRatioFromMode()));
  }

  editorCanvas.setPointerCapture(event.pointerId);
});

editorCanvas.addEventListener("pointermove", (event) => {
  if (!state.dragMode) {
    return;
  }

  const point = pointToImageSpace(event.clientX, event.clientY);
  updateCropFromPointer(point);
  refreshResizeSummary();
});

function stopDragging(event) {
  if (!state.dragMode) {
    return;
  }

  const didChangeCrop = Boolean(state.dragOrigin);

  if (typeof event.pointerId === "number") {
    editorCanvas.releasePointerCapture(event.pointerId);
  }
  state.dragMode = null;
  state.dragOrigin = null;

  if (didChangeCrop) {
    refreshResizeSummary();
    renderOutput();
  }
}

editorCanvas.addEventListener("pointerup", stopDragging);
editorCanvas.addEventListener("pointercancel", stopDragging);

window.addEventListener("resize", renderEditor);

updateResizeVisibility();
renderEditor();
renderOutput();
