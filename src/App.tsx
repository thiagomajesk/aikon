import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, Center, SegmentedControl } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAdjustmentsHorizontal, IconEye } from "@tabler/icons-react";
import { IconLibrarySidebar } from "./ui/IconLibrarySidebar";
import { PreviewPanel } from "./ui/PreviewPanel";
import {
  defaultAnimation,
  defaultAnimationClip,
  defaultEffects,
  defaultForeground,
  normalizeAnimationClipState,
  loadIconSettings,
  useEditorStore,
} from "./core/editor";
import type {
  AnimationClipConfig,
  AnimationClipState,
  AnimationPathSettings,
  ForegroundPathSettings,
  ForegroundStyleState,
  ParsedSvg,
} from "./core/editor";
import {
  buildCompositeSvg,
  buildPreviewTransform,
  parseSvgBreakout,
  buildForegroundComposite,
} from "./core/svg-compositor";
import type { IconLockEntry } from "./core/icon-catalog";
import { useIconAssignment } from "./hooks/useIconAssignment";
import { useIconCatalog } from "./hooks/useIconCatalog";

type MobilePanel = "settings" | "preview";

const COMPACT_LAYOUT_MAX_WIDTH = 1280;
const MOBILE_LAYOUT_MAX_WIDTH = 960;
const APP_SHELL_WORKSPACE_BG = "var(--mantine-color-dark-9)";

interface ForegroundPathOption {
  id: string;
  label: string;
}

interface ForegroundPathEditorState {
  enabled: boolean;
  options: ForegroundPathOption[];
  selectedPathId: string | null;
  pathStyles: Record<string, ForegroundStyleState>;
}

interface AnimationPathEditorState {
  enabled: boolean;
  pathClips: Record<string, AnimationClipState>;
}

interface AppProps {
  forcedIcon?: { path: string; name: string } | null;
  iconCatalog?: IconLockEntry[];
  onIconNavigate?: (iconPath: string, iconName: string) => void;
  onExitEditor?: () => void;
  onOpenGallery?: () => void;
}

