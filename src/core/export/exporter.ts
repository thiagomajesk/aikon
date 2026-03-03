import * as gifencModule from "gifenc";
import {
  normalizeAnimationClipState,
  resolveAnimationPresetSteps,
} from "../editor";
import type {
  AnimationClipState,
  AnimationStepTransform,
  ThreeStepAnimation,
} from "../editor";
import type { ExportAnimationSummary, ExportFormat, ExportRequest } from "./types";

const MIME_BY_FORMAT: Record<Exclude<ExportFormat, "svg" | "gif" | "webm" | "mp4">, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const ANIMATED_FORMATS = new Set<ExportFormat>(["gif", "webp", "webm", "mp4"]);
const VIDEO_FORMATS = new Set<ExportFormat>(["webm", "mp4"]);
const VIDEO_MIME_CANDIDATES: Record<"webm" | "mp4", string[]> = {
  webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
  mp4: ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"],
};

interface GifencApi {
  GIFEncoder: (...args: unknown[]) => unknown;
  applyPalette: (...args: unknown[]) => Uint8Array;
  quantize: (...args: unknown[]) => number[][];
}

interface AnimatedWebpEncoder {
  init: () => Promise<void>;
  addFrame: (fileBytes: Uint8Array, duration: number) => Promise<void>;
  save: () => Promise<Uint8Array>;
}

interface AnimatedWebpApi {
  encodeRGBA: (
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    quality?: number,
  ) => Promise<Uint8Array>;
  Encoder: new (width: number, height: number) => AnimatedWebpEncoder;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input === "object" && input !== null) {
    return input as Record<string, unknown>;
  }

  if (typeof input === "function") {
    return input as unknown as Record<string, unknown>;
  }

  return null;
}

export function resolveGifencApi(moduleValue: unknown): GifencApi | null {
  const root = asRecord(moduleValue);
  if (!root) {
    return null;
  }

  const candidates: unknown[] = [
    root,
    root.default,
    root["module.exports"],
    asRecord(root.default)?.default,
    asRecord(root.default)?.["module.exports"],
    asRecord(root["module.exports"])?.default,
    asRecord(root["module.exports"])?.["module.exports"],
  ];

  for (const candidate of candidates) {
    const entry = asRecord(candidate);
    if (!entry) {
      continue;
    }

    const rawGifEncoder =
      (typeof entry.GIFEncoder === "function" ? entry.GIFEncoder : undefined) ??
      (typeof candidate === "function" ? candidate : undefined);
    const rawApplyPalette =
      typeof entry.applyPalette === "function" ? entry.applyPalette : undefined;
    const rawQuantize =
      typeof entry.quantize === "function" ? entry.quantize : undefined;

    if (rawGifEncoder && rawApplyPalette && rawQuantize) {
      return {
        GIFEncoder: rawGifEncoder as (...args: unknown[]) => unknown,
        applyPalette: rawApplyPalette as (...args: unknown[]) => Uint8Array,
        quantize: rawQuantize as (...args: unknown[]) => number[][],
      };
    }
  }

  return null;
}

const STATIC_GIFENC_API = resolveGifencApi(gifencModule);
let animatedWebpApiPromise: Promise<AnimatedWebpApi> | null = null;

interface ActiveAnimationClip {
  clip: AnimationClipState;
  targetPathId: string | null;
  steps: ThreeStepAnimation;
  ease: (progress: number) => number;
}

interface RenderSequence {
  clips: ActiveAnimationClip[];
  fps: number;
  frameCount: number;
  durationMs: number;
}
const GIF_ALPHA_THRESHOLD = 1;
const GIF_MAX_PALETTE_SAMPLE_PIXELS = 180_000;

