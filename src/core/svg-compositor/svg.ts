import type {
  AnimationState,
  BackgroundStyleState,
  EffectsState,
  ForegroundStyleState,
  LayerState,
  ParsedSvg,
  PreviewTransform,
  SurfaceStyleState,
} from "../editor";
import {
  buildForegroundGradientDef,
  buildForegroundTransformOperations,
  replaceAutoFillAttributes,
} from "./foreground-style";

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function parseViewBoxSize(
  viewBox: string,
): { width: number; height: number } | null {
  const tokens = viewBox.trim().split(/[\s,]+/);
  if (tokens.length < 4) {
    return null;
  }

  const width = Number(tokens[2]);
  const height = Number(tokens[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return { width, height };
}

function isApproximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.001;
}

function hasBlackFillOrDefault(element: Element): boolean {
  const fill = (element.getAttribute("fill") ?? "").trim().toLowerCase();
  return (
    fill === "" ||
    fill === "#000" ||
    fill === "#000000" ||
    fill === "black" ||
    fill === "rgb(0,0,0)"
  );
}

function isSolidCanvasBackground(element: Element, viewBox: string): boolean {
  if (!hasBlackFillOrDefault(element)) {
    return false;
  }

  const size = parseViewBoxSize(viewBox);
  if (!size) {
    return false;
  }

  const tag = element.tagName.toLowerCase();
  if (tag === "path") {
    const d = (element.getAttribute("d") ?? "").trim();
    const match = d.match(
      /^M\s*0(?:\.0+)?\s+0(?:\.0+)?\s*h\s*([0-9.]+)\s*v\s*([0-9.]+)\s*H\s*0(?:\.0+)?\s*z$/i,
    );
    if (!match) {
      return false;
    }

    const width = Number(match[1]);
    const height = Number(match[2]);
    return (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      isApproximatelyEqual(width, size.width) &&
      isApproximatelyEqual(height, size.height)
    );
  }

  if (tag === "rect") {
    const x = Number(element.getAttribute("x") ?? "0");
    const y = Number(element.getAttribute("y") ?? "0");
    const width = Number(element.getAttribute("width") ?? "0");
    const height = Number(element.getAttribute("height") ?? "0");

    return (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      isApproximatelyEqual(x, 0) &&
      isApproximatelyEqual(y, 0) &&
      isApproximatelyEqual(width, size.width) &&
      isApproximatelyEqual(height, size.height)
    );
  }

  return false;
}

export function parseSvg(
  svg: string,
  cache: Map<string, ParsedSvg>,
): ParsedSvg {
  const cached = cache.get(svg);
  if (cached) {
    return cached;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const svgNode = doc.querySelector("svg");
  const serializer = new XMLSerializer();

  if (!svgNode) {
    return { viewBox: "0 0 512 512", inner: "", defs: "" };
  }

  const viewBox = svgNode.getAttribute("viewBox") ?? "0 0 512 512";
  const defs = svgNode.querySelector("defs");

  const inner = Array.from(svgNode.childNodes)
    .filter((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return true;
      }

      const element = node as Element;
      if (element.tagName.toLowerCase() === "defs") {
        return false;
      }

      return !isSolidCanvasBackground(element, viewBox);
    })
    .map((node) => serializer.serializeToString(node))
    .join("");

  const parsed = {
    viewBox,
    inner,
    defs: defs ? serializer.serializeToString(defs) : "",
  };

  cache.set(svg, parsed);
  return parsed;
}

export function wrapWithParentTransforms(
  node: Element,
  serializer: XMLSerializer,
): string {
  let wrapped = serializer.serializeToString(node.cloneNode(true));
  const wrappers: string[] = [];

  let current = node.parentElement;
  while (current && current.tagName.toLowerCase() !== "svg") {
    const attrs: string[] = [];
    const transform = current.getAttribute("transform");
    const opacity = current.getAttribute("opacity");
    const style = current.getAttribute("style");

    if (transform) {
      attrs.push(`transform="${transform}"`);
    }

    if (opacity) {
      attrs.push(`opacity="${opacity}"`);
    }

    if (style) {
      attrs.push(`style="${style}"`);
    }

    if (attrs.length > 0) {
      wrappers.push(`<g ${attrs.join(" ")}>`);
    }

    current = current.parentElement;
  }

  for (let index = wrappers.length - 1; index >= 0; index -= 1) {
    wrapped = `${wrappers[index]}${wrapped}</g>`;
  }

  return wrapped;
}

function buildSurfaceShadowFilter(
  surface: SurfaceStyleState | null | undefined,
): string | null {
  if (!surface?.shadowEnabled || (surface.shadowMode ?? "outer") !== "outer") {
    return null;
  }

  const blur = Math.max(0, surface.shadowBlur || 0);
  const offsetX = surface.shadowOffsetX || 0;
  const offsetY = surface.shadowOffsetY || 0;
  const color = surface.shadowColor || "rgba(0, 0, 0, 0.7)";

  if (blur === 0 && offsetX === 0 && offsetY === 0) {
    return null;
  }

  return `drop-shadow(${offsetX}px ${offsetY}px ${blur}px ${color})`;
}

function clampSurfaceOpacity(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(0, Math.min(1, value));
}

function buildSurfaceBlendStyle(
  surface: SurfaceStyleState | null | undefined,
): string | null {
  const declarations: string[] = [];
  const blendMode = surface?.blendMode ?? "normal";
  if (blendMode !== "normal") {
    declarations.push(`mix-blend-mode:${blendMode};`);
  }

  const opacity = clampSurfaceOpacity(surface?.blendOpacity);
  if (opacity !== 1) {
    declarations.push(`opacity:${opacity};`);
  }

  return declarations.length > 0 ? declarations.join("") : null;
}

function parseHexColor(
  input: string,
): { rgb: string; alpha: number } | null {
  const value = input.trim();
  if (!value.startsWith("#")) {
    return null;
  }

  const hex = value.slice(1);
  if (![3, 4, 6, 8].includes(hex.length)) {
    return null;
  }

  const isValid = /^[0-9a-fA-F]+$/.test(hex);
  if (!isValid) {
    return null;
  }

  const expand = (ch: string) => `${ch}${ch}`;
  const readByte = (pair: string) => Number.parseInt(pair, 16);

  let r = 0;
  let g = 0;
  let b = 0;
  let a = 255;

  if (hex.length === 3 || hex.length === 4) {
    r = readByte(expand(hex[0]));
    g = readByte(expand(hex[1]));
    b = readByte(expand(hex[2]));
    if (hex.length === 4) {
      a = readByte(expand(hex[3]));
    }
  } else {
    r = readByte(hex.slice(0, 2));
    g = readByte(hex.slice(2, 4));
    b = readByte(hex.slice(4, 6));
    if (hex.length === 8) {
      a = readByte(hex.slice(6, 8));
    }
  }

  return { rgb: `rgb(${r},${g},${b})`, alpha: a / 255 };
}

function buildInnerShadowFilterDef(
  id: string,
  surface: SurfaceStyleState,
): string | null {
  if (!surface.shadowEnabled || (surface.shadowMode ?? "outer") !== "inner") {
    return null;
  }

  const blur = Math.max(0, surface.shadowBlur || 0);
  const dx = surface.shadowOffsetX || 0;
  const dy = surface.shadowOffsetY || 0;
  const rawColor = surface.shadowColor || "#000000";
  const parsed = parseHexColor(rawColor);
  const floodColor = parsed?.rgb ?? rawColor;
  const floodOpacity = parsed ? Math.max(0, Math.min(1, parsed.alpha)) : 1;

  if (blur === 0 && dx === 0 && dy === 0) {
    return null;
  }

  return [
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">`,
    `  <feOffset dx="${dx}" dy="${dy}" in="SourceAlpha" result="offset" />`,
    `  <feGaussianBlur in="offset" stdDeviation="${blur}" result="blur" />`,
    `  <feComposite in="blur" in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1" result="inner" />`,
    `  <feFlood flood-color="${floodColor}" flood-opacity="${floodOpacity}" result="flood" />`,
    `  <feComposite in="flood" in2="inner" operator="in" result="shadow" />`,
    `  <feComposite in="shadow" in2="SourceGraphic" operator="over" />`,
    `</filter>`,
  ].join("");
}

function buildLayerMarkup(
  layer: LayerState,
  parsedCache: Map<string, ParsedSvg>,
  foreground: ForegroundStyleState | null = null,
  defsOut: string[] = [],
  nextGradientId: () => string = () =>
    `fg-gradient-${Math.random().toString(36).slice(2, 10)}`,
): string {
  if (!layer.svg) {
    return "";
  }

  const parsed = parseSvg(layer.svg, parsedCache);

  // Build base transform
  let transform = `translate(256 256) translate(${layer.x} ${layer.y}) rotate(${layer.rotate}) scale(${layer.scale})`;

  // Apply foreground transformations if present
  if (foreground) {
    transform += buildForegroundTransformOperations(foreground);
  }

  transform += ` translate(-256 -256)`;

  let inner = parsed.inner;

  if (foreground) {
    if (foreground.type === "flat") {
      inner = replaceAutoFillAttributes(inner, foreground.flatColor);
    } else if (foreground.type === "gradient") {
      const gradId = nextGradientId();
      defsOut.push(buildForegroundGradientDef(foreground, gradId));
      inner = replaceAutoFillAttributes(inner, `url(#${gradId})`);
    } else if (foreground.type === "none") {
      inner = replaceAutoFillAttributes(inner, "none");
    }
  }

  return `<g transform="${transform}" opacity="${layer.opacity}"><svg x="0" y="0" width="512" height="512" viewBox="${parsed.viewBox}" preserveAspectRatio="xMidYMid meet">${parsed.defs}${inner}</svg></g>`;
}

function buildAnimationTransform(
  animation: AnimationState,
  progress: number,
): string {
  const x = lerp(animation.startX, animation.endX, progress);
  const y = lerp(animation.startY, animation.endY, progress);
  const scale = lerp(animation.startScale, animation.endScale, progress);
  const rotate = lerp(animation.startRotate, animation.endRotate, progress);
  return `translate(256 256) translate(${x} ${y}) rotate(${rotate}) scale(${scale}) translate(-256 -256)`;
}

export function buildPreviewTransform(
  animation: AnimationState,
  progress: number,
): PreviewTransform {
  return {
    x: lerp(animation.startX, animation.endX, progress),
    y: lerp(animation.startY, animation.endY, progress),
    scale: lerp(animation.startScale, animation.endScale, progress),
    rotate: lerp(animation.startRotate, animation.endRotate, progress),
  };
}

function buildStarPoints(points: number, rotationDeg: number): string {
  const center = 256;
  const outer = 240;
  const inner = 108;
  const vertices: string[] = [];

  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle =
      ((rotationDeg - 90 + (360 / (points * 2)) * index) * Math.PI) / 180;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    vertices.push(`${x.toFixed(3)},${y.toFixed(3)}`);
  }

  return vertices.join(" ");
}

