import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Popover,
  ScrollArea,
  Select,
  Slider,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronUp,
  IconDownload,
  IconFileExport,
  IconHistory,
  IconInfoCircle,
  IconPalette,
  IconSearch,
  IconTemplate,
} from "@tabler/icons-react";
import {
  ICON_PRESETS_UPDATED_EVENT,
  ICON_HISTORY_UPDATED_EVENT,
  PRESET_COLOR_FIELD_KEYS,
  createColorPresetSnapshot,
  loadColorPresets,
  loadIconHistoryEntries,
  markColorPresetUsed,
  saveColorPreset,
  defaultAnimation,
  defaultBaseLayer,
  defaultBackground,
  defaultEffects,
  defaultForeground,
  defaultOverlayLayer,
} from "../core/editor";
import type {
  AnimationClipState,
  BackgroundStyleState,
  ColorPreset,
  CustomIcon,
  ForegroundStyleState,
  IconHistoryEntry,
  LayerState,
  ParsedSvg,
  PreviewTransform,
} from "../core/editor";
import {
  buildExportFileName,
  createExportBlob,
  downloadBlob,
  formatPreservesAnimations,
  formatBytes,
  inspectExportAnimation,
  isAnimatedExportFormat,
  sanitizeFileName,
  supportsSizePreview,
} from "../core/export";
import type { ExportFormat, ExportRequest } from "../core/export";
import { ThreePreview } from "./ThreePreview";
import {
  resolveToolbarExpandedLayout,
  resolveToolbarGridTemplateRows,
} from "./preview-toolbar-state";
import {
  buildCompositeSvg,
  buildForegroundComposite,
} from "../core/svg-compositor";
import type { ParsedSvgBreakout } from "../core/svg-compositor";
import { fetchLocalIconSvg } from "../core/icon-catalog";
import { IconPreviewTile } from "./IconPreviewTile";

interface PreviewPanelProps {
  compositeSvg: string;
  previewTransform: PreviewTransform;
  showToolbar: boolean;
  iconCatalog: Array<{ name: string; path: string }>;
  customIcons: CustomIcon[];
  onIconSelect: (iconPath: string, iconName: string) => void;
  pathsInteractive: boolean;
  onSelectForegroundPath: (pathId: string) => void;
  selectedIconName: string | null;
  selectedIconAuthor: string | null;
  selectedIconDescription: string | null;
  selectedIconTags: string[];
  selectedIconExternalUrl: string | null;
  animationClip: AnimationClipState;
  pathAnimationClips?: Record<string, AnimationClipState>;
  backgroundStyle: BackgroundStyleState;
  foregroundStyle: ForegroundStyleState;
  onApplyColorPreset: (preset: ColorPreset) => void;
}

interface HistoryIconRef {
  name: string;
  path: string;
  svg: string | undefined;
  isCustom: boolean;
}

interface HistoryItem {
  name: string;
  path: string;
  compositeSvg: string;
}

interface PresetPreviewIconRef {
  name: string;
  path: string;
}

interface ExportDraft {
  fileName: string;
  format: ExportFormat;
  size: number;
  quality: number;
  fps: number;
}

interface SizePreviewState {
  state: "idle" | "loading" | "ready" | "unsupported" | "error";
  bytes?: number;
  message?: string;
}

const BASE_EXPORT_FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: "svg", label: "SVG" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
  { value: "gif", label: "GIF" },
];