function resolveEaseFunction(easeName: string): (progress: number) => number {
  if (easeName === "inOutSine") {
    return (t) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
  }

  if (easeName === "inOutQuad") {
    return (t) => {
      const p = clamp(t, 0, 1);
      return p < 0.5 ? 2 * p * p : 1 - (Math.pow(-2 * p + 2, 2) / 2);
    };
  }

  if (easeName === "inOutBack") {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    return (t) => {
      const p = clamp(t, 0, 1);
      if (p < 0.5) {
        return (Math.pow(2 * p, 2) * ((c2 + 1) * 2 * p - c2)) / 2;
      }

      return (
        (Math.pow(2 * p - 2, 2) * ((c2 + 1) * (p * 2 - 2) + c2) + 2) / 2
      );
    };
  }

  if (easeName === "outElastic") {
    const c4 = (2 * Math.PI) / 3;
    return (t) => {
      const p = clamp(t, 0, 1);
      if (p === 0) {
        return 0;
      }
      if (p === 1) {
        return 1;
      }
      return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
    };
  }

  if (easeName === "inOutExpo") {
    return (t) => {
      const p = clamp(t, 0, 1);
      if (p === 0) {
        return 0;
      }
      if (p === 1) {
        return 1;
      }
      if (p < 0.5) {
        return Math.pow(2, 20 * p - 10) / 2;
      }
      return (2 - Math.pow(2, -20 * p + 10)) / 2;
    };
  }

  return (t) => clamp(t, 0, 1);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Export canceled.");
  }
}

