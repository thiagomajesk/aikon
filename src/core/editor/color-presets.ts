import { slugify } from "../platform";
import type {
  BackgroundStyleState,
  ForegroundStyleState,
  SurfaceStyleState,
} from "./types";
import { defaultBackground, defaultForeground } from "./constants";
import { ICON_PRESETS_STORE, openEditorDb } from "./storage-db";

export const ICON_PRESETS_UPDATED_EVENT = "icon-presets-updated";
export const PRESET_COLOR_FIELD_KEYS = [
  "type",
  "flatColor",
  "gradientFrom",
  "gradientTo",
  "gradientType",
  "strokeStyle",
  "frameWidth",
  "frameColor",
  "shadowEnabled",
  "shadowMode",
  "shadowColor",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
] as const;

export type PresetColorFieldKey = (typeof PRESET_COLOR_FIELD_KEYS)[number];

export type PresetColorFields = Pick<SurfaceStyleState, PresetColorFieldKey>;

export interface ColorPresetSnapshot {
  background: PresetColorFields;
  foreground: PresetColorFields;
}

interface StoredColorPresetRecord {
  id: string;
  name: string;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
  background: PresetColorFields;
  foreground: PresetColorFields;
}

export interface ColorPreset {
  id: string;
  name: string;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
  background: PresetColorFields;
  foreground: PresetColorFields;
}

const presetCache = new Map<string, StoredColorPresetRecord>();
let hydrationPromise: Promise<void> | null = null;
let hydrated = false;

function notifyPresetsUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(ICON_PRESETS_UPDATED_EVENT));
}

function normalizePresetColorFields(
  value: unknown,
  fallback: SurfaceStyleState,
): PresetColorFields | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as Partial<Record<PresetColorFieldKey, unknown>>;
  const normalized = {} as PresetColorFields;
  const normalizedRecord = normalized as Record<PresetColorFieldKey, unknown>;

  for (const key of PRESET_COLOR_FIELD_KEYS) {
    const item = raw[key];
    const fallbackValue = fallback[key];
    if (item === undefined) {
      normalizedRecord[key] = fallbackValue;
      continue;
    }

    if (typeof fallbackValue === "string") {
      if (typeof item !== "string" || !item.trim()) {
        return null;
      }
      normalizedRecord[key] = item;
      continue;
    }

    if (typeof fallbackValue === "number") {
      if (typeof item !== "number" || !Number.isFinite(item)) {
        return null;
      }
      normalizedRecord[key] = item;
      continue;
    }

    if (typeof fallbackValue === "boolean") {
      if (typeof item !== "boolean") {
        return null;
      }
      normalizedRecord[key] = item;
      continue;
    }

    return null;
  }

  return normalized;
}

function normalizeStoredPresetRecord(value: unknown): StoredColorPresetRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as Partial<StoredColorPresetRecord>;
  if (typeof raw.id !== "string" || !raw.id) {
    return null;
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return null;
  }

  const background = normalizePresetColorFields(raw.background, defaultBackground);
  const foreground = normalizePresetColorFields(raw.foreground, defaultForeground);
  if (!background || !foreground) {
    return null;
  }

  const now = Date.now();
  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : now;
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : createdAt;
  const usageCount =
    typeof raw.usageCount === "number" && Number.isFinite(raw.usageCount)
      ? Math.max(0, Math.floor(raw.usageCount))
      : 0;

  return {
    id: raw.id,
    name: raw.name.trim(),
    usageCount,
    createdAt,
    updatedAt,
    background,
    foreground,
  };
}

function sortPresetsByPopularity(records: StoredColorPresetRecord[]): StoredColorPresetRecord[] {
  return [...records].sort((left, right) => {
    if (right.usageCount !== left.usageCount) {
      return right.usageCount - left.usageCount;
    }
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.name.localeCompare(right.name);
  });
}

function toColorPreset(record: StoredColorPresetRecord): ColorPreset {
  return {
    id: record.id,
    name: record.name,
    usageCount: record.usageCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    background: record.background,
    foreground: record.foreground,
  };
}

async function readAllStoredPresets(): Promise<StoredColorPresetRecord[]> {
  const database = await openEditorDb();
  return await new Promise<StoredColorPresetRecord[]>((resolve, reject) => {
    const transaction = database.transaction(ICON_PRESETS_STORE, "readonly");
    const store = transaction.objectStore(ICON_PRESETS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const normalized = (request.result as unknown[])
        .flatMap((item) => {
          const parsed = normalizeStoredPresetRecord(item);
          return parsed ? [parsed] : [];
        });
      resolve(normalized);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to read IndexedDB presets."));
    };
  });
}