function buildRegularPolygonPoints(sides: number, rotationDeg: number): string {
  const center = 256;
  const radius = 240;
  const vertices: string[] = [];

  for (let index = 0; index < sides; index += 1) {
    const angle = ((rotationDeg - 90 + (360 / sides) * index) * Math.PI) / 180;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    vertices.push(`${x.toFixed(3)},${y.toFixed(3)}`);
  }

  return vertices.join(" ");
}

function buildShapeElement(
  shape: BackgroundStyleState["shape"],
  fill: string,
  stroke: string,
  strokeWidth: number,
  strokeStyle: BackgroundStyleState["strokeStyle"],
  rotateDeg: number,
  scalePercent: number,
  shadowFilter: string | null,
): string {
  const scale = Math.max(0, scalePercent) / 100;
  const needsTransform = rotateDeg !== 0 || scale !== 1;
  const transform = needsTransform
    ? ` transform="translate(256 256) rotate(${rotateDeg}) scale(${scale}) translate(-256 -256)"`
    : "";
  
  // Map stroke style to SVG stroke-dasharray
  let strokeDasharray = "";
  if (strokeWidth > 0 && stroke !== "none") {
    switch (strokeStyle) {
      case "dashed":
        strokeDasharray = ` stroke-dasharray="${strokeWidth * 4},${strokeWidth * 2}"`;
        break;
      case "dotted":
        strokeDasharray = ` stroke-dasharray="${strokeWidth},${strokeWidth}" stroke-linecap="round"`;
        break;
      case "double":
        // For double, we'll use a wider stroke with a pattern
        strokeDasharray = ` stroke-dasharray="${strokeWidth * 2},${strokeWidth * 0.5}" stroke-linecap="butt"`;
        break;
      case "none":
        stroke = "none";
        break;
      case "solid":
      default:
        // No dasharray needed for solid
        break;
    }
  }
  
  const style = shadowFilter ? ` style="filter:${shadowFilter};"` : "";
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${strokeDasharray}${transform}${style}`;

  if (shape === "circle") {
    return `<circle cx="256" cy="256" r="240" ${attrs} />`;
  }

  if (shape === "triangle") {
    return `<polygon points="256,16 496,496 16,496" ${attrs} />`;
  }

  if (shape === "square") {
    return `<rect x="0" y="0" width="512" height="512" ${attrs} />`;
  }

  if (shape === "rounded-square") {
    return `<rect x="0" y="0" width="512" height="512" rx="64" ry="64" ${attrs} />`;
  }

  if (shape === "star5") {
    return `<polygon points="${buildStarPoints(5, 0)}" ${attrs} />`;
  }

  if (shape === "star6") {
    return `<polygon points="${buildStarPoints(6, 0)}" ${attrs} />`;
  }

  if (shape === "star7") {
    return `<polygon points="${buildStarPoints(7, 0)}" ${attrs} />`;
  }

  if (shape === "hexa") {
    return `<polygon points="${buildRegularPolygonPoints(6, 0)}" ${attrs} />`;
  }
  return `<polygon points="${buildRegularPolygonPoints(8, 0)}" ${attrs} />`;
}

function buildClipPathShape(
  shape: BackgroundStyleState["shape"],
  rotateDeg: number,
  scalePercent: number,
): string {
  const scale = Math.max(0, scalePercent) / 100;
  const needsTransform = rotateDeg !== 0 || scale !== 1;
  const transform = needsTransform
    ? ` transform="translate(256 256) rotate(${rotateDeg}) scale(${scale}) translate(-256 -256)"`
    : "";

  if (shape === "circle") {
    return `<circle cx="256" cy="256" r="240"${transform} />`;
  }

  if (shape === "triangle") {
    return `<polygon points="256,16 496,496 16,496"${transform} />`;
  }

  if (shape === "square") {
    return `<rect x="0" y="0" width="512" height="512"${transform} />`;
  }

  if (shape === "rounded-square") {
    return `<rect x="0" y="0" width="512" height="512" rx="64" ry="64"${transform} />`;
  }

  if (shape === "star5") {
    return `<polygon points="${buildStarPoints(5, 0)}"${transform} />`;
  }

  if (shape === "star6") {
    return `<polygon points="${buildStarPoints(6, 0)}"${transform} />`;
  }

  if (shape === "star7") {
    return `<polygon points="${buildStarPoints(7, 0)}"${transform} />`;
  }

  if (shape === "hexa") {
    return `<polygon points="${buildRegularPolygonPoints(6, 0)}"${transform} />`;
  }
  return `<polygon points="${buildRegularPolygonPoints(8, 0)}"${transform} />`;
}

function buildBackgroundMarkup(background: BackgroundStyleState): {
  defs: string;
  shape: string;
  clipPath: string;
} {
  return buildBackgroundMarkupWithIds(background, {
    bgClipId: "bg-clip",
    bgGradientId: "bg-gradient",
    bgInnerShadowId: "bg-inner-shadow",
  });
}

interface BackgroundRenderIds {
  bgClipId: string;
  bgGradientId: string;
  bgInnerShadowId: string;
}

function buildBackgroundMarkupWithIds(
  background: BackgroundStyleState,
  ids: BackgroundRenderIds,
): {
  defs: string;
  shape: string;
  clipPath: string;
} {
  const gradientConfig: Record<
    BackgroundStyleState["gradientType"],
    { x1: string; y1: string; x2: string; y2: string; radial?: boolean }
  > = {
    radial: { x1: "50%", y1: "50%", x2: "50%", y2: "50%", radial: true },
    horizontal: { x1: "0%", y1: "50%", x2: "100%", y2: "50%" },
    vertical: { x1: "50%", y1: "0%", x2: "50%", y2: "100%" },
    "diagonal-forward": { x1: "0%", y1: "0%", x2: "100%", y2: "100%" },
    "diagonal-backward": { x1: "100%", y1: "0%", x2: "0%", y2: "100%" },
  };

  const hasFrame = background.frameWidth > 0;
  const strokeColor = hasFrame ? background.frameColor : "none";
  const strokeWidth = hasFrame ? background.frameWidth : 0;
  const strokeStyle = background.strokeStyle === "none" ? "none" : background.strokeStyle;

  // Build the clipPath for the background shape
  const clipPathShape = buildClipPathShape(
    background.shape,
    background.frameRotate,
    background.frameScale
  );
  const clipPath = `<clipPath id="${ids.bgClipId}">${clipPathShape}</clipPath>`;
  const backgroundShadowFilter = buildSurfaceShadowFilter(background);
  const innerShadowFilterDef = buildInnerShadowFilterDef(ids.bgInnerShadowId, background);

  if (background.type === "none") {
    if (!hasFrame) {
      const defs = innerShadowFilterDef ? clipPath + innerShadowFilterDef : clipPath;
      return { defs, shape: "", clipPath };
    }

    let defs = clipPath;
    if (innerShadowFilterDef) {
      defs += innerShadowFilterDef;
    }

    let shape = buildShapeElement(
      background.shape,
      "none",
      strokeColor,
      strokeWidth,
      strokeStyle,
      background.frameRotate,
      background.frameScale,
      backgroundShadowFilter,
    );

    if (innerShadowFilterDef) {
      shape = shape.replace(
        /^<([a-z]+)/,
        `<$1 filter="url(#${ids.bgInnerShadowId})"`,
      );
    }

    return {
      defs,
      shape,
      clipPath,
    };
  }

  if (background.type === "flat") {
    let defs = clipPath;
    if (innerShadowFilterDef) {
      defs += innerShadowFilterDef;
    }

    let shape = buildShapeElement(
      background.shape,
      background.flatColor,
      strokeColor,
      strokeWidth,
      strokeStyle,
      background.frameRotate,
      background.frameScale,
      backgroundShadowFilter,
    );

    if (innerShadowFilterDef) {
      shape = shape.replace(
        /^<([a-z]+)/,
        `<$1 filter="url(#${ids.bgInnerShadowId})"`,
      );
    }

    return {
      defs,
      shape,
      clipPath,
    };
  }

  const config = gradientConfig[background.gradientType];
  const gradientDef = config.radial
    ? `<radialGradient id="${ids.bgGradientId}" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="${background.gradientFrom}" /><stop offset="100%" stop-color="${background.gradientTo}" /></radialGradient>`
    : `<linearGradient id="${ids.bgGradientId}" x1="${config.x1}" y1="${config.y1}" x2="${config.x2}" y2="${config.y2}"><stop offset="0%" stop-color="${background.gradientFrom}" /><stop offset="100%" stop-color="${background.gradientTo}" /></linearGradient>`;

  let defs = gradientDef + clipPath;
  if (innerShadowFilterDef) {
    defs += innerShadowFilterDef;
  }

  let shape = buildShapeElement(
    background.shape,
    `url(#${ids.bgGradientId})`,
    strokeColor,
    strokeWidth,
    strokeStyle,
    background.frameRotate,
    background.frameScale,
    backgroundShadowFilter,
  );

  if (innerShadowFilterDef) {
    shape = shape.replace(
      /^<([a-z]+)/,
      `<$1 filter="url(#${ids.bgInnerShadowId})"`,
    );
  }

  return {
    defs,
    shape,
    clipPath,
  };
}

