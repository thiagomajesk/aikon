export { useEditorStore } from "./editor-store";

export type {
  AnimationClipState,
  AnimationClipConfig,
  AnimationPresetValue,
  AnimationState,
  AnimationStepTransform,
  BackgroundShape,
  BackgroundStyleState,
  BackgroundState,
  BackgroundType,
  CustomIcon,
  EditorStatus,
  EffectsState,
  ForegroundStyleState,
  GradientType,
  IconAvailability,
  IconMeta,
  IconPagePayload,
  LayerKey,
  LayerState,
  ParsedSvg,
  PathCandidate,
  Preset,
  PreviewTransform,
  StrokeStyle,
  SurfaceBlendMode,
  SurfaceShadowMode,
  SurfaceStyleState,
  SyncJob,
  ThreeStepAnimation,
} from "./types";

export {
  defaultBaseLayer,
  defaultOverlayLayer,
  defaultAnimation,
  defaultAnimationClip,
  defaultEffects,
  defaultBackground,
  defaultForeground,
} from "./constants";

export {
  areSurfaceStylesEqual,
  isDefaultBackgroundStyle,
  isDefaultForegroundStyle,
} from "./style-state";

export type {
  AnimationClipPreset,
  AnimationPresetOption,
  AnimationPresetOptionGroup,
} from "./animation-clip";
export {
  ANIMATION_EASING_OPTIONS,
  ANIMATION_PRESET_OPTIONS,
  ANIMATION_PRESETS,
  resolveAnimationPresetSteps,
  normalizeAnimationClipState,
  isDefaultAnimationClipState,
} from "./animation-clip";

export type {
  ForegroundPathSettings,
  AnimationPathSettings,
  IconHistoryEntry,
  IconSettings,
  IconHistory,
} from "./icon-history";
export {
  ICON_HISTORY_UPDATED_EVENT,
  ICON_ACCESSES_UPDATED_EVENT,
  loadIconHistory,
  loadIconHistoryEntries,
  saveIconSettings,
  loadIconSettings,
  clearIconHistory,
  loadRecentIconAccesses,
  saveRecentIconAccess,
} from "./icon-history";