async function putStoredPreset(record: StoredColorPresetRecord): Promise<void> {
  const database = await openEditorDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ICON_PRESETS_STORE, "readwrite");
    const store = transaction.objectStore(ICON_PRESETS_STORE);
    const request = store.put(record);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to write IndexedDB preset."));
    };
  });
}

async function clearStoredPresets(): Promise<void> {
  const database = await openEditorDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ICON_PRESETS_STORE, "readwrite");
    const store = transaction.objectStore(ICON_PRESETS_STORE);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to clear IndexedDB presets."));
    };
  });
}

function ensureHydrated(): void {
  if (hydrated || hydrationPromise) {
    return;
  }

  hydrationPromise = readAllStoredPresets()
    .then((records) => {
      for (const record of records) {
        const existing = presetCache.get(record.id);
        if (!existing || record.updatedAt >= existing.updatedAt) {
          presetCache.set(record.id, record);
        }
      }
      hydrated = true;
      notifyPresetsUpdated();
    })
    .catch((error) => {
      hydrated = true;
      console.error("Failed to hydrate presets from IndexedDB:", error);
    })
    .finally(() => {
      hydrationPromise = null;
    });
}

function createPresetId(name: string): string {
  const slug = slugify(name);
  const base = slug || "preset";

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${base}-${crypto.randomUUID()}`;
  }

  return `${base}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function createColorPresetSnapshot(
  background: BackgroundStyleState,
  foreground: ForegroundStyleState,
): ColorPresetSnapshot {
  return {
    background: {
      type: background.type,
      flatColor: background.flatColor,
      gradientFrom: background.gradientFrom,
      gradientTo: background.gradientTo,
      gradientType: background.gradientType,
      strokeStyle: background.strokeStyle,
      frameWidth: background.frameWidth,
      frameColor: background.frameColor,
      shadowEnabled: background.shadowEnabled,
      shadowMode: background.shadowMode,
      shadowColor: background.shadowColor,
      shadowBlur: background.shadowBlur,
      shadowOffsetX: background.shadowOffsetX,
      shadowOffsetY: background.shadowOffsetY,
    },
    foreground: {
      type: foreground.type,
      flatColor: foreground.flatColor,
      gradientFrom: foreground.gradientFrom,
      gradientTo: foreground.gradientTo,
      gradientType: foreground.gradientType,
      strokeStyle: foreground.strokeStyle,
      frameWidth: foreground.frameWidth,
      frameColor: foreground.frameColor,
      shadowEnabled: foreground.shadowEnabled,
      shadowMode: foreground.shadowMode,
      shadowColor: foreground.shadowColor,
      shadowBlur: foreground.shadowBlur,
      shadowOffsetX: foreground.shadowOffsetX,
      shadowOffsetY: foreground.shadowOffsetY,
    },
  };
}

export function applyPresetColorsToSurface(
  surface: SurfaceStyleState,
  colors: PresetColorFields,
): SurfaceStyleState {
  return {
    ...surface,
    ...colors,
  };
}

export function applyPresetColorsToPathStyles(
  pathStyles: Record<string, ForegroundStyleState>,
  colors: PresetColorFields,
): Record<string, ForegroundStyleState> {
  return Object.fromEntries(
    Object.entries(pathStyles).map(([pathId, style]) => [
      pathId,
      applyPresetColorsToSurface(style, colors),
    ]),
  );
}

export function loadColorPresets(): ColorPreset[] {
  ensureHydrated();
  return sortPresetsByPopularity(Array.from(presetCache.values())).map(toColorPreset);
}

export function saveColorPreset(
  name: string,
  snapshot: ColorPresetSnapshot,
): ColorPreset | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }

  const now = Date.now();
  const nextRecord: StoredColorPresetRecord = {
    id: createPresetId(trimmedName),
    name: trimmedName,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    background: snapshot.background,
    foreground: snapshot.foreground,
  };

  presetCache.set(nextRecord.id, nextRecord);
  notifyPresetsUpdated();

  void putStoredPreset(nextRecord).catch((error) => {
    console.error("Failed to save preset:", error);
  });

  return toColorPreset(nextRecord);
}

export function markColorPresetUsed(presetId: string): void {
  const existing = presetCache.get(presetId);
  if (!existing) {
    return;
  }

  const nextRecord: StoredColorPresetRecord = {
    ...existing,
    usageCount: existing.usageCount + 1,
    updatedAt: Date.now(),
  };

  presetCache.set(presetId, nextRecord);
  notifyPresetsUpdated();

  void putStoredPreset(nextRecord).catch((error) => {
    console.error("Failed to update preset usage count:", error);
  });
}

export function clearColorPresets(): void {
  presetCache.clear();
  notifyPresetsUpdated();

  void clearStoredPresets().catch((error) => {
    console.error("Failed to clear presets:", error);
  });
}
