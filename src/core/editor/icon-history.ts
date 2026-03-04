import type {
  AnimationClipConfig,
  AnimationClipState,
  BackgroundStyleState,
  ForegroundStyleState,
} from "./types";
import {
  isDefaultBackgroundStyle,
  isDefaultForegroundStyle,
} from "./style-state";
import {
  isDefaultAnimationClipState,
  normalizeAnimationClipState,
} from "./animation-clip";
import { ICON_HISTORY_STORE, openEditorDb } from "./storage-db";

const MAX_RECENT_ICON_ACCESSES = 100;
export const ICON_HISTORY_UPDATED_EVENT = "icon-history-updated";
export const ICON_ACCESSES_UPDATED_EVENT = "icon-accesses-updated";

export interface ForegroundPathSettings {
  enabled: boolean;
  selectedPathId: string | null;
  pathStyles: Record<string, ForegroundStyleState>;
}

export interface AnimationPathSettings {
  enabled: boolean;
  pathClips: Record<string, AnimationClipConfig>;
}

export interface IconSettings {
  background: BackgroundStyleState;
  foreground: ForegroundStyleState;
  foregroundPaths?: ForegroundPathSettings;
  animationClip: AnimationClipState;
  animationPaths?: AnimationPathSettings;
}

export type IconHistory = Record<string, IconSettings>;

interface StoredIconRecord {
  iconName: string;
  iconPath: string | null;
  updatedAt: number;
  settings: IconSettings | null;
}

export interface IconHistoryEntry {
  iconName: string;
  iconPath: string | null;
  updatedAt: number;
  settings: IconSettings;
}

const recordsCache = new Map<string, StoredIconRecord>();
let hydrationPromise: Promise<void> | null = null;
let hydrated = false;

function notifyHistoryUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(ICON_HISTORY_UPDATED_EVENT));
}

function notifyIconAccessesUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(ICON_ACCESSES_UPDATED_EVENT));
}

function normalizeForegroundPathSettings(
  foregroundPaths: ForegroundPathSettings | undefined,
): ForegroundPathSettings | undefined {
  if (!foregroundPaths) {
    return undefined;
  }

  const pathStyles = Object.fromEntries(
    Object.entries(foregroundPaths.pathStyles ?? {}).map(([pathId, style]) => [
      pathId,
      style,
    ]),
  );

  return {
    enabled: Boolean(foregroundPaths.enabled),
    selectedPathId: foregroundPaths.selectedPathId ?? null,
    pathStyles,
  };
}

function normalizeAnimationPathSettings(
  animationPaths: AnimationPathSettings | undefined,
): AnimationPathSettings | undefined {
  if (!animationPaths?.enabled) {
    return undefined;
  }

  const pathClips = Object.fromEntries(
    Object.entries(animationPaths.pathClips ?? {}).flatMap(([pathId, clip]) => {
      if (!pathId) {
        return [];
      }

      const normalized = normalizeAnimationClipState({
        ...(clip as Partial<AnimationClipState>),
        targetPathId: pathId,
      });
      if (normalized.preset === "none") {
        return [];
      }

      const { targetPathId: _ignoredTargetPathId, ...config } = normalized;
      return [[pathId, config satisfies AnimationClipConfig]];
    }),
  );

  if (Object.keys(pathClips).length === 0) {
    return undefined;
  }

  return {
    enabled: true,
    pathClips,
  };
}

function normalizeIconSettings(settings: IconSettings): IconSettings | null {
  if (!settings || !settings.animationClip) {
    return null;
  }

  const normalizedForegroundPaths = normalizeForegroundPathSettings(
    settings.foregroundPaths,
  );
  const normalizedAnimationPaths = normalizeAnimationPathSettings(
    settings.animationPaths,
  );

  return {
    ...settings,
    background: settings.background,
    foreground: settings.foreground,
    animationClip: normalizeAnimationClipState(settings.animationClip),
    ...(settings.foregroundPaths
      ? { foregroundPaths: normalizedForegroundPaths }
      : {}),
    ...(normalizedAnimationPaths ? { animationPaths: normalizedAnimationPaths } : {}),
  };
}

function normalizeIconName(iconName: string | null | undefined, iconPath: string): string {
  const trimmed = iconName?.trim();
  if (trimmed) {
    return trimmed;
  }

  const filename = iconPath.split("/").at(-1) ?? "";
  return filename.replace(/\.svg$/i, "").trim();
}

