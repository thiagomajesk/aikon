import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveToolbarExpandedLayout,
  resolveToolbarGridTemplateRows,
} from "../../src/ui/preview-toolbar-state";

test("toolbar remains expanded when switching tabs", () => {
  assert.equal(resolveToolbarExpandedLayout("history", true), true);
  assert.equal(resolveToolbarExpandedLayout("presets", true), true);
});

test("toolbar remains collapsed when expansion toggle is off", () => {
  assert.equal(resolveToolbarExpandedLayout("history", false), false);
  assert.equal(resolveToolbarExpandedLayout("presets", false), false);
});

test("toolbar grid rows use content-height footer when collapsed", () => {
  assert.equal(resolveToolbarGridTemplateRows(true), "minmax(0, 0fr) minmax(0, 1fr)");
  assert.equal(resolveToolbarGridTemplateRows(false), "minmax(0, 1fr) auto");
});
