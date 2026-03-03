import assert from "node:assert/strict";
import test from "node:test";
import "../dom-shim";
import {
  defaultAnimationClip,
  normalizeAnimationClipState,
} from "../../src/core/editor";
import {
  buildExportFileName,
  ensureTransparentPaletteEntry,
  formatPreservesAnimations,
  formatBytes,
  inspectExportAnimation,
  isAnimatedExportFormat,
  resolveGifencApi,
  stripTransientBlinkArtifacts,
  sanitizeFileName,
  supportsSizePreview,
  normalizeGifAlphaInPlace,
  createExportBlob,
} from "../../src/core/export/exporter";
import { buildExportFileName as buildExportFileNameFromIndex } from "../../src/core/export";

test("inspectExportAnimation reports no animations when all presets are none", () => {
  const summary = inspectExportAnimation(
    normalizeAnimationClipState({ preset: "none" }),
    {
      "path-a": normalizeAnimationClipState({ preset: "none", targetPathId: "path-a" }),
    },
  );

  assert.equal(summary.hasAnimations, false);
  assert.equal(summary.hasLoopingAnimations, false);
  assert.equal(summary.clipCount, 0);
});

test("inspectExportAnimation reports active global and per-path clips", () => {
  const summary = inspectExportAnimation(
    {
      ...defaultAnimationClip,
      preset: "shakeX" as typeof defaultAnimationClip.preset,
      loop: true,
    },
    {
      "path-a": normalizeAnimationClipState({
        preset: "fadeIn",
        targetPathId: "path-a",
        loop: false,
      }),
      "path-b": normalizeAnimationClipState({
        preset: "none",
        targetPathId: "path-b",
      }),
    },
  );

  assert.equal(summary.hasAnimations, true);
  assert.equal(summary.hasLoopingAnimations, true);
  assert.equal(summary.clipCount, 2);
});

test("isAnimatedExportFormat flags GIF/WebP and video formats", () => {
  assert.equal(isAnimatedExportFormat("gif"), true);
  assert.equal(isAnimatedExportFormat("webp"), true);
  assert.equal(isAnimatedExportFormat("webm"), true);
  assert.equal(isAnimatedExportFormat("mp4"), true);
  assert.equal(isAnimatedExportFormat("png"), false);
});

test("formatPreservesAnimations for gif/webp and video formats", () => {
  assert.equal(formatPreservesAnimations("gif"), true);
  assert.equal(formatPreservesAnimations("webp"), true);
  assert.equal(formatPreservesAnimations("webm"), true);
  assert.equal(formatPreservesAnimations("mp4"), true);
  assert.equal(formatPreservesAnimations("svg"), false);
});

test("supportsSizePreview is available for all current formats", () => {
  assert.equal(supportsSizePreview("svg"), true);
  assert.equal(supportsSizePreview("gif"), true);
  assert.equal(supportsSizePreview("webp"), false);
  assert.equal(supportsSizePreview("webm"), true);
  assert.equal(supportsSizePreview("mp4"), true);
});

test("createExportBlob svg sets width/height from viewBox when missing", async () => {
  const blob = await createExportBlob({
    format: "svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><rect width="64" height="32" fill="#000"/></svg>`,
    size: 64,
    quality: 0.92,
    fps: 24,
    animationClip: defaultAnimationClip,
    pathAnimationClips: {},
  });
  const text = await blob.text();

  assert.equal(text.includes(`width="64"`), true);
  assert.equal(text.includes(`height="32"`), true);
});

test("sanitizeFileName and buildExportFileName create stable filenames", () => {
  assert.equal(sanitizeFileName("  Ice Bolt #42  "), "ice-bolt-42");
  assert.equal(sanitizeFileName(""), "aikon-export");
  assert.equal(buildExportFileName("My Icon", "png"), "my-icon.png");
  assert.equal(buildExportFileNameFromIndex("My Icon", "png"), "my-icon.png");
});

test("formatBytes renders compact byte labels", () => {
  assert.equal(formatBytes(980), "980 B");
  assert.equal(formatBytes(20_000), "19.5 KB");
  assert.equal(formatBytes(2_621_440), "2.50 MB");
});

test("resolveGifencApi supports module.exports wrapped namespace", () => {
  const api = resolveGifencApi({
    default: {
      "module.exports": {
        GIFEncoder: () => ({}),
        applyPalette: () => new Uint8Array(),
        quantize: () => [],
      },
    },
  });

  assert.ok(api);
  assert.equal(typeof api.GIFEncoder, "function");
  assert.equal(typeof api.applyPalette, "function");
  assert.equal(typeof api.quantize, "function");
});

test("stripTransientBlinkArtifacts removes temporary blink animation wrappers", () => {
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
    `<g data-foreground-path-id="path-1" data-blink-token="7">` +
    `<animate attributeName="opacity" values="1;0.15;1;0.15;1" dur="0.75s" repeatCount="1" />` +
    `<path d="M0 0L10 10" />` +
    `</g>` +
    `</svg>`;

  const cleaned = stripTransientBlinkArtifacts(source);

  assert.equal(cleaned.includes("data-blink-token"), false);
  assert.equal(cleaned.includes("<animate"), false);
  assert.equal(cleaned.includes("<path"), true);
});

test("ensureTransparentPaletteEntry appends transparent color when missing", () => {
  const palette = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
  ];
  const result = ensureTransparentPaletteEntry(palette);

  assert.equal(result.transparentIndex, 2);
  assert.equal(result.palette.length, 3);
  assert.deepEqual(result.palette[2], [0, 0, 0, 0]);
});

test("ensureTransparentPaletteEntry reuses existing transparent index", () => {
  const palette = [
    [255, 0, 0, 255],
    [0, 0, 0, 0],
    [0, 255, 0, 255],
  ];
  const result = ensureTransparentPaletteEntry(palette);

  assert.equal(result.transparentIndex, 1);
  assert.equal(result.palette, palette);
});

test("normalizeGifAlphaInPlace applies binary alpha threshold", () => {
  const rgba = new Uint8ClampedArray([
    10, 20, 30, 0,
    40, 50, 60, 127,
    70, 80, 90, 128,
  ]);

  const hasTransparency = normalizeGifAlphaInPlace(rgba, 127);

  assert.equal(hasTransparency, true);
  assert.deepEqual(Array.from(rgba), [
    0, 0, 0, 0,
    0, 0, 0, 0,
    70, 80, 90, 255,
  ]);
});

test("normalizeGifAlphaInPlace default threshold keeps near-opaque edges", () => {
  const rgba = new Uint8ClampedArray([
    10, 20, 30, 1,
    40, 50, 60, 2,
  ]);

  normalizeGifAlphaInPlace(rgba);

  assert.deepEqual(Array.from(rgba), [
    0, 0, 0, 0,
    40, 50, 60, 255,
  ]);
});