function reportExportProgress(
  options: ExportRequest,
  value: number,
  message?: string,
): void {
  options.onProgress?.(Math.max(0, Math.min(100, Math.round(value))), message);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function sanitizeAnimationFrameCount(frameCount: number): number {
  return Math.max(2, Math.min(600, frameCount));
}

function normalizeExportSize(value: number): number {
  return Math.max(64, Math.min(4096, Math.round(value)));
}

function normalizeExportFps(value: number): number {
  return Math.max(1, Math.min(60, Math.round(value)));
}

function normalizeExportQuality(value: number): number {
  return clamp(value, 0.1, 1);
}

function resolveWebpQualityPercent(value: number): number {
  return Math.round(normalizeExportQuality(value) * 100);
}

function resolveRenderSequence(options: ExportRequest): RenderSequence {
  const clips = collectActiveAnimationClips(
    options.animationClip,
    options.pathAnimationClips,
  );
  const fps = normalizeExportFps(options.fps);
  const animationDurationMs = resolveAnimationDurationMs(clips);
  const frameCount =
    clips.length === 0
      ? 1
      : sanitizeAnimationFrameCount(Math.ceil((animationDurationMs / 1000) * fps));
  const durationMs =
    frameCount <= 1 ? Math.max(1000 / fps, animationDurationMs) : (frameCount * 1000) / fps;

  return {
    clips,
    fps,
    frameCount,
    durationMs,
  };
}

function resolveFrameElapsedMs(frameIndex: number, fps: number): number {
  return (frameIndex * 1000) / fps;
}

function resetAnimatedTransforms(host: ParentNode): void {
  const nodes = host.querySelectorAll(
    '[data-foreground-root="true"], [data-foreground-path-id]',
  );
  for (const node of nodes) {
    if (!(node instanceof SVGElement)) {
      continue;
    }

    node.style.transform = "";
    node.style.opacity = "";
    node.style.transformOrigin = "";
    node.style.transformBox = "";
  }
}

function collectActiveAnimationClips(
  animationClip: AnimationClipState,
  pathAnimationClips: Record<string, AnimationClipState>,
): ActiveAnimationClip[] {
  const active: ActiveAnimationClip[] = [];
  const global = normalizeAnimationClipState({
    ...animationClip,
    targetPathId: null,
  });
  if (global.preset !== "none") {
    const steps = resolveAnimationPresetSteps(global.preset);
    if (steps) {
      active.push({
        clip: global,
        targetPathId: null,
        steps,
        ease: resolveEaseFunction(global.ease),
      });
    }
  }

  for (const [pathId, clip] of Object.entries(pathAnimationClips)) {
    const normalized = normalizeAnimationClipState({
      ...clip,
      targetPathId: pathId,
    });
    if (normalized.preset === "none") {
      continue;
    }

    const steps = resolveAnimationPresetSteps(normalized.preset);
    if (!steps) {
      continue;
    }

    active.push({
      clip: normalized,
      targetPathId: pathId,
      steps,
      ease: resolveEaseFunction(normalized.ease),
    });
  }

  return active;
}

function resolveAnimationDurationMs(clips: ActiveAnimationClip[]): number {
  if (clips.length === 0) {
    return 0;
  }

  return Math.max(
    ...clips.map((entry) => {
      const base = Math.max(200, Math.round(entry.clip.durationMs));
      if (entry.clip.loop && entry.clip.alternate) {
        return base * 2;
      }
      return base;
    }),
  );
}

function resolveClipTimelineProgress(
  clip: AnimationClipState,
  elapsedMs: number,
): number {
  const durationMs = Math.max(200, Math.round(clip.durationMs));
  if (durationMs <= 0) {
    return 1;
  }

  if (!clip.loop) {
    return clamp(elapsedMs / durationMs, 0, 1);
  }

  if (!clip.alternate) {
    const wrapped = elapsedMs % durationMs;
    return clamp(wrapped / durationMs, 0, 1);
  }

  const alternateDuration = durationMs * 2;
  const wrapped = elapsedMs % alternateDuration;
  if (wrapped <= durationMs) {
    return clamp(wrapped / durationMs, 0, 1);
  }
  return clamp(1 - (wrapped - durationMs) / durationMs, 0, 1);
}

function resolveStepTransformAtProgress(
  steps: ThreeStepAnimation,
  ease: (progress: number) => number,
  progress: number,
): AnimationStepTransform {
  const clampedProgress = clamp(progress, 0, 1);
  const [start, middle, end] = steps;
  const isFirstHalf = clampedProgress <= 0.5;
  const segmentProgress = isFirstHalf
    ? clampedProgress * 2
    : (clampedProgress - 0.5) * 2;
  const easedProgress = clamp(ease(segmentProgress), 0, 1);
  const from = isFirstHalf ? start : middle;
  const to = isFirstHalf ? middle : end;

  return {
    x: lerp(from.x, to.x, easedProgress),
    y: lerp(from.y, to.y, easedProgress),
    scale: lerp(from.scale, to.scale, easedProgress),
    rotate: lerp(from.rotate, to.rotate, easedProgress),
    opacity: lerp(from.opacity ?? 1, to.opacity ?? 1, easedProgress),
    skewX: lerp(from.skewX ?? 0, to.skewX ?? 0, easedProgress),
    skewY: lerp(from.skewY ?? 0, to.skewY ?? 0, easedProgress),
  };
}

function applyTransformStyles(
  element: SVGElement,
  transform: AnimationStepTransform,
): void {
  const x = transform.x.toFixed(3);
  const y = transform.y.toFixed(3);
  const scale = transform.scale.toFixed(6);
  const rotate = transform.rotate.toFixed(3);
  const skewX = (transform.skewX ?? 0).toFixed(3);
  const skewY = (transform.skewY ?? 0).toFixed(3);
  const opacity = clamp(transform.opacity ?? 1, 0, 1);

  element.style.transformOrigin = "center";
  element.style.transformBox = "fill-box";
  element.style.transform = [
    `translate(${x}px, ${y}px)`,
    `scale(${scale})`,
    `rotate(${rotate}deg)`,
    `skewX(${skewX}deg)`,
    `skewY(${skewY}deg)`,
  ].join(" ");
  element.style.opacity = opacity.toString();
}

function buildAnimatedFrameSvg(
  svg: string,
  clips: ActiveAnimationClip[],
  elapsedMs: number,
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const svgNode = doc.querySelector("svg");
  if (!svgNode || clips.length === 0) {
    return svg;
  }

  resetAnimatedTransforms(svgNode);
  for (const entry of clips) {
    const target = entry.targetPathId
      ? doc.querySelector(`[data-foreground-path-id="${entry.targetPathId}"]`)
      : doc.querySelector('[data-foreground-root="true"]');

    if (!(target instanceof SVGElement)) {
      continue;
    }

    const progress = resolveClipTimelineProgress(entry.clip, elapsedMs);
    const transform = resolveStepTransformAtProgress(entry.steps, entry.ease, progress);
    applyTransformStyles(target, transform);
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgNode);
}

async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode SVG content."));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function drawSvgFrameToCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  svg: string,
  backgroundColor: string | null,
): Promise<Uint8ClampedArray> {
  const image = await loadSvgImage(svg);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (backgroundColor) {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function createRenderCanvas(size: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not initialize canvas context.");
  }

  return { canvas, context };
}

function resolveSupportedVideoMime(format: "webm" | "mp4"): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = VIDEO_MIME_CANDIDATES[format];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return null;
}