function sortByMostRecent(records: StoredIconRecord[]): StoredIconRecord[] {
  return [...records].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return left.iconName.localeCompare(right.iconName);
  });
}

async function readAllStoredRecords(): Promise<StoredIconRecord[]> {
  const database = await openEditorDb();
  return await new Promise<StoredIconRecord[]>((resolve, reject) => {
    const transaction = database.transaction(ICON_HISTORY_STORE, "readonly");
    const store = transaction.objectStore(ICON_HISTORY_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = (request.result as unknown[])
        .flatMap((value) => {
          if (typeof value !== "object" || value === null) {
            return [];
          }

          const raw = value as Partial<StoredIconRecord>;
          if (typeof raw.iconName !== "string" || !raw.iconName.trim()) {
            return [];
          }

          const normalizedSettings =
            raw.settings && typeof raw.settings === "object"
              ? normalizeIconSettings(raw.settings as IconSettings)
              : null;

          return [
            {
              iconName: raw.iconName,
              iconPath: typeof raw.iconPath === "string" ? raw.iconPath : null,
              updatedAt:
                typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
                  ? raw.updatedAt
                  : 0,
              settings: normalizedSettings,
            } satisfies StoredIconRecord,
          ];
        });
      resolve(records);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to read IndexedDB icon records."));
    };
  });
}

async function putStoredRecord(record: StoredIconRecord): Promise<void> {
  const database = await openEditorDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ICON_HISTORY_STORE, "readwrite");
    const store = transaction.objectStore(ICON_HISTORY_STORE);
    const request = store.put(record);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to write IndexedDB icon record."));
    };
  });
}

async function deleteStoredRecord(iconName: string): Promise<void> {
  const database = await openEditorDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ICON_HISTORY_STORE, "readwrite");
    const store = transaction.objectStore(ICON_HISTORY_STORE);
    const request = store.delete(iconName);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to delete IndexedDB icon record."));
    };
  });
}

async function clearStoredRecords(): Promise<void> {
  const database = await openEditorDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ICON_HISTORY_STORE, "readwrite");
    const store = transaction.objectStore(ICON_HISTORY_STORE);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to clear IndexedDB icon records."));
    };
  });
}

function ensureHydrated(): void {
  if (hydrated || hydrationPromise) {
    return;
  }

  hydrationPromise = readAllStoredRecords()
    .then((records) => {
      for (const record of records) {
        const existing = recordsCache.get(record.iconName);
        if (!existing || record.updatedAt >= existing.updatedAt) {
          recordsCache.set(record.iconName, record);
        }
      }
      hydrated = true;
      notifyHistoryUpdated();
      notifyIconAccessesUpdated();
    })
    .catch((error) => {
      hydrated = true;
      console.error("Failed to hydrate icon history from IndexedDB:", error);
    })
    .finally(() => {
      hydrationPromise = null;
    });
}

function listHistoryEntriesFromCache(): IconHistoryEntry[] {
  return sortByMostRecent(Array.from(recordsCache.values()))
    .flatMap((record) => {
      if (!record.settings) {
        return [];
      }

      const normalizedSettings = normalizeIconSettings(record.settings);
      if (!normalizedSettings) {
        return [];
      }

      return [
        {
          iconName: record.iconName,
          iconPath: record.iconPath,
          updatedAt: record.updatedAt,
          settings: normalizedSettings,
        } satisfies IconHistoryEntry,
      ];
    });
}

/**
 * Loads all remembered icon settings.
 * Data is hydrated from IndexedDB and mirrored in an in-memory cache.
 */
export function loadIconHistory(): IconHistory {
  ensureHydrated();

  const historyEntries = listHistoryEntriesFromCache();
  return historyEntries.reduce<IconHistory>((result, entry) => {
    result[entry.iconName] = entry.settings;
    return result;
  }, {});
}

/**
 * Returns full icon history entries sorted by most recent edit first.
 */
export function loadIconHistoryEntries(): IconHistoryEntry[] {
  ensureHydrated();
  return listHistoryEntriesFromCache();
}

/**
 * Saves the latest settings for one icon.
 */
