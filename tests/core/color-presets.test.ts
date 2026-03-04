import assert from "node:assert/strict";
import test from "node:test";
import "../dom-shim";
import {
  applyPresetColorsToPathStyles,
  applyPresetColorsToSurface,
  clearColorPresets,
  createColorPresetSnapshot,
  defaultBackground,
  defaultForeground,
  loadColorPresets,
  markColorPresetUsed,
  saveColorPreset,
} from "../../src/core/editor";

test("saveColorPreset ignores empty names", () => {
  clearColorPresets();
  const saved = saveColorPreset(
    "   ",
    createColorPresetSnapshot(defaultBackground, defaultForeground),
  );

  assert.equal(saved, null);
});

test("color presets are sorted by usage count desc", () => {
  clearColorPresets();

  const warm = saveColorPreset(
    "Warm",
    createColorPresetSnapshot(defaultBackground, defaultForeground),
  );
  const cold = saveColorPreset(
    "Cold",
    createColorPresetSnapshot(
      {
        ...defaultBackground,
        flatColor: "#224466",
        gradientFrom: "#2d4c6e",
        gradientTo: "#46698f",
      },
      {
        ...defaultForeground,
        flatColor: "#89abc1",
        gradientFrom: "#5a7f9f",
        gradientTo: "#b7cedd",
      },
    ),
  );

  assert.notEqual(warm, null);
  assert.notEqual(cold, null);

  markColorPresetUsed(cold.id);
  markColorPresetUsed(cold.id);
  markColorPresetUsed(warm.id);

  const presets = loadColorPresets();
  assert.equal(presets.length, 2);
  assert.equal(presets[0]?.id, cold.id);
  assert.equal(presets[0]?.usageCount, 2);
  assert.equal(presets[1]?.id, warm.id);
  assert.equal(presets[1]?.usageCount, 1);
});

test("save/load preset preserves fill, stroke, and shadow settings", () => {
  clearColorPresets();

  const saved = saveColorPreset(
    "Preset with style settings",
    createColorPresetSnapshot(
      {
        ...defaultBackground,
        type: "gradient",
        gradientType: "diagonal-forward",
        strokeStyle: "dashed",
        frameWidth: 7,
        frameColor: "#123456",
        shadowEnabled: true,
        shadowMode: "inner",
        shadowColor: "#654321",
        shadowBlur: 12,
        shadowOffsetX: 4,
        shadowOffsetY: -6,
      },
      {
        ...defaultForeground,
        type: "gradient",
        gradientType: "horizontal",
        strokeStyle: "dotted",
        frameWidth: 5,
        frameColor: "#abcdef",
        shadowEnabled: true,
        shadowMode: "outer",
        shadowColor: "#fedcba",
        shadowBlur: 9,
        shadowOffsetX: -2,
        shadowOffsetY: 3,
      },
    ),
  );

  assert.notEqual(saved, null);

  const presets = loadColorPresets();
  assert.equal(presets.length, 1);
  assert.equal(presets[0]?.background.shadowMode, "inner");
  assert.equal(presets[0]?.background.shadowEnabled, true);
  assert.equal(presets[0]?.background.strokeStyle, "dashed");
  assert.equal(presets[0]?.background.frameWidth, 7);
  assert.equal(presets[0]?.foreground.gradientType, "horizontal");
  assert.equal(presets[0]?.foreground.shadowMode, "outer");
});

test("applyPresetColorsToSurface applies fill, stroke, and shadow settings", () => {
  const input = {
    ...defaultBackground,
    type: "gradient" as const,
    gradientType: "vertical" as const,
    strokeStyle: "double" as const,
    frameWidth: 12,
    frameRotate: 30,
    frameScale: 88,
    shadowEnabled: false,
    shadowMode: "outer" as const,
    shadowBlur: 16,
    shadowOffsetX: -3,
    shadowOffsetY: 7,
  };

  const result = applyPresetColorsToSurface(input, {
    type: "flat",
    flatColor: "#010203",
    gradientFrom: "#111213",
    gradientTo: "#212223",
    gradientType: "radial",
    strokeStyle: "dashed",
    frameWidth: 5,
    frameColor: "#313233",
    shadowEnabled: true,
    shadowMode: "inner",
    shadowColor: "#414243",
    shadowBlur: 8,
    shadowOffsetX: 2,
    shadowOffsetY: 4,
  });

  assert.equal(result.type, "flat");
  assert.equal(result.flatColor, "#010203");
  assert.equal(result.gradientFrom, "#111213");
  assert.equal(result.gradientTo, "#212223");
  assert.equal(result.gradientType, "radial");
  assert.equal(result.strokeStyle, "dashed");
  assert.equal(result.frameWidth, 5);
  assert.equal(result.frameColor, "#313233");
  assert.equal(result.shadowEnabled, true);
  assert.equal(result.shadowMode, "inner");
  assert.equal(result.shadowColor, "#414243");
  assert.equal(result.shadowBlur, 8);
  assert.equal(result.shadowOffsetX, 2);
  assert.equal(result.shadowOffsetY, 4);
  assert.equal(result.frameRotate, 30);
  assert.equal(result.frameScale, 88);
});

test("applyPresetColorsToPathStyles updates every path style", () => {
  const pathStyles = {
    a: {
      ...defaultForeground,
      flatColor: "#010101",
      frameColor: "#020202",
    },
    b: {
      ...defaultForeground,
      flatColor: "#030303",
      frameColor: "#040404",
    },
  };

  const result = applyPresetColorsToPathStyles(pathStyles, {
    type: "gradient",
    flatColor: "#111111",
    gradientFrom: "#222222",
    gradientTo: "#333333",
    gradientType: "diagonal-backward",
    strokeStyle: "solid",
    frameWidth: 6,
    frameColor: "#444444",
    shadowEnabled: true,
    shadowMode: "inner",
    shadowColor: "#555555",
    shadowBlur: 11,
    shadowOffsetX: -5,
    shadowOffsetY: 9,
  });

  assert.equal(result.a.type, "gradient");
  assert.equal(result.b.type, "gradient");
  assert.equal(result.a.flatColor, "#111111");
  assert.equal(result.b.flatColor, "#111111");
  assert.equal(result.a.gradientType, "diagonal-backward");
  assert.equal(result.b.gradientType, "diagonal-backward");
  assert.equal(result.a.strokeStyle, "solid");
  assert.equal(result.b.strokeStyle, "solid");
  assert.equal(result.a.frameWidth, 6);
  assert.equal(result.b.frameWidth, 6);
  assert.equal(result.a.frameColor, "#444444");
  assert.equal(result.b.frameColor, "#444444");
  assert.equal(result.a.shadowEnabled, true);
  assert.equal(result.b.shadowEnabled, true);
  assert.equal(result.a.shadowMode, "inner");
  assert.equal(result.b.shadowMode, "inner");
  assert.equal(result.a.shadowBlur, 11);
  assert.equal(result.b.shadowOffsetY, 9);
  assert.equal(result.a.positionX, defaultForeground.positionX);
  assert.equal(result.b.positionY, defaultForeground.positionY);
});
