import assert from "node:assert/strict";
import test from "node:test";
import "../dom-shim";
import { defaultAnimation, defaultBackground, defaultBaseLayer, defaultEffects, defaultForeground, defaultOverlayLayer } from "../../src/core/editor";
import {
  buildCompositeSvg,
  buildPreviewTransform,
  parseSvg,
  svgToDataUri,
  wrapWithParentTransforms,
} from "../../src/core/svg-compositor";

test("svgToDataUri percent-encodes SVG markup", () => {
  const svg = `<svg viewBox="0 0 1 1"><path d="M0 0L1 1" /></svg>`;
  const uri = svgToDataUri(svg);
  assert.equal(uri.startsWith("data:image/svg+xml;charset=utf-8,"), true);
  assert.equal(uri.includes("<svg"), false);
  assert.equal(uri.includes("%3Csvg"), true);
});

test("buildPreviewTransform interpolates animation values", () => {
  const transform = buildPreviewTransform(
    {
      ...defaultAnimation,
      startX: 0,
      endX: 100,
      startScale: 1,
      endScale: 2,
    },
    0.5,
  );

  assert.deepEqual(transform, {
    x: 50,
    y: 0,
    scale: 1.5,
    rotate: 0,
  });
});

test("buildCompositeSvg creates deterministic output for the same inputs", () => {
  const background = {
    ...defaultBackground,
    type: "flat" as const,
    flatColor: "#112233",
    shape: "circle" as const,
  };
  const foreground = {
    ...defaultForeground,
    clipToBackground: true,
  };

  const first = buildCompositeSvg(
    defaultBaseLayer,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    background,
    foreground,
    new Map(),
    null,
  );

  const second = buildCompositeSvg(
    defaultBaseLayer,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    background,
    foreground,
    new Map(),
    null,
  );

  assert.equal(first, second);
  assert.match(first, /clip-path="url\(#bg-clip\)"/);
  assert.match(first, /fill="#112233"/);
});

test("parseSvg strips defs and solid black full-canvas backgrounds", () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><defs><linearGradient id="x" /></defs><path fill="#000" d="M0 0 h10 v20 H0 z"/><rect fill="black" x="0" y="0" width="10" height="20"/><circle id="keep" cx="5" cy="5" r="3" fill="#ff0000"/></svg>`;
  const parsed = parseSvg(source, new Map());

  assert.equal(parsed.viewBox, "0 0 10 20");
  assert.match(parsed.defs, /<defs/);
  assert.match(parsed.inner, /id="keep"/);
  assert.equal(parsed.inner.includes('d="M0 0 h10 v20 H0 z"'), false);
  assert.equal(parsed.inner.includes("<rect"), false);
});

test("parseSvg keeps black elements when they are not full-canvas backgrounds", () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="oops"><rect fill="#000" x="0" y="0" width="10" height="20"/><path d="M0 0 h10 v20 H0 z" /></svg>`;
  const parsed = parseSvg(source, new Map());

  assert.equal(parsed.inner.includes("<rect"), true);
  assert.equal(parsed.inner.includes("<path"), true);
});

test("parseSvg caches and returns the same parsed object instance", () => {
  const cache = new Map();
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z" /></svg>`;
  const first = parseSvg(source, cache);
  const second = parseSvg(source, cache);

  assert.equal(first, second);
});

test("parseSvg returns default payload when no svg node exists", () => {
  const parsed = parseSvg(`<not-svg />`, new Map());
  assert.deepEqual(parsed, { viewBox: "0 0 512 512", inner: "", defs: "" });
});

test("wrapWithParentTransforms preserves transform, opacity, and style wrappers", () => {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const doc = parser.parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(2 4)" opacity="0.4"><g style="mix-blend-mode:screen"><path id="p" d="M0 0L1 1" /></g></g></svg>`,
    "image/svg+xml",
  );

  const node = doc.querySelector("#p");
  assert.ok(node);
  const wrapped = wrapWithParentTransforms(node, serializer);

  assert.match(wrapped, /<g style="mix-blend-mode:screen">/);
  assert.match(wrapped, /<g transform="translate\(2 4\)" opacity="0.4">/);
  assert.match(wrapped, /<path id="p" d="M0 0L1 1"/);
});

