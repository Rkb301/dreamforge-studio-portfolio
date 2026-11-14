import { BrowserStorageRepository } from "./browserStorageRepository.ts";
import {
  normalizeAppState,
  type AppState,
  type SchemaDependencies,
} from "../domain/schema.ts";
import { systemClock } from "../shared/clock.ts";
import { RuntimeIdFactory } from "../shared/id.ts";
import { systemRandom } from "../shared/random.ts";

const deps: SchemaDependencies = {
  clock: systemClock,
  ids: new RuntimeIdFactory(systemClock, systemRandom),
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validate before normalizing: malformed imports must never erase source fields. */
export function validateImport(value: unknown): AppState {
  if (!isRecord(value) || !Array.isArray(value.universes))
    throw new Error("A backup must contain a universes array.");
  if (Number(value.storageVersion ?? 0) > 3)
    throw new Error(
      "This backup uses a newer schema. Update Dreamforge before importing it.",
    );
  const worldIds = new Set<string>();
  for (const raw of value.universes) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.name !== "string"
    )
      throw new Error("Each world needs an id and a name.");
    if (worldIds.has(raw.id)) throw new Error("Duplicate world IDs in backup.");
    worldIds.add(raw.id);
    const ids = new Set<string>();
    for (const key of [
      "characters",
      "locations",
      "factions",
      "loreNotes",
      "relationships",
    ]) {
      if (!Array.isArray(raw[key]))
        throw new Error(`${raw.name}: ${key} must be an array.`);
      for (const item of raw[key]) {
        if (
          !isRecord(item) ||
          typeof item.id !== "string" ||
          (key !== "relationships" && typeof item.name !== "string")
        )
          throw new Error(`${raw.name}: invalid ${key} record.`);
        if (ids.has(item.id))
          throw new Error(`${raw.name}: duplicate record ID ${item.id}.`);
        ids.add(item.id);
        if (
          key === "relationships" &&
          (typeof item.sourceId !== "string" ||
            typeof item.targetId !== "string")
        )
          throw new Error("A relationship is missing its endpoints.");
      }
    }
    const manifest = raw.storageIndex;
    if (isRecord(manifest) && isRecord(manifest.collections)) {
      for (const [key, meta] of Object.entries(manifest.collections)) {
        if (
          isRecord(meta) &&
          meta.mode === "chunked-local" &&
          Number(meta.total) !== (Array.isArray(raw[key]) ? raw[key].length : 0)
        )
          throw new Error(
            "This file is a chunk manifest, not a complete export. Export it from the original browser first.",
          );
      }
    }
    if (
      raw.events !== undefined &&
      (!Array.isArray(raw.events) ||
        raw.events.some(
          (e) =>
            !isRecord(e) ||
            typeof e.id !== "string" ||
            typeof e.title !== "string" ||
            typeof e.detail !== "string" ||
            !["fact", "belief", "myth"].includes(String(e.kind)),
        ))
    )
      throw new Error("Invalid timeline records.");
    if (
      raw.goals !== undefined &&
      (!Array.isArray(raw.goals) ||
        raw.goals.some(
          (g) =>
            !isRecord(g) ||
            typeof g.id !== "string" ||
            typeof g.text !== "string" ||
            typeof g.done !== "boolean",
        ))
    )
      throw new Error("Invalid world goals.");
    if (
      raw.chat !== undefined &&
      (!Array.isArray(raw.chat) ||
        raw.chat.some((m) => !isRecord(m) || typeof m.text !== "string"))
    )
      throw new Error("Invalid conversation history.");
  }
  return normalizeAppState(value, deps).state;
}

export function cleanSnapshot(state: AppState): AppState {
  const clone = structuredClone(state);
  for (const world of clone.universes) {
    delete world.relationshipIndex;
    delete world.storageIndex;
    delete world.storageSummary;
  }
  return clone;
}

interface Snapshot {
  state: AppState;
  revision: number;
}
export class StudioRepository {
  private db: IDBDatabase | undefined;
  private revision = 0;

  async open(): Promise<AppState> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("dreamforge-studio", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("snapshots");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            "IndexedDB is unavailable. Check browser storage permissions.",
          ),
        );
      request.onblocked = () =>
        reject(new Error("Close other Dreamforge tabs, then reload."));
    });
    const saved = await this.read("current");
    if (saved) {
      this.revision = saved.revision;
      return validateImport(saved.state);
    }
    // Read and hydrate the legacy storage only. Never clear or rewrite legacy keys.
    const legacy = new BrowserStorageRepository(localStorage, deps).load();
    if (!legacy.ok) throw new Error(legacy.error.message);
    if (legacy.value.issues.some((i) => i.severity === "error"))
      throw new Error(
        "The old save has missing or invalid data. Legacy data is untouched; recover a complete JSON export before continuing.",
      );
    const state = cleanSnapshot(legacy.value.state);
    await this.save(state);
    return state;
  }

  private async read(key: string): Promise<Snapshot | undefined> {
    const db = this.db;
    if (!db) throw new Error("Storage is not open.");
    return new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", "readonly");
      const request = tx.objectStore("snapshots").get(key);
      request.onsuccess = () => resolve(request.result as Snapshot | undefined);
      request.onerror = () =>
        reject(new Error("Could not read local storage."));
    });
  }

  async save(state: AppState): Promise<void> {
    const snapshot = cleanSnapshot(state);
    const db = this.db;
    if (!db) throw new Error("Storage is not open.");
    const expected = this.revision;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      const store = tx.objectStore("snapshots");
      let conflict = false;
      const request = store.get("current");
      request.onsuccess = () => {
        const previous = request.result as Snapshot | undefined;
        if ((previous?.revision ?? 0) !== expected) {
          conflict = true;
          tx.abort();
          return;
        }
        if (previous) store.put(previous, "previous");
        store.put({ state: snapshot, revision: expected + 1 }, "current");
      };
      tx.oncomplete = () => {
        this.revision = expected + 1;
        resolve();
      };
      tx.onabort = () =>
        reject(
          new Error(
            conflict
              ? "Another tab changed this workspace. Export your current work, then reload before editing."
              : "Save failed. Your previous save is intact. Free browser storage or export your work.",
          ),
        );
      tx.onerror = () => {
        /* onabort reports the transaction failure */
      };
    });
  }

  async previous(): Promise<AppState | undefined> {
    return (await this.read("previous"))?.state;
  }
}