function waitForAnimationFrame(): Promise<number> {
  return new Promise((resolve) => {
    window.requestAnimationFrame((timestamp) => resolve(timestamp));
  });
}

async function waitUntilTimestamp(targetTimestamp: number): Promise<void> {
  while (true) {
    const timestamp = await waitForAnimationFrame();
    if (timestamp >= targetTimestamp) {
      return;
    }
  }
}

async function renderVideoBlobFromSequence(
  options: ExportRequest,
  sequence: RenderSequence,
  format: "webm" | "mp4",
): Promise<Blob> {
  const mediaType = resolveSupportedVideoMime(format);
  if (!mediaType) {
    throw new Error(`${format.toUpperCase()} export is unavailable in this browser.`);
  }

  const size = normalizeExportSize(options.size);
  const { canvas, context } = createRenderCanvas(size);
  if (typeof canvas.captureStream !== "function") {
    throw new Error("Video export is unavailable in this browser.");
  }

  const stream = canvas.captureStream(sequence.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mediaType,
    videoBitsPerSecond: Math.max(1_500_000, Math.round(size * size * sequence.fps * 0.5)),
  });
  const chunks: BlobPart[] = [];
  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener("error", () => {
      reject(new Error(`Could not record ${format.toUpperCase()} output.`));
    });
    recorder.addEventListener("stop", () => {
      resolve(new Blob(chunks, { type: mediaType }));
    });
  });

  recorder.start(100);

  try {
    const startTimestamp = await waitForAnimationFrame();
    for (let frameIndex = 0; frameIndex < sequence.frameCount; frameIndex += 1) {
      assertNotAborted(options.signal);
      reportExportProgress(
        options,
        10 + (frameIndex / sequence.frameCount) * 75,
        `Rendering ${format.toUpperCase()} frames…`,
      );
      const targetTimestamp =
        startTimestamp + resolveFrameElapsedMs(frameIndex, sequence.fps);
      await waitUntilTimestamp(targetTimestamp);
      const frameSvg =
        sequence.clips.length > 0
          ? buildAnimatedFrameSvg(
              options.svg,
              sequence.clips,
              resolveFrameElapsedMs(frameIndex, sequence.fps),
            )
          : options.svg;
      await drawSvgFrameToCanvas(canvas, context, frameSvg, null);
    }

    await waitUntilTimestamp(startTimestamp + sequence.durationMs);
  } finally {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  const blob = await stopPromise;
  if (blob.size === 0) {
    throw new Error(`Could not export ${format.toUpperCase()}.`);
  }
  reportExportProgress(options, 100, "Export complete");

  return blob;
}

async function loadVideoElement(
  blob: Blob,
): Promise<{ video: HTMLVideoElement; dispose: () => void }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not decode recorded video."));
    video.src = url;
  });

  return {
    video,
    dispose: () => URL.revokeObjectURL(url),
  };
}

async function seekVideo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not read video frame."));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = timeSeconds;
  });
}

async function decodeVideoFramesToRgba(
  blob: Blob,
  size: number,
  sequence: RenderSequence,
  signal: AbortSignal | undefined,
): Promise<Uint8ClampedArray[]> {
  const { video, dispose } = await loadVideoElement(blob);
  const { canvas, context } = createRenderCanvas(size);
  try {
    const frames: Uint8ClampedArray[] = [];
    const maxSeekTime = Math.max(
      0,
      (video.duration || sequence.durationMs / 1000) - 0.0001,
    );

    for (let frameIndex = 0; frameIndex < sequence.frameCount; frameIndex += 1) {
      assertNotAborted(signal);
      const frameTimeSeconds = Math.min(
        resolveFrameElapsedMs(frameIndex, sequence.fps) / 1000,
        maxSeekTime,
      );
      await seekVideo(video, frameTimeSeconds);
      context.clearRect(0, 0, size, size);
      context.drawImage(video, 0, 0, size, size);
      frames.push(context.getImageData(0, 0, size, size).data);
    }

    return frames;
  } finally {
    dispose();
  }
}