test("wrapWithParentTransforms returns node markup when no wrapper attrs exist", () => {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const doc = parser.parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg"><path id="solo" d="M0 0L1 1" /></svg>`,
    "image/svg+xml",
  );
  const node = doc.querySelector("#solo");
  assert.ok(node);
  const wrapped = wrapWithParentTransforms(node, serializer);
  assert.equal(wrapped.includes("<g "), false);
  assert.match(wrapped, /<path id="solo" d="M0 0L1 1"/);
});

test("buildCompositeSvg preserves layer defs referenced by inner fills", () => {
  const baseWithDefs = {
    ...defaultBaseLayer,
    path: "custom/defs.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="layer-grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#ff0000" /><stop offset="100%" stop-color="#00ff00" /></linearGradient></defs><path fill="url(#layer-grad)" d="M80 80L432 80L256 432Z"/></svg>`,
  };

  const composite = buildCompositeSvg(
    baseWithDefs,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    defaultBackground,
    null,
    new Map(),
    null,
  );

  assert.match(composite, /<linearGradient id="layer-grad"/);
  assert.match(composite, /fill="url\(#layer-grad\)"/);
});

test("buildCompositeSvg applies foreground paint and deterministic per-layer gradients", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#000" d="M10 10L20 20Z"/><path fill="#ffffff" d="M30 30L40 40Z"/><path fill="#00ff00" d="M50 50L60 60Z"/></svg>`;
  const base = {
    ...defaultBaseLayer,
    path: "base.svg",
    svg,
  };
  const overlay = {
    ...defaultOverlayLayer,
    path: "overlay.svg",
    svg,
  };

  const result = buildCompositeSvg(
    base,
    overlay,
    defaultEffects,
    defaultAnimation,
    defaultBackground,
    {
      ...defaultForeground,
      type: "gradient",
      gradientType: "diagonal-forward",
      gradientFrom: "#111111",
      gradientTo: "#eeeeee",
    },
    new Map(),
    null,
  );

  assert.match(result, /id="fg-gradient-1"/);
  assert.match(result, /id="fg-gradient-2"/);
  assert.match(result, /fill="url\(#fg-gradient-1\)"/);
  assert.match(result, /fill="url\(#fg-gradient-2\)"/);
  assert.match(result, /fill="#00ff00"/);
});

test("buildCompositeSvg applies animation wrapper transform and foreground transform knobs", () => {
  const base = {
    ...defaultBaseLayer,
    path: "animated.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#000" d="M10 10L20 20Z"/></svg>`,
    x: 10,
    y: -5,
    rotate: 15,
    scale: 1.2,
  };

  const animated = buildCompositeSvg(
    base,
    defaultOverlayLayer,
    defaultEffects,
    {
      ...defaultAnimation,
      startX: 0,
      endX: 80,
      startY: 0,
      endY: -40,
      startScale: 1,
      endScale: 1.5,
      startRotate: 0,
      endRotate: 60,
    },
    defaultBackground,
    {
      ...defaultForeground,
      type: "flat",
      flatColor: "#123456",
      positionX: 10,
      positionY: -10,
      frameRotate: 45,
      frameScale: 150,
      flipX: true,
      skewX: 5,
      skewY: -3,
    },
    new Map(),
    0.5,
  );

  assert.match(
    animated,
    /transform="translate\(256 256\) translate\(40 -20\) rotate\(30\) scale\(1.25\) translate\(-256 -256\)"/,
  );
  assert.match(
    animated,
    /translate\(256 256\) translate\(10 -5\) rotate\(15\) scale\(1.2\) translate\(25.6 -25.6\) rotate\(45\) scale\(-1.5 1.5\) skewX\(5\) skewY\(-3\) translate\(-256 -256\)/,
  );
  assert.match(animated, /fill="#123456"/);
});

test("buildCompositeSvg supports none foreground paint and no clipping", () => {
  const base = {
    ...defaultBaseLayer,
    path: "none.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="black" d="M10 10L20 20Z"/></svg>`,
  };
  const composite = buildCompositeSvg(
    base,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    defaultBackground,
    {
      ...defaultForeground,
      type: "none",
      clipToBackground: false,
    },
    new Map(),
    null,
  );

  assert.match(composite, /fill="none"/);
  assert.equal(composite.includes('clip-path="url(#bg-clip)"'), false);
});

