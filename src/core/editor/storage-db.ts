const EDITOR_DB_NAME = "aikon-editor";
const EDITOR_DB_VERSION = 3;

export const ICON_HISTORY_STORE = "icon-history";
export const ICON_PRESETS_STORE = "icon-presets";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openEditorDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this environment."));
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(EDITOR_DB_NAME, EDITOR_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(ICON_HISTORY_STORE)) {
        database.createObjectStore(ICON_HISTORY_STORE, {
          keyPath: "iconName",
        });
      }

      if (!database.objectStoreNames.contains(ICON_PRESETS_STORE)) {
        database.createObjectStore(ICON_PRESETS_STORE, {
          keyPath: "id",
        });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Failed to open IndexedDB."));
    };
  });

  return dbPromise;
}