function hasTransparentPixels(rgba: Uint8ClampedArray): boolean {
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] < 255) {
      return true;
    }
  }

  return false;
}

function ensureSvgExportDimensions(svg: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, "image/svg+xml");
    const svgNode = doc.querySelector("svg");
    if (!svgNode) {
      return svg;
    }

    const viewBox = svgNode.getAttribute("viewBox");
    if (!viewBox) {
      return svg;
    }

    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value));
    if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
      return svg;
    }

    const width = Math.abs(parts[2]);
    const height = Math.abs(parts[3]);
    if (width <= 0 || height <= 0) {
      return svg;
    }

    if (!svgNode.hasAttribute("width")) {
      svgNode.setAttribute("width", width.toString());
    }
    if (!svgNode.hasAttribute("height")) {
      svgNode.setAttribute("height", height.toString());
    }

    return new XMLSerializer().serializeToString(svgNode);
  } catch {
    return svg;
  }
}

export function ensureTransparentPaletteEntry(
  paletteInput: number[][],
): { palette: number[][]; transparentIndex: number } {
  const existingIndex = paletteInput.findIndex((color) => color[3] === 0);
  if (existingIndex >= 0) {
    return {
      palette: paletteInput,
      transparentIndex: existingIndex,
    };
  }

  const palette = paletteInput.slice(0, 256).map((color) => color.slice(0, 4));
  const transparentColor = [0, 0, 0, 0];

  if (palette.length >= 256) {
    palette[255] = transparentColor;
    return {
      palette,
      transparentIndex: 255,
    };
  }

  palette.push(transparentColor);
  return {
    palette,
    transparentIndex: palette.length - 1,
  };
}

export function normalizeGifAlphaInPlace(
  rgba: Uint8ClampedArray,
  threshold = GIF_ALPHA_THRESHOLD,
): boolean {
  let hasTransparency = false;
  const clampedThreshold = Math.max(0, Math.min(254, Math.round(threshold)));

  for (let index = 0; index < rgba.length; index += 4) {
    const alphaIndex = index + 3;
    const alpha = rgba[alphaIndex];
    if (alpha <= clampedThreshold) {
      rgba[index] = 0;
      rgba[index + 1] = 0;
      rgba[index + 2] = 0;
      rgba[alphaIndex] = 0;
      hasTransparency = true;
      continue;
    }

    rgba[alphaIndex] = 255;
  }

  return hasTransparency;
}

function buildGifPaletteQuantizeInput(
  frames: Uint8ClampedArray[],
  maxPixels: number,
): Uint8ClampedArray {
  if (frames.length === 0) {
    return new Uint8ClampedArray();
  }

  if (frames.length === 1) {
    return frames[0];
  }

  const totalPixels = frames.reduce((sum, frame) => sum + frame.length / 4, 0);
  const pixelStep = Math.max(1, Math.ceil(totalPixels / maxPixels));
  const sampledPixelCount = Math.ceil(totalPixels / pixelStep);
  const sampled = new Uint8ClampedArray(sampledPixelCount * 4);

  let sampledOffset = 0;
  const rgbaStep = pixelStep * 4;
  for (const frame of frames) {
    for (let offset = 0; offset < frame.length; offset += rgbaStep) {
      sampled[sampledOffset] = frame[offset];
      sampled[sampledOffset + 1] = frame[offset + 1];
      sampled[sampledOffset + 2] = frame[offset + 2];
      sampled[sampledOffset + 3] = frame[offset + 3];
      sampledOffset += 4;
    }
  }

  return sampled.subarray(0, sampledOffset);
}

export function stripTransientBlinkArtifacts(svg: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, "image/svg+xml");
    const svgNode = doc.querySelector("svg");
    if (!svgNode) {
      return svg;
    }

    const blinkGroups = Array.from(svgNode.querySelectorAll("[data-blink-token]"));
    if (blinkGroups.length === 0) {
      return svg;
    }

    for (const group of blinkGroups) {
      group.removeAttribute("data-blink-token");
      const animatedNodes = Array.from(group.querySelectorAll("animate"));
      for (const animatedNode of animatedNodes) {
        animatedNode.remove();
      }
    }

    return new XMLSerializer().serializeToString(svgNode);
  } catch {
    return svg;
  }
}