test("buildCompositeSvg supports all background gradient types", () => {
  const cases = [
    { gradientType: "radial" as const, marker: "<radialGradient id=\"bg-gradient\"" },
    { gradientType: "horizontal" as const, marker: 'x1="0%" y1="50%" x2="100%" y2="50%"' },
    { gradientType: "vertical" as const, marker: 'x1="50%" y1="0%" x2="50%" y2="100%"' },
    { gradientType: "diagonal-forward" as const, marker: 'x1="0%" y1="0%" x2="100%" y2="100%"' },
    { gradientType: "diagonal-backward" as const, marker: 'x1="100%" y1="0%" x2="0%" y2="100%"' },
  ];

  for (const item of cases) {
    const composite = buildCompositeSvg(
      defaultBaseLayer,
      defaultOverlayLayer,
      defaultEffects,
      defaultAnimation,
      {
        ...defaultBackground,
        type: "gradient",
        gradientType: item.gradientType,
      },
      null,
      new Map(),
      null,
    );

    assert.equal(composite.includes(item.marker), true);
  }
});

test("buildCompositeSvg handles background frame stroke styles", () => {
  const scenarios = [
    { strokeStyle: "dashed" as const, expected: 'stroke-dasharray="12,6"' },
    { strokeStyle: "dotted" as const, expected: 'stroke-dasharray="3,3" stroke-linecap="round"' },
    { strokeStyle: "double" as const, expected: 'stroke-dasharray="6,1.5" stroke-linecap="butt"' },
    { strokeStyle: "none" as const, expected: 'stroke="none"' },
  ];

  for (const scenario of scenarios) {
    const composite = buildCompositeSvg(
      defaultBaseLayer,
      defaultOverlayLayer,
      defaultEffects,
      defaultAnimation,
      {
        ...defaultBackground,
        type: "flat",
        shape: "square",
        frameWidth: 3,
        frameColor: "#abcdef",
        strokeStyle: scenario.strokeStyle,
      },
      null,
      new Map(),
      null,
    );

    assert.equal(composite.includes(scenario.expected), true);
  }

  const solid = buildCompositeSvg(
    defaultBaseLayer,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    {
      ...defaultBackground,
      type: "flat",
      frameWidth: 3,
      frameColor: "#abcdef",
      strokeStyle: "solid",
    },
    null,
    new Map(),
    null,
  );
  assert.equal(solid.includes("stroke-dasharray"), false);
});

test("buildCompositeSvg renders all supported background shapes", () => {
  const shapeMarkers: Array<{ shape: typeof defaultBackground.shape; marker: string }> = [
    { shape: "circle", marker: '<circle cx="256" cy="256" r="240"' },
    { shape: "triangle", marker: 'points="256,16 496,496 16,496"' },
    { shape: "square", marker: '<rect x="0" y="0" width="512" height="512"' },
    { shape: "rounded-square", marker: 'rx="64" ry="64"' },
    { shape: "star5", marker: "<polygon points=" },
    { shape: "star6", marker: "<polygon points=" },
    { shape: "star7", marker: "<polygon points=" },
    { shape: "hexa", marker: "<polygon points=" },
    { shape: "octa", marker: "<polygon points=" },
  ];

  for (const item of shapeMarkers) {
    const composite = buildCompositeSvg(
      defaultBaseLayer,
      defaultOverlayLayer,
      defaultEffects,
      defaultAnimation,
      {
        ...defaultBackground,
        type: "flat",
        shape: item.shape,
        frameRotate: 10,
        frameScale: -20,
      },
      null,
      new Map(),
      null,
    );

    assert.equal(composite.includes(item.marker), true);
    assert.equal(composite.includes('scale(0)'), true);
  }
});

