import assert from "node:assert/strict";
import test from "node:test";
import "../dom-shim";
import {
  clearIconHistory,
  ICON_ACCESSES_UPDATED_EVENT,
  ICON_HISTORY_UPDATED_EVENT,
  loadIconHistory,
  loadIconHistoryEntries,
  loadIconSettings,
  loadRecentIconAccesses,
  saveIconSettings,
  saveRecentIconAccess,
} from "../../src/core/editor";
import {
  defaultAnimationClip,
  defaultBackground,
  defaultForeground,
} from "../../src/core/editor";

type Listener = (event: Event) => void;

function createWindowMock() {
  const listeners = new Map<string, Set<Listener>>();

  return {
    addEventListener(type: string, listener: Listener) {
      const entry = listeners.get(type) ?? new Set<Listener>();
      entry.add(listener);
      listeners.set(type, entry);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event): boolean {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    },
  };
}

const windowMock = createWindowMock();
Object.assign(globalThis, {
  window: windowMock,
});

const settings = {
  background: {
    ...defaultBackground,
    flatColor: "#112233",
  },
  foreground: {
    ...defaultForeground,
    flatColor: "#aabbcc",
  },
  animationClip: defaultAnimationClip,
};

const foregroundPathSettings = {
  enabled: true,
  selectedPathId: "path-2",
  pathStyles: {
    "path-2": {
      ...defaultForeground,
      flatColor: "#44aaff",
    },
  },
};

const animationPathSettings = {
  enabled: true,
  pathClips: {
    "path-2": {
      preset: "bounce" as const,
      durationMs: 900,
      ease: "inOutSine",
      loop: true,
      alternate: true,
    },
  },
};

const defaultSettings = {
  background: defaultBackground,
  foreground: defaultForeground,
  animationClip: defaultAnimationClip,
};

function withMockedNow<T>(start: number, callback: () => T): T {
  const originalDateNow = Date.now;
  let now = start;
  Date.now = () => {
    now += 1;
    return now;
  };

  try {
    return callback();
  } finally {
    Date.now = originalDateNow;
  }
}

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("aikon-editor");
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open icon history test database."));
    };
  });
}

test("icon history persists and restores icon settings", () => {
  clearIconHistory();

  saveIconSettings("crossbow", settings);

  const restored = loadIconSettings("crossbow");
  assert.deepEqual(restored, settings);
});

test("icon history stores rows ordered by latest edit timestamp", () => {
  clearIconHistory();

  withMockedNow(1000, () => {
    saveRecentIconAccess("category/icon-1.svg", "icon-1");
    saveIconSettings("icon-1", settings);
    saveRecentIconAccess("category/icon-2.svg", "icon-2");
    saveIconSettings("icon-2", settings);
  });

  const entries = loadIconHistoryEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.iconName, "icon-2");
  assert.equal(entries[1]?.iconName, "icon-1");
  assert.equal(entries[0]?.updatedAt > entries[1]?.updatedAt, true);
});

test("icon history is not capped to 10 entries in storage", () => {
  clearIconHistory();

  for (let index = 1; index <= 14; index += 1) {
    saveIconSettings(`icon-${index}`, settings);
  }

  const history = loadIconHistory();
  assert.equal(Object.keys(history).length, 14);
});

test("saving and clearing history dispatches update events", () => {
  clearIconHistory();

  let updateCount = 0;
  const listener = () => {
    updateCount += 1;
  };

  windowMock.addEventListener(ICON_HISTORY_UPDATED_EVENT, listener);
  saveIconSettings("shield", settings);
  clearIconHistory();
  windowMock.removeEventListener(ICON_HISTORY_UPDATED_EVENT, listener);

  assert.equal(updateCount, 2);
});

test("default settings are not persisted and reset removes existing entry", () => {
  clearIconHistory();

  saveIconSettings("falcon", defaultSettings);
  assert.equal(loadIconSettings("falcon"), null);

  saveRecentIconAccess("lorc/falcon.svg", "falcon");
  saveIconSettings("falcon", settings);
  assert.deepEqual(loadIconSettings("falcon"), settings);

  saveIconSettings("falcon", defaultSettings);
  assert.equal(loadIconSettings("falcon"), null);
  assert.equal(loadIconHistoryEntries().find((entry) => entry.iconName === "falcon"), undefined);
});