export function buildCompositeSvg(
  base: LayerState,
  overlay: LayerState,
  effects: EffectsState,
  animation: AnimationState,
  background: BackgroundStyleState,
  foreground: ForegroundStyleState | null,
  parsedCache: Map<string, ParsedSvg>,
  animationProgress: number | null,
  options: {
    surfaceForeground?: ForegroundStyleState | null;
    svgIdPrefix?: string;
  } = {},
): string {
  const foregroundSurface = options.surfaceForeground ?? foreground;
  const idPrefix = options.svgIdPrefix?.trim() || null;
  // Keep ids stable per render so outputs are predictable and test-friendly.
  const defs: string[] = [];
  let foregroundGradientCounter = 0;
  const nextGradientId = () => {
    foregroundGradientCounter += 1;
    return idPrefix
      ? `${idPrefix}-fg-gradient-${foregroundGradientCounter}`
      : `fg-gradient-${foregroundGradientCounter}`;
  };
  const baseMarkup = buildLayerMarkup(
    base,
    parsedCache,
    foreground,
    defs,
    nextGradientId,
  );
  const overlayMarkup = buildLayerMarkup(
    overlay,
    parsedCache,
    foreground,
    defs,
    nextGradientId,
  );
  const backgroundMarkup = idPrefix
    ? buildBackgroundMarkupWithIds(background, {
        bgClipId: `${idPrefix}-bg-clip`,
        bgGradientId: `${idPrefix}-bg-gradient`,
        bgInnerShadowId: `${idPrefix}-bg-inner-shadow`,
      })
    : buildBackgroundMarkup(background);
  const wrapperTransform =
    animationProgress === null
      ? ""
      : ` transform="${buildAnimationTransform(animation, animationProgress)}"`;
  const globalDropShadow =
    effects.shadowBlur !== 0 || effects.shadowX !== 0 || effects.shadowY !== 0
      ? `drop-shadow(${effects.shadowX}px ${effects.shadowY}px ${effects.shadowBlur}px ${effects.shadowColor})`
      : null;
  const foregroundShadowFilter = buildSurfaceShadowFilter(foregroundSurface);
  const filterParts: string[] = [];

  if (foregroundShadowFilter) {
    filterParts.push(foregroundShadowFilter);
  }
  if (globalDropShadow) {
    filterParts.push(globalDropShadow);
  }
  if (effects.blur !== 0) {
    filterParts.push(`blur(${effects.blur}px)`);
  }
  if (effects.hueRotate !== 0) {
    filterParts.push(`hue-rotate(${effects.hueRotate}deg)`);
  }
  if (effects.saturate !== 100) {
    filterParts.push(`saturate(${effects.saturate}%)`);
  }

  const filter = filterParts.join(" ");
  const foregroundBlendStyle = buildSurfaceBlendStyle(foregroundSurface);
  const foregroundInnerShadowId = idPrefix
    ? `${idPrefix}-fg-inner-shadow`
    : "fg-inner-shadow";
  const foregroundInnerShadowDef =
    foregroundSurface &&
    foregroundSurface.shadowEnabled &&
    foregroundSurface.shadowMode === "inner"
      ? buildInnerShadowFilterDef(foregroundInnerShadowId, foregroundSurface)
      : null;
  if (foregroundInnerShadowDef) {
    defs.push(foregroundInnerShadowDef);
  }

  const clipPathAttr = foregroundSurface?.clipToBackground
    ? ` clip-path="url(#${idPrefix ? `${idPrefix}-bg-clip` : "bg-clip"})"`
    : "";
  const layerMarkup = foregroundInnerShadowDef
    ? `<g filter="url(#${foregroundInnerShadowId})">${baseMarkup}${overlayMarkup}</g>`
    : `${baseMarkup}${overlayMarkup}`;
  const layerStyleParts: string[] = [];
  if (filter) {
    layerStyleParts.push(`filter:${filter};`);
  }
  if (foregroundBlendStyle) {
    layerStyleParts.push(foregroundBlendStyle);
  }
  const foregroundRootStyleAttr =
    layerStyleParts.length > 0 ? ` style="${layerStyleParts.join("")}"` : "";
  const foregroundRootMarkup = `<g data-foreground-root="true"${foregroundRootStyleAttr}>${layerMarkup}</g>`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="isolation:isolate;">
  <defs>${backgroundMarkup.defs}${defs.join("")}</defs>
  ${backgroundMarkup.shape}
  <g${wrapperTransform}${clipPathAttr}>
    ${foregroundRootMarkup}
  </g>
</svg>`.trim();
}