test("buildCompositeSvg renders explicit triangle and square background primitives", () => {
  const triangle = buildCompositeSvg(
    defaultBaseLayer,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    {
      ...defaultBackground,
      type: "flat",
      shape: "triangle",
    },
    null,
    new Map(),
    null,
  );
  assert.match(triangle, /<polygon points="256,16 496,496 16,496"/);

  const square = buildCompositeSvg(
    defaultBaseLayer,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    {
      ...defaultBackground,
      type: "flat",
      shape: "square",
    },
    null,
    new Map(),
    null,
  );
  assert.match(square, /<rect x="0" y="0" width="512" height="512"/);
});

test("buildCompositeSvg composes foreground inner shadow with CSS filter chain", () => {
  const base = {
    ...defaultBaseLayer,
    path: "inner-shadow.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#000" d="M40 40H472V472H40z"/></svg>`,
  };

  const composite = buildCompositeSvg(
    base,
    defaultOverlayLayer,
    {
      ...defaultEffects,
      shadowX: 4,
      shadowY: -2,
      shadowBlur: 6,
      shadowColor: "#123456",
      blur: 3,
      hueRotate: 10,
      saturate: 130,
    },
    defaultAnimation,
    defaultBackground,
    {
      ...defaultForeground,
      shadowEnabled: true,
      shadowMode: "inner",
      shadowColor: "#ff000080",
      shadowBlur: 8,
      shadowOffsetX: 2,
      shadowOffsetY: -1,
    },
    new Map(),
    null,
  );

  assert.match(composite, /<filter id="fg-inner-shadow"/);
  assert.match(
    composite,
    /<g data-foreground-root="true" style="filter:[^"]*drop-shadow\(4px -2px 6px #123456\)/,
  );
  assert.match(composite, /<g filter="url\(#fg-inner-shadow\)">/);
});

test("buildCompositeSvg applies foreground blend mode and opacity", () => {
  const base = {
    ...defaultBaseLayer,
    path: "blend.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#000" d="M40 40H472V472H40z"/></svg>`,
  };

  const composite = buildCompositeSvg(
    base,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    defaultBackground,
    {
      ...defaultForeground,
      blendMode: "multiply",
      blendOpacity: 0.35,
    },
    new Map(),
    null,
  );

  assert.match(composite, /<svg[^>]*style="isolation:isolate;"/);
  assert.match(
    composite,
    /<g data-foreground-root="true" style="[^"]*mix-blend-mode:multiply;[^"]*opacity:0.35;/,
  );
  assert.match(composite, /mix-blend-mode:multiply;/);
  assert.match(composite, /opacity:0.35;/);
});

test("buildCompositeSvg does not emit identity filter wrappers", () => {
  const base = {
    ...defaultBaseLayer,
    path: "path-blend.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g data-foreground-path-id="path-1" style="mix-blend-mode:screen;opacity:0.4;"><path fill="#000" d="M40 40H472V472H40z"/></g></svg>`,
  };

  const composite = buildCompositeSvg(
    base,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    defaultBackground,
    null,
    new Map(),
    null,
  );

  assert.match(composite, /mix-blend-mode:screen;opacity:0.4;/);
  assert.equal(composite.includes('style="filter:'), false);
});

test("buildCompositeSvg applies background shadow modes", () => {
  const outer = buildCompositeSvg(
    defaultBaseLayer,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    {
      ...defaultBackground,
      type: "flat",
      shadowEnabled: true,
      shadowMode: "outer",
      shadowColor: "#112233",
      shadowBlur: 5,
      shadowOffsetX: 3,
      shadowOffsetY: -2,
    },
    null,
    new Map(),
    null,
  );
  assert.match(outer, /style="filter:drop-shadow\(3px -2px 5px #112233\);"/);

  const inner = buildCompositeSvg(
    defaultBaseLayer,
    defaultOverlayLayer,
    defaultEffects,
    defaultAnimation,
    {
      ...defaultBackground,
      type: "flat",
      shadowEnabled: true,
      shadowMode: "inner",
      shadowColor: "#445566cc",
      shadowBlur: 7,
      shadowOffsetX: -4,
      shadowOffsetY: 6,
    },
    null,
    new Map(),
    null,
  );
  assert.match(inner, /<filter id="bg-inner-shadow"/);
  assert.match(inner, /filter="url\(#bg-inner-shadow\)"/);
});