export default function App({
  forcedIcon = null,
  iconCatalog = [],
  onIconNavigate,
  onExitEditor,
  onOpenGallery,
}: AppProps) {
  const searchInput = useEditorStore((state) => state.searchInput);
  const setSearchInput = useEditorStore((state) => state.setSearchInput);
  const searchQuery = useEditorStore((state) => state.searchQuery);
  const setSearchQuery = useEditorStore((state) => state.setSearchQuery);

  const iconPage = useEditorStore((state) => state.iconPage);
  const setIconPage = useEditorStore((state) => state.setIconPage);
  const iconTotal = useEditorStore((state) => state.iconTotal);
  const setIconTotal = useEditorStore((state) => state.setIconTotal);

  const page = useEditorStore((state) => state.page);
  const setPage = useEditorStore((state) => state.setPage);
  const setStats = useEditorStore((state) => state.setStats);

  const base = useEditorStore((state) => state.base);
  const setBase = useEditorStore((state) => state.setBase);
  const overlay = useEditorStore((state) => state.overlay);
  const setOverlay = useEditorStore((state) => state.setOverlay);

  const background = useEditorStore((state) => state.background);
  const setBackground = useEditorStore((state) => state.setBackground);
  const foreground = useEditorStore((state) => state.foreground);
  const setForeground = useEditorStore((state) => state.setForeground);
  const animationClip = useEditorStore((state) => state.animationClip);
  const setAnimationClip = useEditorStore((state) => state.setAnimationClip);

  const setStatus = useEditorStore((state) => state.setStatus);
  const customIcons = useEditorStore((state) => state.customIcons);

  const selectedIconPath = useEditorStore((state) => state.selectedIconPath);
  const selectedIconName = useEditorStore((state) => state.selectedIconName);
  const setSelectedIconPath = useEditorStore((state) => state.setSelectedIconPath);
  const saveCurrentIconSettings = useEditorStore(
    (state) => state.saveCurrentIconSettings,
  );

  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("preview");
  const [foregroundPathEditors, setForegroundPathEditors] = useState<
    Record<string, ForegroundPathEditorState>
  >({});
  const [animationPathEditors, setAnimationPathEditors] = useState<
    Record<string, AnimationPathEditorState>
  >({});
  const [pathBlink, setPathBlink] = useState<{
    iconPath: string | null;
    pathId: string | null;
    token: number;
  }>({
    iconPath: null,
    pathId: null,
    token: 0,
  });

  const parsedSvgCacheRef = useRef<Map<string, ParsedSvg>>(new Map());
  const breakoutCacheRef = useRef<Map<string, ReturnType<typeof parseSvgBreakout>>>(
    new Map(),
  );
  const previousIconNameRef = useRef<string | null>(null);
  const lastForcedIconPathRef = useRef<string | null>(null);

  const setStatusMessage = useCallback(
    (message: string, error = false) => {
      setStatus({ message, error });
    },
    [setStatus],
  );

  useEffect(() => {
    if (!pathBlink.pathId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPathBlink((previous) => {
        if (previous.token !== pathBlink.token) {
          return previous;
        }
        return {
          ...previous,
          pathId: null,
        };
      });
    }, 800);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pathBlink]);

  const currentPathEditor = useMemo<ForegroundPathEditorState | null>(() => {
    if (!selectedIconPath) {
      return null;
    }

    return foregroundPathEditors[selectedIconPath] ?? null;
  }, [foregroundPathEditors, selectedIconPath]);

  const currentAnimationPathEditor = useMemo<AnimationPathEditorState | null>(() => {
    if (!selectedIconPath) {
      return null;
    }

    return animationPathEditors[selectedIconPath] ?? null;
  }, [animationPathEditors, selectedIconPath]);

  const availableForegroundPathOptions = useMemo<ForegroundPathOption[]>(() => {
    if (currentPathEditor?.options) {
      return currentPathEditor.options;
    }

    if (!selectedIconPath || base.path !== selectedIconPath || !base.svg) {
      return [];
    }

    const breakout = parseSvgBreakout(
      base.svg,
      breakoutCacheRef.current,
      parsedSvgCacheRef.current,
    );

    return breakout.paths.map((path) => ({
      id: path.id,
      label: path.label,
    }));
  }, [base.path, base.svg, currentPathEditor?.options, selectedIconPath]);

  useEffect(() => {
    setAnimationClip((previous) => {
      if (!previous.targetPathId) {
        return previous;
      }

      const hasTargetPath = Boolean(
        currentPathEditor?.options.some((option) => option.id === previous.targetPathId),
      );

      if (hasTargetPath) {
        return previous;
      }

      return {
        ...previous,
        targetPathId: null,
      };
    });
  }, [currentPathEditor?.options, setAnimationClip]);

  useEffect(() => {
    if (!selectedIconPath || !currentPathEditor?.enabled) {
      return;
    }

    const validPathIds = new Set(currentPathEditor.options.map((option) => option.id));
    setAnimationPathEditors((previous) => {
      const current = previous[selectedIconPath];
      if (!current?.enabled) {
        return previous;
      }

      let hasChanges = false;
      const nextPathClips: Record<string, AnimationClipState> = {};
      for (const [pathId, clip] of Object.entries(current.pathClips)) {
        if (!validPathIds.has(pathId)) {
          hasChanges = true;
          continue;
        }

        const normalized = normalizeAnimationClipState({
          ...clip,
          targetPathId: pathId,
        });
        if (normalized.preset === "none") {
          hasChanges = true;
          continue;
        }

        nextPathClips[pathId] = normalized;
      }

      if (!hasChanges) {
        return previous;
      }

      return {
        ...previous,
        [selectedIconPath]: {
          enabled: true,
          pathClips: nextPathClips,
        },
      };
    });
  }, [
    currentPathEditor?.enabled,
    currentPathEditor?.options,
    selectedIconPath,
  ]);

  const activePathStyle = useMemo<ForegroundStyleState | null>(() => {
    if (!currentPathEditor?.enabled || !currentPathEditor.selectedPathId) {
      return null;
    }

    return (
      currentPathEditor.pathStyles[currentPathEditor.selectedPathId] ??
      foreground
    );
  }, [currentPathEditor, foreground]);

  const currentForegroundPathSettings = useMemo<ForegroundPathSettings | null>(() => {
    if (!currentPathEditor?.enabled) {
      return null;
    }

    return {
      enabled: true,
      selectedPathId: currentPathEditor.selectedPathId,
      pathStyles: currentPathEditor.pathStyles,
    };
  }, [
    currentPathEditor?.enabled,
    currentPathEditor?.pathStyles,
    currentPathEditor?.selectedPathId,
  ]);

  const currentAnimationPathSettings = useMemo<AnimationPathSettings | null>(() => {
    if (!currentAnimationPathEditor?.enabled) {
      return null;
    }

    const pathClips: Record<string, AnimationClipConfig> = {};
    for (const [pathId, clip] of Object.entries(currentAnimationPathEditor.pathClips)) {
      const normalized = normalizeAnimationClipState({
        ...clip,
        targetPathId: pathId,
      });
      if (normalized.preset === "none") {
        continue;
      }

      const { targetPathId: _ignoredTargetPathId, ...config } = normalized;
      pathClips[pathId] = config;
    }

    return {
      enabled: true,
      pathClips,
    };
  }, [currentAnimationPathEditor?.enabled, currentAnimationPathEditor?.pathClips]);

  const displayAnimationClip = useMemo<AnimationClipState>(() => {
    const normalizedGlobal = normalizeAnimationClipState(animationClip);
    const selectedTargetPathId =
      currentPathEditor?.enabled && normalizedGlobal.targetPathId
        ? normalizedGlobal.targetPathId
        : null;
    if (!selectedTargetPathId) {
      return normalizeAnimationClipState({
        ...normalizedGlobal,
        targetPathId: null,
      });
    }

    const selectedPathClip =
      currentAnimationPathEditor?.pathClips[selectedTargetPathId] ?? null;
    if (!selectedPathClip) {
      return normalizeAnimationClipState({
        ...normalizedGlobal,
        targetPathId: selectedTargetPathId,
      });
    }

    return normalizeAnimationClipState({
      ...selectedPathClip,
      targetPathId: selectedTargetPathId,
    });
  }, [
    animationClip,
    currentAnimationPathEditor?.pathClips,
    currentPathEditor?.enabled,
  ]);

  useEffect(() => {
    if (selectedIconName !== previousIconNameRef.current) {
      previousIconNameRef.current = selectedIconName;
      return;
    }

    if (selectedIconName) {
      saveCurrentIconSettings(currentForegroundPathSettings, currentAnimationPathSettings);
    }
  }, [
    animationClip,
    background,
    currentAnimationPathSettings,
    currentForegroundPathSettings,
    foreground,
    saveCurrentIconSettings,
    selectedIconName,
  ]);

  const { allVisibleIcons, maxPage } = useIconCatalog({
    customIcons,
    iconPage,
    iconTotal,
    page,
    searchInput,
    searchQuery,
    setIconPage,
    setIconTotal,
    setPage,
    setSearchQuery,
    setStats,
    onError: (message) => {
      setStatusMessage(message, true);
    },
  });

  const { assignIcon, handleAssign } = useIconAssignment({
    base,
    customIcons,
    overlay,
    setBase,
    setOverlay,
    setStatusMessage,
  });

  const iconCatalogByPath = useMemo(() => {
    return new Map(iconCatalog.map((icon) => [icon.path, icon]));
  }, [iconCatalog]);

  const selectedIconMetadata = useMemo(() => {
    if (!selectedIconPath) {
      return null;
    }

    const customIcon = customIcons.find((icon) => icon.path === selectedIconPath);
    if (customIcon) {
      return {
        name: customIcon.name,
        author: customIcon.author,
        description: null as string | null,
        tags: [] as string[],
        externalUrl: null as string | null,
      };
    }

    const iconEntry = iconCatalogByPath.get(selectedIconPath);
    if (iconEntry) {
      return {
        name: iconEntry.name,
        author: iconEntry.author,
        description: iconEntry.description,
        tags: iconEntry.tags,
        externalUrl: iconEntry.externalUrl,
      };
    }

    const visibleIcon = allVisibleIcons.find((icon) => icon.path === selectedIconPath);
    if (!visibleIcon) {
      return null;
    }

    return {
      name: visibleIcon.name,
      author: visibleIcon.author,
      description: null as string | null,
      tags: [] as string[],
      externalUrl: null as string | null,
    };
  }, [allVisibleIcons, customIcons, iconCatalogByPath, selectedIconPath]);

  useEffect(() => {
    if (!forcedIcon) {
      return;
    }

    if (lastForcedIconPathRef.current === forcedIcon.path) {
      return;
    }

    lastForcedIconPathRef.current = forcedIcon.path;
    setSelectedIconPath(forcedIcon.path, forcedIcon.name);
    void assignIcon(forcedIcon.path).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatusMessage(`Could not assign icon: ${message}`, true);
    });
  }, [assignIcon, forcedIcon, setSelectedIconPath, setStatusMessage]);

  useEffect(() => {
    if (
      !selectedIconPath ||
      !selectedIconName ||
      !base.svg ||
      base.path !== selectedIconPath
    ) {
      return;
    }

    const saved = loadIconSettings(selectedIconName);
    const savedForegroundPaths = saved?.foregroundPaths;
    const savedAnimationPaths = saved?.animationPaths;
    const shouldRestorePathEditors = Boolean(
      savedForegroundPaths?.enabled || savedAnimationPaths?.enabled,
    );
    if (!shouldRestorePathEditors) {
      return;
    }

    const breakout = parseSvgBreakout(
      base.svg,
      breakoutCacheRef.current,
      parsedSvgCacheRef.current,
    );
    if (breakout.paths.length === 0) {
      return;
    }

    const options = breakout.paths.map((path) => ({
      id: path.id,
      label: path.label,
    }));
    const optionIds = new Set(options.map((option) => option.id));

    const pathStyles: Record<string, ForegroundStyleState> = {};
    for (const [pathId, style] of Object.entries(savedForegroundPaths?.pathStyles ?? {})) {
      if (optionIds.has(pathId)) {
        pathStyles[pathId] = style;
      }
    }

    const savedSelectedPathId = savedForegroundPaths?.selectedPathId ?? null;
    const selectedPathId =
      savedSelectedPathId && optionIds.has(savedSelectedPathId)
        ? savedSelectedPathId
        : options[0]?.id ?? null;

    setForegroundPathEditors((previous) => ({
      ...previous,
      [selectedIconPath]: {
        enabled: true,
        options,
        selectedPathId,
        pathStyles,
      },
    }));

    const pathClips: Record<string, AnimationClipState> = {};
    for (const [pathId, clip] of Object.entries(savedAnimationPaths?.pathClips ?? {})) {
      if (!optionIds.has(pathId)) {
        continue;
      }

      const normalized = normalizeAnimationClipState({
        ...(clip as Partial<AnimationClipState>),
        targetPathId: pathId,
      });
      if (normalized.preset === "none") {
        continue;
      }

      pathClips[pathId] = normalized;
    }

    setAnimationPathEditors((previous) => ({
      ...previous,
      [selectedIconPath]: {
        enabled: true,
        pathClips,
      },
    }));
  }, [base.path, base.svg, selectedIconName, selectedIconPath]);

  const displayForeground = activePathStyle ?? foreground;

  const activePathAnimationClips = useMemo<Record<string, AnimationClipState>>(() => {
    if (!selectedIconPath || !currentPathEditor?.enabled) {
      return {};
    }

    const validPathIds = new Set(currentPathEditor.options.map((option) => option.id));
    const pathClips = currentAnimationPathEditor?.pathClips ?? {};
    return Object.fromEntries(
      Object.entries(pathClips).flatMap(([pathId, clip]) => {
        if (!validPathIds.has(pathId)) {
          return [];
        }

        const normalized = normalizeAnimationClipState({
          ...clip,
          targetPathId: pathId,
        });
        if (normalized.preset === "none") {
          return [];
        }

        return [[pathId, normalized]];
      }),
    );
  }, [
    currentAnimationPathEditor?.pathClips,
    currentPathEditor?.enabled,
    currentPathEditor?.options,
    selectedIconPath,
  ]);

  const foregroundForComposite = useMemo<ForegroundStyleState | null>(() => {
    if (!currentPathEditor?.enabled) {
      return foreground;
    }

    // Per-path styling is already baked into `baseForComposite`, so skip
    // the global foreground pass entirely to avoid overriding fills.
    return null;
  }, [currentPathEditor?.enabled, foreground]);

  const baseForComposite = useMemo(() => {
    if (
      !selectedIconPath ||
      !base.svg ||
      base.path !== selectedIconPath ||
      !currentPathEditor?.enabled
    ) {
      return base;
    }

    const styledForeground = buildForegroundComposite({
      svg: base.svg,
      foreground,
      pathConfig: {
        enabled: true,
        pathStyles: currentPathEditor.pathStyles,
      },
      blink:
        pathBlink.iconPath === selectedIconPath
          ? { pathId: pathBlink.pathId, token: pathBlink.token }
          : null,
      parsedSvgCache: parsedSvgCacheRef.current,
      breakoutCache: breakoutCacheRef.current,
    });

    return {
      ...base,
      svg: styledForeground.svg,
    };
  }, [
    base,
    currentPathEditor?.enabled,
    currentPathEditor?.pathStyles,
    foreground,
    pathBlink.iconPath,
    pathBlink.pathId,
    pathBlink.token,
    selectedIconPath,
  ]);

  const compositeSvg = useMemo(() => {
    const hasSelection = Boolean(base.path || overlay.path);
    const effectiveBackground = hasSelection
      ? background
      : { ...background, type: "none" as const };
    const effectiveForeground = hasSelection
      ? foregroundForComposite
      : null;
    const effectiveForegroundSurface = hasSelection ? foreground : null;

    return buildCompositeSvg(
      baseForComposite,
      overlay,
      defaultEffects,
      defaultAnimation,
      effectiveBackground,
      effectiveForeground,
      parsedSvgCacheRef.current,
      null,
      {
        surfaceForeground: effectiveForegroundSurface,
      },
    );
  }, [
    background,
    base.path,
    baseForComposite,
    foreground,
    foregroundForComposite,
    overlay,
  ]);

  const previewTransform = useMemo(() => {
    return buildPreviewTransform(defaultAnimation, 1);
  }, []);

  const breakApartForegroundPaths = useCallback(() => {
    if (!selectedIconPath || !base.svg || base.path !== selectedIconPath) {
      setStatusMessage("Select a foreground icon before breaking paths.", true);
      return;
    }

    const breakout = parseSvgBreakout(
      base.svg,
      breakoutCacheRef.current,
      parsedSvgCacheRef.current,
    );
    if (breakout.paths.length === 0) {
      setStatusMessage("No editable paths were found in this icon.", true);
      return;
    }

    setForegroundPathEditors((previous) => {
      const current = previous[selectedIconPath];
      const options = breakout.paths.map((path) => ({
        id: path.id,
        label: path.label,
      }));
      const optionIds = new Set(options.map((option) => option.id));
      const selectedPathId =
        current?.selectedPathId && optionIds.has(current.selectedPathId)
          ? current.selectedPathId
          : options[0]?.id ?? null;
      const pathStyles: Record<string, ForegroundStyleState> = {};
      for (const [pathId, style] of Object.entries(current?.pathStyles ?? {})) {
        if (optionIds.has(pathId)) {
          pathStyles[pathId] = style;
        }
      }

      return {
        ...previous,
        [selectedIconPath]: {
          enabled: true,
          options,
          selectedPathId,
          pathStyles,
        },
      };
    });

    setAnimationPathEditors((previous) => {
      const current = previous[selectedIconPath];
      const optionIds = new Set(breakout.paths.map((path) => path.id));
      const pathClips: Record<string, AnimationClipState> = {};

      for (const [pathId, clip] of Object.entries(current?.pathClips ?? {})) {
        if (!optionIds.has(pathId)) {
          continue;
        }

        const normalized = normalizeAnimationClipState({
          ...clip,
          targetPathId: pathId,
        });
        if (normalized.preset === "none") {
          continue;
        }

        pathClips[pathId] = normalized;
      }

      return {
        ...previous,
        [selectedIconPath]: {
          enabled: true,
          pathClips,
        },
      };
    });

    setStatusMessage("Foreground paths are now editable individually.");
  }, [base.path, base.svg, selectedIconPath, setStatusMessage]);

  const resetBreakApartForegroundPaths = useCallback(() => {
    if (!selectedIconPath) {
      return;
    }

    setForegroundPathEditors((previous) => {
      if (!previous[selectedIconPath]) {
        return previous;
      }

      const { [selectedIconPath]: _removed, ...rest } = previous;
      return rest;
    });

    setAnimationPathEditors((previous) => {
      if (!previous[selectedIconPath]) {
        return previous;
      }

      const { [selectedIconPath]: _removed, ...rest } = previous;
      return rest;
    });

    setPathBlink((previous) => {
      if (previous.iconPath !== selectedIconPath) {
        return previous;
      }

      return {
        iconPath: null,
        pathId: null,
        token: previous.token + 1,
      };
    });

    setAnimationClip((previous) => {
      if (!previous.targetPathId) {
        return previous;
      }

      return {
        ...previous,
        targetPathId: null,
      };
    });

    setStatusMessage("Per-path foreground editing has been reset.");
  }, [selectedIconPath, setAnimationClip, setStatusMessage]);

  const resetForegroundPart = useCallback(() => {
    if (
      !selectedIconPath ||
      !currentPathEditor?.enabled ||
      !currentPathEditor.selectedPathId
    ) {
      setForeground(defaultForeground);
      return;
    }

    const selectedPathId = currentPathEditor.selectedPathId;
    setForegroundPathEditors((previous) => {
      const current = previous[selectedIconPath];
      if (!current) {
        return previous;
      }

      return {
        ...previous,
        [selectedIconPath]: {
          ...current,
          pathStyles: {
            ...current.pathStyles,
            [selectedPathId]: defaultForeground,
          },
        },
      };
    });
  }, [
    currentPathEditor?.enabled,
    currentPathEditor?.selectedPathId,
    selectedIconPath,
    setForeground,
  ]);

  const resetForegroundAll = useCallback(() => {
    setForeground(defaultForeground);

    if (!selectedIconPath || !currentPathEditor?.enabled) {
      return;
    }

    setForegroundPathEditors((previous) => {
      const current = previous[selectedIconPath];
      if (!current || Object.keys(current.pathStyles).length === 0) {
        return previous;
      }

      return {
        ...previous,
        [selectedIconPath]: {
          ...current,
          pathStyles: {},
        },
      };
    });
  }, [currentPathEditor?.enabled, selectedIconPath, setForeground]);

  const setSelectedForegroundPathId = useCallback(
    (
      nextPathId: string,
      options: { blink?: boolean; forceBlink?: boolean } = {},
    ) => {
      const shouldBlink = options.blink ?? true;
      const forceBlink = options.forceBlink ?? false;

      if (!selectedIconPath) {
        return;
      }

      setForegroundPathEditors((previous) => {
        const current = previous[selectedIconPath];
        if (!current || !current.enabled) {
          return previous;
        }

        if (!current.options.some((option) => option.id === nextPathId)) {
          return previous;
        }

        if (current.selectedPathId === nextPathId) {
          return previous;
        }

        return {
          ...previous,
          [selectedIconPath]: {
            ...current,
            selectedPathId: nextPathId,
          },
        };
      });

      if (!shouldBlink) {
        return;
      }

      setPathBlink((previous) => {
        if (
          !forceBlink &&
          previous.iconPath === selectedIconPath &&
          previous.pathId === nextPathId
        ) {
          return previous;
        }

        return {
          iconPath: selectedIconPath,
          pathId: nextPathId,
          token: previous.token + 1,
        };
      });
    },
    [selectedIconPath],
  );

  const setAnimationTargetPathId = useCallback(
    (targetPathId: string | null, shouldBlink = true) => {
      setAnimationClip((previous) =>
        normalizeAnimationClipState({
          ...previous,
          targetPathId,
        }),
      );

      if (!targetPathId) {
        return;
      }

      setSelectedForegroundPathId(targetPathId, {
        blink: shouldBlink,
        forceBlink: true,
      });
    },
    [setAnimationClip, setSelectedForegroundPathId],
  );

  const cycleForegroundPath = useCallback(
    (direction: 1 | -1) => {
      if (!selectedIconPath) {
        return;
      }

      const current = foregroundPathEditors[selectedIconPath];
      if (!current?.enabled || current.options.length === 0) {
        return;
      }

      const currentIndex = current.options.findIndex(
        (option) => option.id === current.selectedPathId,
      );
      const nextIndex =
        currentIndex === -1
          ? 0
          : (currentIndex + direction + current.options.length) %
            current.options.length;
      setAnimationTargetPathId(current.options[nextIndex].id, true);
    },
    [foregroundPathEditors, selectedIconPath, setAnimationTargetPathId],
  );

  const handleForegroundChange = useCallback(
    (nextForeground: ForegroundStyleState) => {
      if (
        !selectedIconPath ||
        !currentPathEditor?.enabled ||
        !currentPathEditor.selectedPathId
      ) {
        setForeground(nextForeground);
        return;
      }

      setForegroundPathEditors((previous) => {
        const current = previous[selectedIconPath];
        if (!current || !current.selectedPathId) {
          return previous;
        }

        return {
          ...previous,
          [selectedIconPath]: {
            ...current,
            pathStyles: {
              ...current.pathStyles,
              [current.selectedPathId]: nextForeground,
            },
          },
        };
      });
    },
    [
      currentPathEditor?.enabled,
      currentPathEditor?.selectedPathId,
      selectedIconPath,
      setForeground,
    ],
  );

  const handleAnimationClipChange = useCallback(
    (patch: Partial<AnimationClipState>) => {
      const selectedTargetPathId =
        currentPathEditor?.enabled && animationClip.targetPathId
          ? animationClip.targetPathId
          : null;

      if (selectedIconPath && selectedTargetPathId) {
        setAnimationPathEditors((previous) => {
          const current = previous[selectedIconPath];
          const baseClip =
            current?.pathClips[selectedTargetPathId] ??
            normalizeAnimationClipState({
              ...animationClip,
              targetPathId: selectedTargetPathId,
            });
          const nextClip = normalizeAnimationClipState({
            ...baseClip,
            ...patch,
            targetPathId: selectedTargetPathId,
          });

          const nextPathClips = {
            ...(current?.pathClips ?? {}),
          };
          if (nextClip.preset === "none") {
            delete nextPathClips[selectedTargetPathId];
          } else {
            nextPathClips[selectedTargetPathId] = nextClip;
          }

          return {
            ...previous,
            [selectedIconPath]: {
              enabled: true,
              pathClips: nextPathClips,
            },
          };
        });
        return;
      }

      setAnimationClip((previous) => {
        return normalizeAnimationClipState({
          ...previous,
          ...patch,
          targetPathId: currentPathEditor?.enabled ? previous.targetPathId : null,
        });
      });
    },
    [
      animationClip,
      currentPathEditor?.enabled,
      selectedIconPath,
      setAnimationClip,
    ],
  );

  const resetAnimationPart = useCallback(() => {
    handleAnimationClipChange({
      ...defaultAnimationClip,
    });
  }, [handleAnimationClipChange]);

  const resetAnimationAll = useCallback(() => {
    setAnimationClip((previous) =>
      normalizeAnimationClipState({
        ...defaultAnimationClip,
        targetPathId: currentPathEditor?.enabled ? previous.targetPathId : null,
      }),
    );

    if (!selectedIconPath || !currentPathEditor?.enabled) {
      return;
    }

    setAnimationPathEditors((previous) => {
      const current = previous[selectedIconPath];
      if (!current || Object.keys(current.pathClips).length === 0) {
        return previous;
      }

      return {
        ...previous,
        [selectedIconPath]: {
          enabled: true,
          pathClips: {},
        },
      };
    });
  }, [currentPathEditor?.enabled, selectedIconPath, setAnimationClip]);

  const cycleAnimationTarget = useCallback(
    (direction: 1 | -1) => {
      if (!currentPathEditor?.enabled) {
        return;
      }

      const targetIds: Array<string | null> = [
        null,
        ...currentPathEditor.options.map((option) => option.id),
      ];
      if (targetIds.length === 0) {
        return;
      }

      const currentIndex = targetIds.findIndex(
        (pathId) => pathId === animationClip.targetPathId,
      );
      const safeCurrentIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        (safeCurrentIndex + direction + targetIds.length) % targetIds.length;
      const nextTargetPathId = targetIds[nextIndex];
      setAnimationTargetPathId(nextTargetPathId, true);
    },
    [
      animationClip.targetPathId,
      currentPathEditor?.enabled,
      currentPathEditor?.options,
      setAnimationTargetPathId,
    ],
  );

  const isCompactLayout = useMediaQuery(
    `(max-width: ${COMPACT_LAYOUT_MAX_WIDTH}px)`,
  ) ?? false;
  const isMobileLayout = useMediaQuery(
    `(max-width: ${MOBILE_LAYOUT_MAX_WIDTH}px)`,
  ) ?? false;
  const leftColumnWidth = isCompactLayout ? 300 : 340;

  const iconLibraryPanel = (
    <IconLibrarySidebar
      icons={allVisibleIcons}
      customIcons={customIcons}
      searchInput={searchInput}
      onSearchChange={setSearchInput}
      page={page}
      maxPage={maxPage}
      onPrev={() => setPage(Math.max(1, page - 1))}
      onNext={() => setPage(Math.min(maxPage, page + 1))}
      onAssign={(iconPath) => {
        const icon = allVisibleIcons.find((item) => item.path === iconPath);
        const iconName = icon?.name ?? null;
        setSelectedIconPath(iconPath, icon?.name || null);
        handleAssign(iconPath);
        if (iconName && onIconNavigate) {
          onIconNavigate(iconPath, iconName);
        }
      }}
      onOpenGallery={onOpenGallery}
      selectedIconPath={selectedIconPath}
      onDeselectIcon={() => {
        setSelectedIconPath(null);
        if (onExitEditor) {
          onExitEditor();
          return;
        }
      }}
      background={background}
      onBackgroundChange={setBackground}
      foreground={displayForeground}
      onForegroundChange={handleForegroundChange}
      canBreakApartPaths={Boolean(base.path === selectedIconPath && base.svg)}
      isPathsBrokenApart={Boolean(currentPathEditor?.enabled)}
      onBreakApartPaths={breakApartForegroundPaths}
      onCombinePaths={resetBreakApartForegroundPaths}
      onResetForegroundPart={resetForegroundPart}
      onResetForegroundAll={resetForegroundAll}
      foregroundPathOptions={availableForegroundPathOptions}
      selectedForegroundPathId={currentPathEditor?.selectedPathId ?? null}
      onCycleForegroundPath={cycleForegroundPath}
      onCycleAnimationTarget={cycleAnimationTarget}
      animationClip={displayAnimationClip}
      onAnimationClipChange={handleAnimationClipChange}
      onResetAnimationPart={resetAnimationPart}
      onResetAnimationAll={resetAnimationAll}
    />
  );

  const previewPanel = (
    <PreviewPanel
      compositeSvg={compositeSvg}
      previewTransform={previewTransform}
      showToolbar={true}
      iconCatalog={iconCatalog}
      customIcons={customIcons}
      onIconSelect={(iconPath, iconName) => {
        setSelectedIconPath(iconPath, iconName);
        handleAssign(iconPath);
        if (onIconNavigate) {
          onIconNavigate(iconPath, iconName);
        }
      }}
      pathsInteractive={Boolean(currentPathEditor?.enabled)}
      onSelectForegroundPath={(pathId) => {
        setAnimationTargetPathId(pathId, true);
      }}
      selectedIconName={selectedIconMetadata?.name ?? null}
      selectedIconAuthor={selectedIconMetadata?.author ?? null}
      selectedIconDescription={selectedIconMetadata?.description ?? null}
      selectedIconTags={selectedIconMetadata?.tags ?? []}
      selectedIconExternalUrl={selectedIconMetadata?.externalUrl ?? null}
      animationClip={animationClip}
      pathAnimationClips={activePathAnimationClips}
    />
  );

  if (isMobileLayout) {
    return (
      <AppShell padding="xs" style={{ height: "100dvh" }}>
        <AppShell.Main
          style={{
            height: "100%",
            minHeight: 0,
            backgroundColor: APP_SHELL_WORKSPACE_BG,
          }}
        >
          <div
            style={{
              height: "100%",
              minHeight: 0,
              display: "grid",
              gridTemplateRows: "auto minmax(0, 1fr)",
              gap: 8,
            }}
          >
            <SegmentedControl
              value={mobilePanel}
              onChange={(nextValue) => setMobilePanel(nextValue as MobilePanel)}
              fullWidth
              data={[
                {
                  value: "settings",
                  label: (
                    <Center style={{ gap: 6 }}>
                      <IconAdjustmentsHorizontal size={14} stroke={1.8} />
                      <span>Settings</span>
                    </Center>
                  ),
                },
                {
                  value: "preview",
                  label: (
                    <Center style={{ gap: 6 }}>
                      <IconEye size={14} stroke={1.8} />
                      <span>Preview</span>
                    </Center>
                  ),
                },
              ]}
            />
            <div style={{ minHeight: 0, overflow: "auto" }}>
              {mobilePanel === "settings" ? iconLibraryPanel : previewPanel}
            </div>
          </div>
        </AppShell.Main>
      </AppShell>
    );
  }

  return (
    <AppShell
      padding="md"
      style={{ height: "100dvh" }}
      navbar={{ width: leftColumnWidth, breakpoint: "sm" }}
    >
      <AppShell.Navbar p="md" style={{ minHeight: 0, overflow: "hidden" }}>
        {iconLibraryPanel}
      </AppShell.Navbar>
      <AppShell.Main
        style={{
          minHeight: 0,
          overflow: "hidden",
          height: "100%",
          backgroundColor: APP_SHELL_WORKSPACE_BG,
        }}
      >
        {previewPanel}
      </AppShell.Main>
    </AppShell>
  );
}
