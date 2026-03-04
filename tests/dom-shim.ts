import { DOMParser, Element, Node } from "linkedom";

class TestXMLSerializer {
  serializeToString(node: { toString(): string }): string {
    return node.toString();
  }
}

interface FakeObjectStoreState {
  keyPath: string;
  records: Map<string, unknown>;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function createFakeRequest(
  executor: (request: {
    result: unknown;
    error: Error | null;
    onsuccess: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
  }) => void,
): {
  result: unknown;
  error: Error | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
} {
  const request = {
    result: undefined as unknown,
    error: null as Error | null,
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
  };

  queueMicrotask(() => {
    try {
      executor(request);
      request.onsuccess?.(new Event("success"));
    } catch (error) {
      request.error =
        error instanceof Error ? error : new Error("Fake IndexedDB request failed.");
      request.onerror?.(new Event("error"));
    }
  });

  return request;
}

class FakeIDBObjectStore {
  constructor(private readonly state: FakeObjectStoreState) {}

  getAll() {
    return createFakeRequest((request) => {
      request.result = [...this.state.records.values()].map((value) =>
        cloneValue(value),
      );
    });
  }

  put(value: unknown) {
    return createFakeRequest((request) => {
      if (typeof value !== "object" || value === null) {
        throw new Error("Fake IndexedDB put expects an object value.");
      }

      const key = (value as Record<string, unknown>)[this.state.keyPath];
      if (typeof key !== "string" || !key) {
        throw new Error("Fake IndexedDB put requires a valid string key.");
      }

      this.state.records.set(key, cloneValue(value));
      request.result = key;
    });
  }

  delete(key: string) {
    return createFakeRequest((request) => {
      this.state.records.delete(String(key));
      request.result = undefined;
    });
  }

  clear() {
    return createFakeRequest((request) => {
      this.state.records.clear();
      request.result = undefined;
    });
  }
}

class FakeIDBTransaction {
  constructor(
    private readonly stores: Map<string, FakeObjectStoreState>,
    private readonly storeName: string,
  ) {}

  objectStore(name: string): FakeIDBObjectStore {
    if (name !== this.storeName) {
      throw new Error(`Fake IndexedDB transaction does not include store "${name}".`);
    }

    const state = this.stores.get(name);
    if (!state) {
      throw new Error(`Fake IndexedDB store "${name}" does not exist.`);
    }

    return new FakeIDBObjectStore(state);
  }
}

class FakeIDBDatabase {
  version: number;
  private readonly stores = new Map<string, FakeObjectStoreState>();

  constructor(
    readonly name: string,
    initialVersion: number,
  ) {
    this.version = initialVersion;
  }

  get objectStoreNames(): { contains: (storeName: string) => boolean } {
    return {
      contains: (storeName: string) => this.stores.has(storeName),
    };
  }

  createObjectStore(
    name: string,
    options?: { keyPath?: string | string[] | null },
  ): FakeIDBObjectStore {
    const keyPath =
      typeof options?.keyPath === "string" && options.keyPath
        ? options.keyPath
        : "id";
    const state: FakeObjectStoreState = {
      keyPath,
      records: this.stores.get(name)?.records ?? new Map<string, unknown>(),
    };
    this.stores.set(name, state);
    return new FakeIDBObjectStore(state);
  }

  transaction(storeName: string, _mode: "readonly" | "readwrite"): FakeIDBTransaction {
    if (!this.stores.has(storeName)) {
      throw new Error(`Fake IndexedDB store "${storeName}" does not exist.`);
    }

    return new FakeIDBTransaction(this.stores, storeName);
  }
}

class FakeIndexedDB {
  private readonly databases = new Map<string, FakeIDBDatabase>();

  open(name: string, version?: number) {
    const request = {
      result: undefined as unknown,
      error: null as Error | null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: Event) => void) | null,
    };

    queueMicrotask(() => {
      try {
        const nextVersion = typeof version === "number" ? version : 1;
        let database = this.databases.get(name);
        const shouldUpgrade =
          !database || (typeof version === "number" && version > database.version);

        if (!database) {
          database = new FakeIDBDatabase(name, nextVersion);
          this.databases.set(name, database);
        } else if (typeof version === "number" && version > database.version) {
          database.version = version;
        }

        request.result = database;

        if (shouldUpgrade) {
          request.onupgradeneeded?.(new Event("upgradeneeded"));
        }

        request.onsuccess?.(new Event("success"));
      } catch (error) {
        request.error =
          error instanceof Error ? error : new Error("Fake IndexedDB open failed.");
        request.onerror?.(new Event("error"));
      }
    });

    return request;
  }
}

Object.assign(globalThis, {
  DOMParser,
  XMLSerializer: TestXMLSerializer,
  Node,
  Element,
  indexedDB: new FakeIndexedDB(),
});