async function renderRasterBlob(options: ExportRequest): Promise<Blob> {
  reportExportProgress(options, 10, "Rendering image…");
  const format = options.format;
  if (!(format in MIME_BY_FORMAT)) {
    throw new Error(`Unsupported raster format: ${format}`);
  }

  const mimeType = MIME_BY_FORMAT[format as keyof typeof MIME_BY_FORMAT];
  const size = normalizeExportSize(options.size);
  const quality = format === "jpeg" ? 1 : normalizeExportQuality(options.quality);
  const { canvas, context } = createRenderCanvas(size);
  await drawSvgFrameToCanvas(canvas, context, options.svg, null);
  assertNotAborted(options.signal);
  reportExportProgress(options, 80, "Encoding image…");

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
  if (!blob) {
    throw new Error(`Could not export ${format.toUpperCase()}.`);
  }
  reportExportProgress(options, 100, "Export complete");
  return blob;
}

async function resolveGifenc(): Promise<GifencApi> {
  if (!STATIC_GIFENC_API) {
    throw new Error("GIF export is unavailable in this build.");
  }

  return STATIC_GIFENC_API;
}

async function resolveAnimatedWebpApi(): Promise<AnimatedWebpApi> {
  if (!animatedWebpApiPromise) {
    animatedWebpApiPromise = import("libwebp-wasm")
      .then((moduleValue) => {
        const encodeRGBA = moduleValue.encodeRGBA;
        const Encoder = moduleValue.Encoder;
        if (typeof encodeRGBA !== "function" || typeof Encoder !== "function") {
          throw new Error("Animated WebP export is unavailable in this build.");
        }

        return { encodeRGBA, Encoder };
      })
      .catch((error) => {
        animatedWebpApiPromise = null;
        if (error instanceof Error) {
          throw error;
        }
        throw new Error("Animated WebP export is unavailable in this build.");
      });
  }

  return animatedWebpApiPromise;
}

async function encodeAnimatedWebpFromRgbaFrames(
  frameSources: Uint8ClampedArray[],
  size: number,
  frameDelayMs: number,
  quality: number,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  if (frameSources.length === 0) {
    throw new Error("Could not encode WebP frames.");
  }

  const webpApi = await resolveAnimatedWebpApi();
  const encoder = new webpApi.Encoder(size, size);
  await encoder.init();
  const qualityPercent = resolveWebpQualityPercent(quality);

  for (const frame of frameSources) {
    assertNotAborted(signal);
    const frameBytes = await webpApi.encodeRGBA(frame, size, size, qualityPercent);
    assertNotAborted(signal);
    await encoder.addFrame(frameBytes, frameDelayMs);
  }

  const bytes = await encoder.save();
  const byteCopy = new Uint8Array(bytes);
  if (byteCopy.byteLength === 0) {
    throw new Error("Could not export WEBP.");
  }

  return new Blob([byteCopy], { type: "image/webp" });
}

function encodeGifFromRgbaFrames(
  gifencApi: GifencApi,
  frameSources: Uint8ClampedArray[],
  size: number,
  frameDelayMs: number,
  shouldLoop: boolean,
): Blob {
  const { GIFEncoder, applyPalette, quantize } = gifencApi;
  const gif = GIFEncoder() as {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        palette?: number[][];
        delay: number;
        repeat?: number;
        transparent: boolean;
        transparentIndex: number;
        dispose?: number;
      },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  const frames = frameSources.map((frame) => new Uint8ClampedArray(frame));
  if (frames.length === 0) {
    throw new Error("Could not encode GIF frames.");
  }

  let usesTransparency = false;
  for (const frame of frames) {
    usesTransparency =
      normalizeGifAlphaInPlace(frame, GIF_ALPHA_THRESHOLD) || usesTransparency;
  }

  const paletteFormat = usesTransparency ? "rgba4444" : "rgb565";
  const quantizeInput = buildGifPaletteQuantizeInput(
    frames,
    GIF_MAX_PALETTE_SAMPLE_PIXELS,
  );

  let palette = quantize(quantizeInput, 256, {
    format: paletteFormat,
    clearAlpha: false,
  }) as number[][];
  let transparentIndex = -1;
  if (usesTransparency) {
    const ensured = ensureTransparentPaletteEntry(palette);
    palette = ensured.palette;
    transparentIndex = ensured.transparentIndex;
  }

  const frameCount = frames.length;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const indexedPixels = applyPalette(frames[frameIndex], palette, paletteFormat);

    gif.writeFrame(indexedPixels, size, size, {
      palette: frameIndex === 0 ? palette : undefined,
      delay: frameDelayMs,
      repeat: frameIndex === 0 ? (shouldLoop ? 0 : -1) : undefined,
      transparent: usesTransparency,
      transparentIndex: usesTransparency ? transparentIndex : 0,
      dispose: 1,
    });
  }

  gif.finish();
  const bytes = gif.bytes();
  const byteCopy = new Uint8Array(bytes);
  return new Blob([byteCopy], { type: "image/gif" });
}

