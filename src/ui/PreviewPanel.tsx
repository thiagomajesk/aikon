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
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconDownload,
  IconFileExport,
  IconHistory,
  IconInfoCircle,
  IconTemplate,
} from "@tabler/icons-react";
import {
  ICON_HISTORY_UPDATED_EVENT,
  loadIconHistory,
  defaultAnimation,
  defaultBaseLayer,
  defaultEffects,
  defaultOverlayLayer,
} from "../core/editor";
import type {
  AnimationClipState,
  CustomIcon,
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
const EXPORT_SIZE_PRESETS = [
  { value: 256, label: "256 x 256 (small)" },
  { value: 384, label: "384 x 384 (medium)" },
  { value: 512, label: "512 x 512 (original)" },
] as const;

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
}) => {
  const [activeTab, setActiveTab] = useState<string | null>("history");
  const [iconSvgs, setIconSvgs] = useState<Record<string, string>>({});
  const [historyRevision, setHistoryRevision] = useState(0);
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

  const historyIconRefs = useMemo(() => {
    const history = loadIconHistory();
    return Object.keys(history).flatMap<HistoryIconRef>((name) => {
      const icon = iconCatalog.find((item) => item.name === name);
      const customIcon = customIcons.find((item) => item.name === name);
      if (!icon && !customIcon) {
        return [];
      }

      return [
        {
          name,
          path: customIcon?.path ?? icon!.path,
          svg: customIcon?.svg,
          isCustom: !!customIcon,
        },
      ];
    });
  }, [iconCatalog, customIcons, historyRevision]);

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
    const history = loadIconHistory();
    const parsedCache = new Map<string, ParsedSvg>();
    const breakoutCache = new Map<string, ParsedSvgBreakout>();

    return historyIconRefs.flatMap<HistoryItem>((item) => {
      const svg = item.isCustom ? item.svg : iconSvgs[item.name];
      const settings = history[item.name];
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
      );

      return [
        {
          name: item.name,
          path: item.path,
          compositeSvg: compositeHistorySvg,
        },
      ];
    });
  }, [historyIconRefs, iconSvgs]);

  const hasIconInfo = Boolean(
    selectedIconName ||
      selectedIconAuthor ||
      selectedIconDescription ||
      selectedIconExternalUrl ||
      selectedIconTags.length > 0,
  );
  const hasSelectedIcon = Boolean(selectedIconName);

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

  return (
    <>
      <div
        style={{
          height: "100%",
          minHeight: 0,
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr) auto",
        }}
      >
        <div
          style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            padding: "8px 0 12px",
            gap: 8,
            position: "relative",
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
                    <ActionIcon
                      size="xl"
                      variant="subtle"
                      color="gray"
                      aria-label="Open icon info"
                    >
                      <IconInfoCircle size={22} />
                    </ActionIcon>
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
            p="xs"
            style={{
              boxShadow: "0 -10px 24px rgba(0, 0, 0, 0.38)",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            <Tabs value={activeTab} onChange={setActiveTab}>
              <Tabs.List>
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
              </Tabs.List>

              <Tabs.Panel value="history" pt="xs">
                {historyItems.length > 0 ? (
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
                      {historyItems.map((item) => (
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
                ) : (
                  <Text size="sm" c="dimmed">
                    No recent icons
                  </Text>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="presets" pt="sm">
                <Text size="sm" c="dimmed">
                  Presets coming soon...
                </Text>
              </Tabs.Panel>
            </Tabs>
          </Paper>
        ) : null}
      </div>

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
              value: preset.value.toString(),
              label: preset.label,
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