const ANIMATED_EXPORT_FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: "webm", label: "WebM" },
  { value: "mp4", label: "MP4" },
];
const FPS_PRESET_VALUES = [15, 20, 30, 60] as const;
const EXPORT_SIZE_PRESETS = [32, 64, 128, 256, 512] as const;
const TOOLBAR_INSET = 10;
const toSvgIdPrefix = (value: string): string => {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const collapsed = cleaned.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return collapsed ? `pv-${collapsed}` : "pv-item";
};

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  compositeSvg,
  previewTransform,
  showToolbar,
  iconCatalog,
  customIcons,
  onIconSelect,
  pathsInteractive,
  onSelectForegroundPath,
  selectedIconName,
  selectedIconAuthor,
  selectedIconDescription,
  selectedIconTags,
  selectedIconExternalUrl,
  animationClip,
  pathAnimationClips,
  backgroundStyle,
  foregroundStyle,
  onApplyColorPreset,
}) => {
  const [activeTab, setActiveTab] = useState<string | null>("history");
  const [iconSvgs, setIconSvgs] = useState<Record<string, string>>({});
  const [historyRevision, setHistoryRevision] = useState(0);
  const [presetRevision, setPresetRevision] = useState(0);
  const [presetPreviewIcons, setPresetPreviewIcons] = useState<
    Record<string, PresetPreviewIconRef>
  >({});
  const [presetPreviewSvgs, setPresetPreviewSvgs] = useState<Record<string, string>>({});
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [presetSearchQuery, setPresetSearchQuery] = useState("");
  const [isSavePresetModalOpen, setIsSavePresetModalOpen] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [presetSaveError, setPresetSaveError] = useState<string | null>(null);
  const [pendingPresetToApply, setPendingPresetToApply] = useState<ColorPreset | null>(
    null,
  );
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [sizePreview, setSizePreview] = useState<SizePreviewState>({
    state: "idle",
  });
  const [exportDraft, setExportDraft] = useState<ExportDraft>(() => ({
    fileName: sanitizeFileName(selectedIconName ?? "aikon-export"),
    format: "svg",
    size: 512,
    quality: 0.92,
    fps: 30,
  }));
  const sizePreviewTokenRef = useRef(0);

  const historyPreviewTransform: PreviewTransform = {
    x: 0,
    y: 0,
    scale: 1,
    rotate: 0,
  };

  useEffect(() => {
    setExportDraft((previous) => ({
      ...previous,
      fileName: sanitizeFileName(selectedIconName ?? "aikon-export"),
    }));
  }, [selectedIconName]);

  useEffect(() => {
    const handleHistoryUpdated = (): void => {
      setHistoryRevision((current) => current + 1);
    };

    window.addEventListener(ICON_HISTORY_UPDATED_EVENT, handleHistoryUpdated);
    return () => {
      window.removeEventListener(ICON_HISTORY_UPDATED_EVENT, handleHistoryUpdated);
    };
  }, []);

  useEffect(() => {
    const handlePresetsUpdated = (): void => {
      setPresetRevision((current) => current + 1);
    };

    window.addEventListener(ICON_PRESETS_UPDATED_EVENT, handlePresetsUpdated);
    return () => {
      window.removeEventListener(ICON_PRESETS_UPDATED_EVENT, handlePresetsUpdated);
    };
  }, []);

  const historyEntries = useMemo<IconHistoryEntry[]>(() => {
    return loadIconHistoryEntries();
  }, [historyRevision]);

  const historyIconRefs = useMemo(() => {
    return historyEntries.flatMap<HistoryIconRef>((entry) => {
      const icon = iconCatalog.find((item) => item.name === entry.iconName);
      const customIcon = customIcons.find((item) => item.name === entry.iconName);
      const resolvedPath = entry.iconPath ?? customIcon?.path ?? icon?.path;
      if (!resolvedPath) {
        return [];
      }

      return [
        {
          name: entry.iconName,
          path: resolvedPath,
          svg: customIcon?.svg,
          isCustom: Boolean(customIcon),
        },
      ];
    });
  }, [customIcons, historyEntries, iconCatalog]);

  useEffect(() => {
    let cancelled = false;
    const fetchSvgs = async (): Promise<void> => {
      const svgsToFetch = historyIconRefs.filter(
        (item) => !item.isCustom && !iconSvgs[item.name],
      );
      if (svgsToFetch.length === 0) {
        return;
      }

      const loadedSvgs: Record<string, string> = {};
      await Promise.all(
        svgsToFetch.map(async (item) => {
          try {
            loadedSvgs[item.name] = await fetchLocalIconSvg(item.path);
          } catch {
            // Ignore history preview failures to keep editor usable.
          }
        }),
      );

      if (cancelled || Object.keys(loadedSvgs).length === 0) {
        return;
      }

      setIconSvgs((previous) => ({
        ...previous,
        ...loadedSvgs,
      }));
    };

    void fetchSvgs();
    return () => {
      cancelled = true;
    };
  }, [historyIconRefs, iconSvgs, historyRevision]);

  const historyItems = useMemo(() => {
    const settingsByName = new Map(
      historyEntries.map((entry) => [entry.iconName, entry.settings] as const),
    );
    const parsedCache = new Map<string, ParsedSvg>();
    const breakoutCache = new Map<string, ParsedSvgBreakout>();

    return historyIconRefs.flatMap<HistoryItem>((item) => {
      const svg = item.isCustom ? item.svg : iconSvgs[item.name];
      const settings = settingsByName.get(item.name);
      if (!svg || !settings) {
        return [];
      }

      const styledForeground = buildForegroundComposite({
        svg,
        foreground: settings.foreground,
        pathConfig: settings.foregroundPaths
          ? {
              enabled: settings.foregroundPaths.enabled,
              pathStyles: settings.foregroundPaths.pathStyles,
            }
          : null,
        parsedSvgCache: parsedCache,
        breakoutCache,
      });

      const baseLayer: LayerState = {
        ...defaultBaseLayer,
        path: item.path,
        svg: styledForeground.svg,
      };

      const compositeHistorySvg = buildCompositeSvg(
        baseLayer,
        defaultOverlayLayer,
        defaultEffects,
        defaultAnimation,
        settings.background,
        styledForeground.foregroundForComposite,
        parsedCache,
        null,
        {
          svgIdPrefix: toSvgIdPrefix(`history-${item.name}`),
        },
      );

      return [
        {
          name: item.name,
          path: item.path,
          compositeSvg: compositeHistorySvg,
        },
      ];
    });
  }, [historyEntries, historyIconRefs, iconSvgs]);

  const filteredHistoryItems = useMemo(() => {
    const query = historySearchQuery.trim().toLowerCase();
    if (!query) {
      return historyItems;
    }

    return historyItems.filter((item) => {
      return (
        item.name.toLowerCase().includes(query) ||
        item.path.toLowerCase().includes(query)
      );
    });
  }, [historyItems, historySearchQuery]);

  const collapsedHistoryItems = useMemo(() => {
    return filteredHistoryItems.slice(0, 10);
  }, [filteredHistoryItems]);
  const colorPresets = useMemo(() => {
    return loadColorPresets();
  }, [presetRevision]);
  const filteredPresets = useMemo(() => {
    const query = presetSearchQuery.trim().toLowerCase();
    if (!query) {
      return colorPresets;
    }

    return colorPresets.filter((preset) => {
      return preset.name.toLowerCase().includes(query);
    });
  }, [colorPresets, presetSearchQuery]);
  const collapsedPresets = useMemo(() => {
    return filteredPresets.slice(0, 10);
  }, [filteredPresets]);

  useEffect(() => {
    if (colorPresets.length === 0 || iconCatalog.length === 0) {
      return;
    }

    setPresetPreviewIcons((previous) => {
      let hasChanges = false;
      const next: Record<string, PresetPreviewIconRef> = {};
      const availableByPath = new Map(iconCatalog.map((icon) => [icon.path, icon]));

      for (const preset of colorPresets) {
        const existing = previous[preset.id];
        if (existing && availableByPath.has(existing.path)) {
          next[preset.id] = existing;
          continue;
        }

        const randomIcon =
          iconCatalog[Math.floor(Math.random() * iconCatalog.length)] ?? null;
        if (!randomIcon) {
          continue;
        }

        next[preset.id] = {
          name: randomIcon.name,
          path: randomIcon.path,
        };
        hasChanges = true;
      }

      const previousIds = Object.keys(previous);
      if (!hasChanges && previousIds.length !== Object.keys(next).length) {
        hasChanges = true;
      }

      return hasChanges ? next : previous;
    });
  }, [colorPresets, iconCatalog]);

  useEffect(() => {
    const assignedPaths = Array.from(
      new Set(Object.values(presetPreviewIcons).map((icon) => icon.path)),
    );
    const pathsToFetch = assignedPaths.filter((path) => !presetPreviewSvgs[path]);
    if (pathsToFetch.length === 0) {
      return;
    }

    let cancelled = false;

    const fetchPresetSvgs = async (): Promise<void> => {
      const loaded: Record<string, string> = {};
      await Promise.all(
        pathsToFetch.map(async (path) => {
          try {
            loaded[path] = await fetchLocalIconSvg(path);
          } catch {
            // Ignore preview fetch errors to keep presets UI responsive.
          }
        }),
      );

      if (cancelled || Object.keys(loaded).length === 0) {
        return;
      }

      setPresetPreviewSvgs((previous) => ({
        ...previous,
        ...loaded,
      }));
    };

    void fetchPresetSvgs();
    return () => {
      cancelled = true;
    };
  }, [presetPreviewIcons, presetPreviewSvgs]);

  const presetPreviewById = useMemo(() => {
    const parsedCache = new Map<string, ParsedSvg>();
    const breakoutCache = new Map<string, ParsedSvgBreakout>();
    const result = new Map<string, string>();

    for (const preset of colorPresets) {
      const iconRef = presetPreviewIcons[preset.id];
      if (!iconRef) {
        continue;
      }

      const svg = presetPreviewSvgs[iconRef.path];
      if (!svg) {
        continue;
      }

      const presetBackground: BackgroundStyleState = {
        ...defaultBackground,
        ...preset.background,
      };
      const presetForeground: ForegroundStyleState = {
        ...defaultForeground,
        ...preset.foreground,
      };

      const styledForeground = buildForegroundComposite({
        svg,
        foreground: presetForeground,
        pathConfig: null,
        parsedSvgCache: parsedCache,
        breakoutCache,
      });

      const baseLayer: LayerState = {
        ...defaultBaseLayer,
        path: iconRef.path,
        svg: styledForeground.svg,
      };

      const composite = buildCompositeSvg(
        baseLayer,
        defaultOverlayLayer,
        defaultEffects,
        defaultAnimation,
        presetBackground,
        styledForeground.foregroundForComposite,
        parsedCache,
        null,
        {
          svgIdPrefix: toSvgIdPrefix(`preset-${preset.id}`),
        },
      );

      result.set(preset.id, composite);
    }

    return result;
  }, [colorPresets, presetPreviewIcons, presetPreviewSvgs]);

  const hasIconInfo = Boolean(
    selectedIconName ||
      selectedIconAuthor ||
      selectedIconDescription ||
      selectedIconExternalUrl ||
      selectedIconTags.length > 0,
  );
  const hasSelectedIcon = Boolean(selectedIconName);
  const shouldConfirmPresetApply = useMemo(() => {
    if (!hasSelectedIcon) {
      return false;
    }

    return PRESET_COLOR_FIELD_KEYS.some((key) => {
      return (
        backgroundStyle[key] !== defaultBackground[key] ||
        foregroundStyle[key] !== defaultForeground[key]
      );
    });
  }, [backgroundStyle, foregroundStyle, hasSelectedIcon]);

  const applyPreset = (preset: ColorPreset): void => {
    if (!hasSelectedIcon) {
      return;
    }

    onApplyColorPreset(preset);
    markColorPresetUsed(preset.id);
  };

  const handlePresetSelection = (preset: ColorPreset): void => {
    if (!hasSelectedIcon) {
      return;
    }

    if (shouldConfirmPresetApply) {
      setPendingPresetToApply(preset);
      return;
    }

    applyPreset(preset);
  };

  const handleSavePreset = (): void => {
    const snapshot = createColorPresetSnapshot(backgroundStyle, foregroundStyle);
    const saved = saveColorPreset(presetNameDraft, snapshot);
    if (!saved) {
      setPresetSaveError("Please enter a preset name.");
      return;
    }

    setPresetSaveError(null);
    setPresetNameDraft("");
    setIsSavePresetModalOpen(false);
  };

  const renderPresetMedia = (preset: ColorPreset): React.ReactNode => {
    const previewSvg = presetPreviewById.get(preset.id);
    if (!previewSvg) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Loader size="sm" color="gray" />
        </div>
      );
    }

    return (
      <div className="ps-icon-preview-content">
        <ThreePreview svg={previewSvg} transform={historyPreviewTransform} readOnly />
      </div>
    );
  };

  const animationSummary = useMemo(() => {
    return inspectExportAnimation(animationClip, pathAnimationClips ?? {});
  }, [animationClip, pathAnimationClips]);

  const hasAnimations = animationSummary.hasAnimations;
  const availableExportFormatOptions = useMemo(() => {
    if (!hasAnimations) {
      return BASE_EXPORT_FORMAT_OPTIONS;
    }

    return [...BASE_EXPORT_FORMAT_OPTIONS, ...ANIMATED_EXPORT_FORMAT_OPTIONS];
  }, [hasAnimations]);

  useEffect(() => {
    const allowedFormats = new Set(
      availableExportFormatOptions.map((entry) => entry.value),
    );
    if (allowedFormats.has(exportDraft.format)) {
      return;
    }

    setExportDraft((previous) => ({
      ...previous,
      format: "svg",
    }));
  }, [availableExportFormatOptions, exportDraft.format]);

  const exportWarning = useMemo(() => {
    if (hasAnimations && !formatPreservesAnimations(exportDraft.format)) {
      return "This icon contains animations. The selected format exports a static frame, so animations will be ignored.";
    }

    return null;
  }, [exportDraft.format, hasAnimations]);

  useEffect(() => {
    if (!isExportModalOpen) {
      return;
    }

    if (!supportsSizePreview(exportDraft.format)) {
      setSizePreview({
        state: "unsupported",
        message: "File size preview is not available for this format.",
      });
      return;
    }

    const token = sizePreviewTokenRef.current + 1;
    sizePreviewTokenRef.current = token;
    const abortController = new AbortController();

    setSizePreview({ state: "loading" });

    const timeout = window.setTimeout(() => {
      const request: ExportRequest = {
        format: exportDraft.format,
        svg: compositeSvg,
        size: exportDraft.size,
        quality: exportDraft.quality,
        fps: exportDraft.fps,
        animationClip,
        pathAnimationClips: pathAnimationClips ?? {},
        signal: abortController.signal,
      };

      void createExportBlob(request)
        .then((blob) => {
          if (sizePreviewTokenRef.current !== token || abortController.signal.aborted) {
            return;
          }

          setSizePreview({ state: "ready", bytes: blob.size });
        })
        .catch((error: unknown) => {
          if (sizePreviewTokenRef.current !== token || abortController.signal.aborted) {
            return;
          }

          const message =
            error instanceof Error ? error.message : "Could not estimate file size.";
          setSizePreview({ state: "error", message });
        });
    }, 300);

    return () => {
      abortController.abort();
      window.clearTimeout(timeout);
    };
  }, [
    animationClip,
    compositeSvg,
    exportDraft.fps,
    exportDraft.format,
    exportDraft.quality,
    exportDraft.size,
    isExportModalOpen,
    pathAnimationClips,
  ]);

  const handleExport = async (): Promise<void> => {
    setIsExporting(true);
    setExportProgress(0);
    setExportError(null);

    try {
      const request: ExportRequest = {
        format: exportDraft.format,
        svg: compositeSvg,
        size: exportDraft.size,
        quality: exportDraft.quality,
        fps: exportDraft.fps,
        animationClip,
        pathAnimationClips: pathAnimationClips ?? {},
        onProgress: (value) => {
          setExportProgress(value);
        },
      };
      const blob = await createExportBlob(request);
      const fileName = buildExportFileName(exportDraft.fileName, exportDraft.format);
      downloadBlob(blob, fileName);
      setIsExportModalOpen(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Export failed.";
      setExportError(message);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const sizePreviewLabel = useMemo(() => {
    if (sizePreview.state === "loading") {
      return "Calculating file size…";
    }

    if (sizePreview.state === "ready" && typeof sizePreview.bytes === "number") {
      return `Estimated file size: ${formatBytes(sizePreview.bytes)}`;
    }

    if (sizePreview.state === "unsupported") {
      return sizePreview.message ?? "File size preview unavailable.";
    }

    if (sizePreview.state === "error") {
      return sizePreview.message ?? "Could not calculate file size.";
    }

    return "File size preview available after choosing format settings.";
  }, [sizePreview]);

  const fpsPresetIndex = useMemo(() => {
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < FPS_PRESET_VALUES.length; index += 1) {
      const distance = Math.abs(FPS_PRESET_VALUES[index] - exportDraft.fps);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
    return closestIndex;
  }, [exportDraft.fps]);
  const isToolbarExpanded = resolveToolbarExpandedLayout(activeTab, isHistoryExpanded);

  return (
    <>
      <div
        style={{
          height: "100%",
          minHeight: 0,
          display: "grid",
          gridTemplateRows: resolveToolbarGridTemplateRows(isToolbarExpanded),
          transition: "grid-template-rows 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            padding: isToolbarExpanded ? "0" : "8px 0 12px",
            gap: isToolbarExpanded ? 0 : 8,
            position: "relative",
            pointerEvents: isToolbarExpanded ? "none" : "auto",
            opacity: isToolbarExpanded ? 0 : 1,
            transform: isToolbarExpanded ? "translateY(18px)" : "translateY(0)",
            transition:
              "opacity 180ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1), padding 260ms cubic-bezier(0.22, 1, 0.36, 1), gap 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              zIndex: 2,
            }}
          >
            <Group gap={4}>
              {hasIconInfo ? (
                <Popover width={360} position="bottom-end" withArrow shadow="md">
                  <Popover.Target>
                    <Tooltip label="Icon details">
                      <ActionIcon
                        size="xl"
                        variant="subtle"
                        color="gray"
                        aria-label="Open icon info"
                      >
                        <IconInfoCircle size={22} />
                      </ActionIcon>
                    </Tooltip>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Stack gap={6}>
                      {selectedIconExternalUrl && selectedIconName ? (
                        <Anchor
                          href={selectedIconExternalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          fw={700}
                          size="sm"
                        >
                          {selectedIconName}
                        </Anchor>
                      ) : (
                        <Text fw={700} size="sm">
                          {selectedIconName ?? "Unknown icon"}
                        </Text>
                      )}
                      <Text size="sm">
                        <strong>Authored by</strong>{" "}
                        {selectedIconAuthor ?? "Unknown author"}
                      </Text>
                      {selectedIconTags.length > 0 ? (
                        <Group gap={6} wrap="wrap">
                          {selectedIconTags.map((tag, index) => (
                            <Badge key={`${tag}-${index}`} variant="light">
                              {tag}
                            </Badge>
                          ))}
                        </Group>
                      ) : null}
                      <Text size="sm" style={{ fontStyle: "italic" }}>
                        {selectedIconDescription ?? "No description available."}
                      </Text>
                    </Stack>
                  </Popover.Dropdown>
                </Popover>
              ) : null}
              {hasSelectedIcon ? (
                <Tooltip label="Save as preset">
                  <ActionIcon
                    size="xl"
                    variant="subtle"
                    color="teal"
                    aria-label="Save colors as preset"
                    onClick={() => {
                      setPresetSaveError(null);
                      setPresetNameDraft(
                        selectedIconName ? `${selectedIconName} colors` : "New preset",
                      );
                      setIsSavePresetModalOpen(true);
                    }}
                  >
                    <IconPalette size={22} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              {hasSelectedIcon ? (
                <Tooltip label="Export icon">
                  <ActionIcon
                    size="xl"
                    variant="subtle"
                    color="blue"
                    aria-label="Open export options"
                    onClick={() => {
                      setExportError(null);
                      setIsExportModalOpen(true);
                    }}
                  >
                    <IconFileExport size={22} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
            </Group>
          </div>
          <div
            style={{
              width: "min(100%, clamp(260px, calc(100dvh - 320px), 700px))",
              maxWidth: "100%",
              minWidth: 300,
            }}
          >
            <div
              className="ps-preview-canvas"
              style={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                aspectRatio: "1 / 1",
              }}
            >
              <ThreePreview
                svg={compositeSvg}
                transform={previewTransform}
                readOnly={!pathsInteractive}
                onClickPath={pathsInteractive ? onSelectForegroundPath : undefined}
                animationClip={animationClip}
                pathAnimationClips={pathAnimationClips}
              />
            </div>
          </div>
        </div>

        {showToolbar ? (
          <Paper
            withBorder
            radius="md"
            p={0}
            style={{
              boxShadow: "0 -10px 24px rgba(0, 0, 0, 0.38)",
              overflow: "hidden",
              minWidth: 0,
              height: isToolbarExpanded ? "100%" : "auto",
              display: "flex",
              flexDirection: "column",
              transition:
                "border-radius 260ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 260ms ease",
            }}
          >
            <Tabs
              value={activeTab}
              onChange={setActiveTab}
              style={{
                height: isToolbarExpanded ? "100%" : undefined,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Tabs.List
                style={{
                  alignItems: "center",
                  paddingInline: TOOLBAR_INSET,
                }}
              >
                <Tabs.Tab
                  value="history"
                  leftSection={<IconHistory size={14} stroke={1.8} />}
                >
                  History
                </Tabs.Tab>
                <Tabs.Tab
                  value="presets"
                  leftSection={<IconTemplate size={14} stroke={1.8} />}
                >
                  Presets
                </Tabs.Tab>
                <div style={{ marginInlineStart: "auto" }}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={
                      isHistoryExpanded ? "Collapse panel list" : "Expand panel list"
                    }
                    onClick={() => {
                      setIsHistoryExpanded((current) => !current);
                      setHistorySearchQuery("");
                      setPresetSearchQuery("");
                    }}
                  >
                    <IconChevronUp
                      size={14}
                      style={{
                        transform: isHistoryExpanded
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                        transition: "transform 150ms ease",
                      }}
                    />
                  </ActionIcon>
                </div>
              </Tabs.List>

              <Tabs.Panel
                value="history"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minHeight: isToolbarExpanded ? 0 : undefined,
                  flex: isToolbarExpanded ? 1 : undefined,
                  paddingTop: 8,
                  paddingInline: TOOLBAR_INSET,
                  paddingBottom: TOOLBAR_INSET,
                }}
              >
                <Stack
                  gap="xs"
                  style={{
                    minHeight: isToolbarExpanded ? 0 : undefined,
                    flex: isToolbarExpanded ? 1 : undefined,
                  }}
                >
                  {isHistoryExpanded ? (
                    <TextInput
                      placeholder="Search icon history"
                      value={historySearchQuery}
                      onChange={(event) => {
                        setHistorySearchQuery(event.currentTarget.value);
                      }}
                      leftSection={<IconSearch size={14} />}
                    />
                  ) : null}

                  {(isHistoryExpanded ? filteredHistoryItems : collapsedHistoryItems).length >
                  0 ? (
                    isHistoryExpanded ? (
                      <ScrollArea
                        type="hover"
                        scrollbars="y"
                        offsetScrollbars="present"
                        style={{
                          width: "100%",
                          maxWidth: "100%",
                          minHeight: 0,
                          flex: 1,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                            gap: 8,
                            paddingRight: 8,
                          }}
                        >
                          {filteredHistoryItems.map((item) => (
                            <IconPreviewTile
                              key={item.name}
                              className="ps-history-preview-tile"
                              onClick={() => onIconSelect(item.path, item.name)}
                              title={item.name}
                              media={
                                <div className="ps-icon-preview-content">
                                  <ThreePreview
                                    svg={item.compositeSvg}
                                    transform={historyPreviewTransform}
                                    readOnly
                                  />
                                </div>
                              }
                            />
                          ))}
                        </div>
                      </ScrollArea>
                    ) : (
                      <ScrollArea
                        type="hover"
                        scrollbars="x"
                        style={{ width: "100%", maxWidth: "100%" }}
                        viewportProps={{
                          style: {
                            overflowY: "hidden",
                            touchAction: "pan-x",
                          },
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "nowrap",
                            gap: 6,
                            width: "max-content",
                            minWidth: "max-content",
                            scrollSnapType: "x proximity",
                          }}
                        >
                          {collapsedHistoryItems.map((item) => (
                            <IconPreviewTile
                              key={item.name}
                              className="ps-history-preview-tile"
                              onClick={() => onIconSelect(item.path, item.name)}
                              title={item.name}
                              style={{
                                width: 80,
                                flex: "0 0 auto",
                                scrollSnapAlign: "start",
                              }}
                              media={
                                <div className="ps-icon-preview-content">
                                  <ThreePreview
                                    svg={item.compositeSvg}
                                    transform={historyPreviewTransform}
                                    readOnly
                                  />
                                </div>
                              }
                            />
                          ))}
                        </div>
                      </ScrollArea>
                    )
                  ) : (
                    <Text size="sm" c="dimmed">
                      {historySearchQuery.trim()
                        ? "No icons match this search"
                        : "No edited icons in history"}
                    </Text>
                  )}
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel
                value="presets"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minHeight: isHistoryExpanded ? 0 : undefined,
                  flex: isToolbarExpanded ? 1 : undefined,
                  paddingTop: 8,
                  paddingInline: TOOLBAR_INSET,
                  paddingBottom: TOOLBAR_INSET,
                }}
              >
                <Stack
                  gap="xs"
                  style={{
                    minHeight: isHistoryExpanded ? 0 : undefined,
                    flex: isToolbarExpanded ? 1 : undefined,
                  }}
                >
                  {isHistoryExpanded ? (
                    <TextInput
                      placeholder="Search presets"
                      value={presetSearchQuery}
                      onChange={(event) => {
                        setPresetSearchQuery(event.currentTarget.value);
                      }}
                      leftSection={<IconSearch size={14} />}
                    />
                  ) : null}

                  {(isHistoryExpanded ? filteredPresets : collapsedPresets).length > 0 ? (
                    isHistoryExpanded ? (
                      <ScrollArea
                        type="hover"
                        scrollbars="y"
                        offsetScrollbars="present"
                        style={{
                          width: "100%",
                          maxWidth: "100%",
                          minHeight: 0,
                          flex: 1,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                            gap: 8,
                            paddingRight: 8,
                          }}
                        >
                          {filteredPresets.map((preset) => (
                            <IconPreviewTile
                              key={preset.id}
                              className="ps-history-preview-tile"
                              onClick={() => handlePresetSelection(preset)}
                              title={preset.name}
                              media={renderPresetMedia(preset)}
                            />
                          ))}
                        </div>
                      </ScrollArea>
                    ) : (
                      <ScrollArea
                        type="hover"
                        scrollbars="x"
                        style={{ width: "100%", maxWidth: "100%" }}
                        viewportProps={{
                          style: {
                            overflowY: "hidden",
                            touchAction: "pan-x",
                          },
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "nowrap",
                            gap: 6,
                            width: "max-content",
                            minWidth: "max-content",
                            scrollSnapType: "x proximity",
                          }}
                        >
                          {collapsedPresets.map((preset) => (
                            <IconPreviewTile
                              key={preset.id}
                              className="ps-history-preview-tile"
                              onClick={() => handlePresetSelection(preset)}
                              title={preset.name}
                              style={{
                                width: 80,
                                flex: "0 0 auto",
                                scrollSnapAlign: "start",
                              }}
                              media={renderPresetMedia(preset)}
                            />
                          ))}
                        </div>
                      </ScrollArea>
                    )
                  ) : (
                    <Text size="sm" c="dimmed">
                      {presetSearchQuery.trim()
                        ? "No presets match this search"
                        : "No saved presets yet"}
                    </Text>
                  )}
                </Stack>
              </Tabs.Panel>
            </Tabs>
          </Paper>
        ) : null}
      </div>

      <Modal
        opened={isSavePresetModalOpen && hasSelectedIcon}
        onClose={() => {
          setPresetSaveError(null);
          setIsSavePresetModalOpen(false);
        }}
        title="New preset"
        centered
        withCloseButton={false}
        closeOnEscape={false}
        closeOnClickOutside={false}
      >
        <Stack gap="sm">
          <TextInput
            label="Preset name"
            value={presetNameDraft}
            onChange={(event) => {
              setPresetNameDraft(event.currentTarget.value);
            }}
            placeholder="My preset"
            autoFocus
          />
          {presetSaveError ? (
            <Alert color="red" title="Could not save preset" icon={<IconAlertTriangle size={16} />}>
              {presetSaveError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setPresetSaveError(null);
                setIsSavePresetModalOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSavePreset}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={pendingPresetToApply !== null}
        onClose={() => {
          setPendingPresetToApply(null);
        }}
        title="Apply preset colors?"
        centered
        withCloseButton={false}
        closeOnEscape={false}
        closeOnClickOutside={false}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            This icon already has custom styles. Applying a preset will override fill,
            stroke, and shadow settings for background and foreground.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setPendingPresetToApply(null);
              }}
            >
              Cancel
            </Button>
            <Button
              color="blue"
              onClick={() => {
                if (pendingPresetToApply) {
                  applyPreset(pendingPresetToApply);
                }
                setPendingPresetToApply(null);
              }}
            >
              Apply
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={isExportModalOpen && hasSelectedIcon}
        onClose={() => {
          if (!isExporting) {
            setIsExportModalOpen(false);
          }
        }}
        title="Export icon"
        centered
        styles={{
          body: {
            overflowX: "hidden",
          },
        }}
      >
        <Stack gap="sm" style={{ overflowX: "hidden" }}>
          <TextInput
            label="File name"
            value={exportDraft.fileName}
            onChange={(event) => {
              setExportDraft((previous) => ({
                ...previous,
                fileName: event.currentTarget.value,
              }));
            }}
            disabled={isExporting}
          />

          <Select
            label="Format"
            data={availableExportFormatOptions}
            value={exportDraft.format}
            onChange={(value) => {
              if (!value) {
                return;
              }

              setExportDraft((previous) => ({
                ...previous,
                format: value as ExportFormat,
              }));
            }}
            allowDeselect={false}
            disabled={isExporting}
          />

          <Select
            label="Size"
            data={EXPORT_SIZE_PRESETS.map((preset) => ({
              value: preset.toString(),
              label: `${preset} x ${preset}`,
            }))}
            value={exportDraft.size.toString()}
            onChange={(value) => {
              if (!value) {
                return;
              }

              const parsedValue = Number.parseInt(value, 10);
              if (!Number.isFinite(parsedValue)) {
                return;
              }

              setExportDraft((previous) => ({
                ...previous,
                size: parsedValue,
              }));
            }}
            allowDeselect={false}
            disabled={isExporting}
          />

          {exportDraft.format === "webp" ? (
            <Stack gap={6} mb={8}>
              <Text size="sm">Quality</Text>
              <Slider
                min={25}
                max={100}
                step={25}
                value={Math.round(exportDraft.quality * 100)}
                onChange={(value) => {
                  setExportDraft((previous) => ({
                    ...previous,
                    quality: value / 100,
                  }));
                }}
                disabled={isExporting}
              />
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  25%
                </Text>
                <Text size="xs" c="dimmed">
                  50%
                </Text>
                <Text size="xs" c="dimmed">
                  75%
                </Text>
                <Text size="xs" c="dimmed">
                  100%
                </Text>
              </Group>
            </Stack>
          ) : null}

          {hasAnimations && isAnimatedExportFormat(exportDraft.format) ? (
            <Stack gap={6}>
              <Text size="sm">Animation FPS</Text>
              <Slider
                min={0}
                max={FPS_PRESET_VALUES.length - 1}
                step={1}
                marks={FPS_PRESET_VALUES.map((value, index) => ({
                  value: index,
                  label: value.toString(),
                }))}
                label={(value) => {
                  const normalized = Math.max(
                    0,
                    Math.min(FPS_PRESET_VALUES.length - 1, Math.round(value)),
                  );
                  return FPS_PRESET_VALUES[normalized].toString();
                }}
                value={fpsPresetIndex}
                onChange={(value) => {
                  const normalized = Math.max(
                    0,
                    Math.min(FPS_PRESET_VALUES.length - 1, Math.round(value)),
                  );
                  setExportDraft((previous) => ({
                    ...previous,
                    fps: FPS_PRESET_VALUES[normalized],
                  }));
                }}
                disabled={isExporting}
              />
            </Stack>
          ) : null}

          {exportWarning ? (
            <Alert
              color="yellow"
              variant="light"
              icon={<IconAlertTriangle size={16} />}
            >
              {exportWarning}
            </Alert>
          ) : null}

          {exportError ? (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              {exportError}
            </Alert>
          ) : null}

          <Group justify="space-between" mt="xs" wrap="nowrap">
            <Text size="sm" c="dimmed">
              {sizePreviewLabel}
            </Text>
            <Button
              leftSection={
                isExporting ? <Loader size={16} color="white" /> : <IconDownload size={16} />
              }
              onClick={() => {
                void handleExport();
              }}
              disabled={isExporting}
            >
              {isExporting ? `${exportProgress}%` : "Export"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