async function renderGifFromSvgFrames(
  options: ExportRequest,
  sequence: RenderSequence,
  gifencApi: GifencApi,
): Promise<Blob> {
  const size = normalizeExportSize(options.size);
  const frameDelayMs = Math.max(20, Math.round(1000 / sequence.fps));
  const { canvas, context } = createRenderCanvas(size);
  const frames: Uint8ClampedArray[] = [];

  for (let frameIndex = 0; frameIndex < sequence.frameCount; frameIndex += 1) {
    assertNotAborted(options.signal);
    reportExportProgress(
      options,
      10 + (frameIndex / sequence.frameCount) * 70,
      "Rendering GIF frames…",
    );
    const frameSvg =
      sequence.clips.length > 0
        ? buildAnimatedFrameSvg(
            options.svg,
            sequence.clips,
            resolveFrameElapsedMs(frameIndex, sequence.fps),
          )
        : options.svg;
    frames.push(await drawSvgFrameToCanvas(canvas, context, frameSvg, null));
  }

  const shouldLoop = sequence.clips.some((entry) => entry.clip.loop);
  reportExportProgress(options, 85, "Encoding GIF…");
  const blob = encodeGifFromRgbaFrames(
    gifencApi,
    frames,
    size,
    frameDelayMs,
    shouldLoop,
  );
  reportExportProgress(options, 100, "Export complete");
  return blob;
}

async function renderGifFromVideoIntermediate(
  options: ExportRequest,
  sequence: RenderSequence,
  gifencApi: GifencApi,
): Promise<Blob> {
  if (sequence.frameCount <= 1) {
    throw new Error("Video intermediate is not needed for static GIF export.");
  }

  const videoBlob = await renderVideoBlobFromSequence(options, sequence, "webm");
  reportExportProgress(options, 70, "Decoding video frames…");
  const size = normalizeExportSize(options.size);
  const frameDelayMs = Math.max(20, Math.round(1000 / sequence.fps));
  const frames = await decodeVideoFramesToRgba(
    videoBlob,
    size,
    sequence,
    options.signal,
  );
  const shouldLoop = sequence.clips.some((entry) => entry.clip.loop);
  reportExportProgress(options, 85, "Encoding GIF…");
  const blob = encodeGifFromRgbaFrames(
    gifencApi,
    frames,
    size,
    frameDelayMs,
    shouldLoop,
  );
  reportExportProgress(options, 100, "Export complete");
  return blob;
}

async function renderGifBlob(options: ExportRequest): Promise<Blob> {
  const gifencApi = await resolveGifenc();
  const sequence = resolveRenderSequence(options);
  const size = normalizeExportSize(options.size);
  const { canvas, context } = createRenderCanvas(size);
  const firstFrameSvg =
    sequence.clips.length > 0
      ? buildAnimatedFrameSvg(options.svg, sequence.clips, 0)
      : options.svg;
  const firstFrameRgba = await drawSvgFrameToCanvas(
    canvas,
    context,
    firstFrameSvg,
    null,
  );
  reportExportProgress(options, 8, "Checking transparency…");
  const hasTransparency = hasTransparentPixels(firstFrameRgba);

  if (!hasTransparency) {
    try {
      return await renderGifFromVideoIntermediate(options, sequence, gifencApi);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "Export canceled.") {
        throw error;
      }
    }
  }

  return renderGifFromSvgFrames(options, sequence, gifencApi);
}

