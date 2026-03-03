import type { AnimationClipState } from "../editor";

export type ExportFormat =
  | "svg"
  | "png"
  | "jpeg"
  | "webp"
  | "gif"
  | "webm"
  | "mp4";

export interface ExportRequest {
  format: ExportFormat;
  svg: string;
  size: number;
  quality: number;
  fps: number;
  animationClip: AnimationClipState;
  pathAnimationClips: Record<string, AnimationClipState>;
  signal?: AbortSignal;
  onProgress?: (value: number, message?: string) => void;
}

export interface ExportAnimationSummary {
  hasAnimations: boolean;
  hasLoopingAnimations: boolean;
  clipCount: number;
}