export function saveIconSettings(iconName: string, settings: IconSettings): void {
  try {
    const existing = recordsCache.get(iconName);
    const normalizedAnimationClip = normalizeAnimationClipState(settings.animationClip);
    const normalizedAnimationPaths = normalizeAnimationPathSettings(
      settings.animationPaths,
    );
    const hasForegroundPathSettings = Boolean(settings.foregroundPaths?.enabled);
    const hasCustomAnimation = !isDefaultAnimationClipState(normalizedAnimationClip);
    const hasPathAnimationSettings = Boolean(normalizedAnimationPaths?.enabled);

    const isDefaultSettings =
      isDefaultBackgroundStyle(settings.background) &&
      isDefaultForegroundStyle(settings.foreground) &&
      !hasForegroundPathSettings &&
      !hasCustomAnimation &&
      !hasPathAnimationSettings;

    if (isDefaultSettings) {
      if (!existing) {
        return;
      }

      if (!existing.iconPath) {
        recordsCache.delete(iconName);
        void deleteStoredRecord(iconName).catch((error) => {
          console.error("Failed to delete icon settings:", error);
        });
      } else {
        const next: StoredIconRecord = {
          ...existing,
          settings: null,
        };
        recordsCache.set(iconName, next);
        void putStoredRecord(next).catch((error) => {
          console.error("Failed to update icon settings:", error);
        });
      }

      notifyHistoryUpdated();
      return;
    }

    const nextSettings: IconSettings = {
      ...settings,
      animationClip: normalizedAnimationClip,
      ...(normalizedAnimationPaths ? { animationPaths: normalizedAnimationPaths } : {}),
    };

    const nextRecord: StoredIconRecord = {
      iconName,
      iconPath: existing?.iconPath ?? null,
      updatedAt: Date.now(),
      settings: nextSettings,
    };

    recordsCache.set(iconName, nextRecord);
    notifyHistoryUpdated();

    void putStoredRecord(nextRecord).catch((error) => {
      console.error("Failed to save icon settings:", error);
    });
  } catch (error) {
    console.error("Failed to save icon settings:", error);
  }
}

/**
 * Loads saved settings for a specific icon name.
 */
export function loadIconSettings(iconName: string): IconSettings | null {
  ensureHydrated();

  const record = recordsCache.get(iconName);
  if (!record?.settings) {
    return null;
  }

  return normalizeIconSettings(record.settings);
}

/**
 * Clears all saved icon history and selected icon state.
 */
export function clearIconHistory(): void {
  try {
    recordsCache.clear();
    notifyHistoryUpdated();
    notifyIconAccessesUpdated();

    void clearStoredRecords().catch((error) => {
      console.error("Failed to clear icon history:", error);
    });
  } catch (error) {
    console.error("Failed to clear icon history:", error);
  }
}

/**
 * Loads the latest accessed icon paths (most recent first).
 */
export function loadRecentIconAccesses(): string[] {
  ensureHydrated();

  const uniquePaths = new Set<string>();
  const orderedPaths: string[] = [];

  for (const record of sortByMostRecent(Array.from(recordsCache.values()))) {
    if (!record.iconPath || uniquePaths.has(record.iconPath)) {
      continue;
    }

    uniquePaths.add(record.iconPath);
    orderedPaths.push(record.iconPath);

    if (orderedPaths.length >= MAX_RECENT_ICON_ACCESSES) {
      break;
    }
  }

  return orderedPaths;
}

/**
 * Records an icon path access and stores it in the icon record row.
 */
export function saveRecentIconAccess(iconPath: string, iconName?: string | null): void {
  if (!iconPath) {
    return;
  }

  try {
    const resolvedIconName = normalizeIconName(iconName, iconPath);
    if (!resolvedIconName) {
      return;
    }

    const existing = recordsCache.get(resolvedIconName);
    const shouldBumpTimestamp = !existing?.settings;
    const nextRecord: StoredIconRecord = {
      iconName: resolvedIconName,
      iconPath,
      updatedAt: shouldBumpTimestamp
        ? Date.now()
        : (existing?.updatedAt ?? Date.now()),
      settings: existing?.settings ?? null,
    };

    recordsCache.set(resolvedIconName, nextRecord);
    notifyIconAccessesUpdated();

    void putStoredRecord(nextRecord).catch((error) => {
      console.error("Failed to save recent icon access:", error);
    });
  } catch (error) {
    console.error("Failed to save recent icon access:", error);
  }
}