test("foreground path settings are persisted and restored", () => {
  clearIconHistory();

  saveIconSettings("hydra", {
    ...settings,
    foregroundPaths: foregroundPathSettings,
  });

  const restored = loadIconSettings("hydra");
  assert.deepEqual(restored?.foregroundPaths, foregroundPathSettings);
});

test("foreground path settings keep an icon entry even with default styles", () => {
  clearIconHistory();

  saveIconSettings("wyrm", {
    ...defaultSettings,
    foregroundPaths: foregroundPathSettings,
  });

  const restored = loadIconSettings("wyrm");
  assert.notEqual(restored, null);
  assert.deepEqual(restored?.foregroundPaths, foregroundPathSettings);
});

test("animation path settings are persisted and restored", () => {
  clearIconHistory();

  saveIconSettings("manticore", {
    ...settings,
    animationPaths: animationPathSettings,
  });

  const restored = loadIconSettings("manticore");
  assert.deepEqual(restored?.animationPaths, animationPathSettings);
});

test("animation path settings keep an icon entry even with default base settings", () => {
  clearIconHistory();

  saveIconSettings("chimera", {
    ...defaultSettings,
    animationPaths: animationPathSettings,
  });

  const restored = loadIconSettings("chimera");
  assert.notEqual(restored, null);
  assert.deepEqual(restored?.animationPaths, animationPathSettings);
});

test("saveRecentIconAccess keeps latest 100 unique paths", () => {
  clearIconHistory();

  withMockedNow(2000, () => {
    for (let index = 1; index <= 101; index += 1) {
      saveRecentIconAccess(`category/icon-${index}.svg`, `icon-${index}`);
    }

    saveRecentIconAccess("category/icon-80.svg", "icon-80");
  });

  const recent = loadRecentIconAccesses();
  assert.equal(recent.length, 100);
  assert.equal(recent[0], "category/icon-80.svg");
  assert.equal(recent.includes("category/icon-1.svg"), false);
});

test("saving icon accesses dispatches update events", () => {
  clearIconHistory();

  let updateCount = 0;
  const listener = () => {
    updateCount += 1;
  };

  windowMock.addEventListener(ICON_ACCESSES_UPDATED_EVENT, listener);
  saveRecentIconAccess("lorc/acid-blob.svg", "acid-blob");
  windowMock.removeEventListener(ICON_ACCESSES_UPDATED_EVENT, listener);

  assert.equal(updateCount, 1);
});

test("saveRecentIconAccess ignores empty paths", () => {
  clearIconHistory();

  let updateCount = 0;
  const listener = () => {
    updateCount += 1;
  };

  windowMock.addEventListener(ICON_ACCESSES_UPDATED_EVENT, listener);
  saveRecentIconAccess("");
  windowMock.removeEventListener(ICON_ACCESSES_UPDATED_EVENT, listener);

  assert.equal(updateCount, 0);
  assert.deepEqual(loadRecentIconAccesses(), []);
});

test("saveRecentIconAccess does not reorder edited icon timestamps", () => {
  clearIconHistory();

  withMockedNow(5000, () => {
    saveRecentIconAccess("category/raven.svg", "raven");
    saveIconSettings("raven", settings);
    const before = loadIconHistoryEntries().find((entry) => entry.iconName === "raven");
    saveRecentIconAccess("category/raven.svg", "raven");
    const after = loadIconHistoryEntries().find((entry) => entry.iconName === "raven");

    assert.notEqual(before, undefined);
    assert.notEqual(after, undefined);
    assert.equal(before?.updatedAt, after?.updatedAt);
  });
});

test("icon history uses the icon-history object store", async () => {
  clearIconHistory();
  saveIconSettings("gryphon", settings);

  const database = await openHistoryDatabase();
  assert.equal(database.objectStoreNames.contains("icon-history"), true);
  assert.equal(database.objectStoreNames.contains("icon-edits"), false);
});