async function renderWebpBlob(options: ExportRequest): Promise<Blob> {
  const sequence = resolveRenderSequence(options);
  if (sequence.clips.length === 0 || sequence.frameCount <= 1) {
    return renderRasterBlob({
      ...options,
      format: "webp",
    });
  }

  const size = normalizeExportSize(options.size);
  const frameDelayMs = Math.max(20, Math.round(1000 / sequence.fps));
  const { canvas, context } = createRenderCanvas(size);
  const frames: Uint8ClampedArray[] = [];

  for (let frameIndex = 0; frameIndex < sequence.frameCount; frameIndex += 1) {
    assertNotAborted(options.signal);
    reportExportProgress(
      options,
      10 + (frameIndex / sequence.frameCount) * 70,
      "Rendering WebP frames…",
    );
    const frameSvg = buildAnimatedFrameSvg(
      options.svg,
      sequence.clips,
      resolveFrameElapsedMs(frameIndex, sequence.fps),
    );
    frames.push(await drawSvgFrameToCanvas(canvas, context, frameSvg, null));
  }

  reportExportProgress(options, 85, "Encoding WebP…");
  const blob = await encodeAnimatedWebpFromRgbaFrames(
    frames,
    size,
    frameDelayMs,
    options.quality,
    options.signal,
  );
  reportExportProgress(options, 100, "Export complete");
  return blob;
}

async function renderVideoBlob(options: ExportRequest): Promise<Blob> {
  if (!VIDEO_FORMATS.has(options.format)) {
    throw new Error(`Unsupported video format: ${options.format}`);
  }

  const sequence = resolveRenderSequence(options);
  const format = options.format as "webm" | "mp4";
  reportExportProgress(options, 5, `Rendering ${format.toUpperCase()}…`);
  return renderVideoBlobFromSequence(options, sequence, format);
}

export function isAnimatedExportFormat(format: ExportFormat): boolean {
  return ANIMATED_FORMATS.has(format);
}

export function supportsSizePreview(format: ExportFormat): boolean {
  return (
    format === "svg" ||
    format === "png" ||
    format === "jpeg" ||
    format === "gif" ||
    format === "webm" ||
    format === "mp4"
  );
}

export function formatPreservesAnimations(format: ExportFormat): boolean {
  return format === "gif" || format === "webp" || format === "webm" || format === "mp4";
}

export function inspectExportAnimation(
  animationClip: AnimationClipState,
  pathAnimationClips: Record<string, AnimationClipState>,
): ExportAnimationSummary {
  const clips = collectActiveAnimationClips(animationClip, pathAnimationClips);
  return {
    hasAnimations: clips.length > 0,
    hasLoopingAnimations: clips.some((entry) => entry.clip.loop),
    clipCount: clips.length,
  };
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "Unknown size";
  }

  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function sanitizeFileName(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const fallback = "aikon-export";
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  return normalized || fallback;
}

export function buildExportFileName(baseName: string, format: ExportFormat): string {
  return `${sanitizeFileName(baseName)}.${format}`;
}

export async function createExportBlob(options: ExportRequest): Promise<Blob> {
  assertNotAborted(options.signal);
  reportExportProgress(options, 0, "Preparing export…");
  const sanitizedSvg = stripTransientBlinkArtifacts(options.svg);
  const sanitizedOptions: ExportRequest = {
    ...options,
    svg: sanitizedSvg,
  };

  if (options.format === "svg") {
    const exportSvg = ensureSvgExportDimensions(sanitizedSvg);
    reportExportProgress(options, 100, "Export complete");
    return new Blob([exportSvg], {
      type: "image/svg+xml;charset=utf-8",
    });
  }
  if (options.format === "gif") {
    return renderGifBlob(sanitizedOptions);
  }
  if (options.format === "webp") {
    return renderWebpBlob(sanitizedOptions);
  }
  if (options.format === "webm" || options.format === "mp4") {
    return renderVideoBlob(sanitizedOptions);
  }

  return renderRasterBlob(sanitizedOptions);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
