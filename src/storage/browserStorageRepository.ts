import { migrateToCurrentSchema } from "../domain/migrations.ts";
import {
  COLLECTION_KEYS,
  normalizeAppState,
  type AppState,
  type CollectionKey,
  type SchemaDependencies,
  type StorageChunkManifest,
  type Universe,
  type ValidationIssue,
} from "../domain/schema.ts";
import type { Clock } from "../shared/clock.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { CURRENT_SCHEMA_VERSION } from "../shared/schemaVersion.ts";
import type { AppStateRepository, LoadReport } from "./repository.ts";

export const STORAGE_KEY = "dreamforge_data";
export const STORAGE_BACKUP_PREFIX = "dreamforge_backup_v1";
export const STORAGE_ENTITY_CHUNK_PREFIX = "dreamforge_entity_chunk_v1";
export const STORAGE_ENTITY_CHUNK_SIZE = 250;
export const LARGE_ENTITY_STORAGE_THRESHOLD = 350;
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const chunkKey = (
  universeId: string,
  collection: CollectionKey,
  index: number,
): string =>
  `${STORAGE_ENTITY_CHUNK_PREFIX}:${universeId}:${collection}:${index}`;

export class BrowserStorageRepository implements AppStateRepository {
  constructor(
    private readonly storage: StorageLike | null,
    private readonly deps: SchemaDependencies,
    private readonly clock: Clock = deps.clock,
  ) {}
  load(): Result<LoadReport> {
    if (!this.storage)
      return ok({
        state: normalizeAppState({}, this.deps).state,
        issues: [],
        migrations: [],
      });
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw)
      return ok({
        state: normalizeAppState({}, this.deps).state,
        issues: [],
        migrations: [],
      });
    try {
      const migrated = migrateToCurrentSchema(JSON.parse(raw));
      const issues: ValidationIssue[] = [];
      this.hydrateChunks(migrated.value, issues);
      const normalized = normalizeAppState(migrated.value, this.deps);
      return ok({
        state: normalized.state,
        issues: [...issues, ...normalized.issues],
        migrations: migrated.applied,
      });
    } catch (cause) {
      return err(
        "STORAGE_PARSE_FAILED",
        "Stored Dreamforge data could not be parsed. No data was overwritten.",
        cause,
      );
    }
  }
  save(state: AppState): Result<void> {
    if (!this.storage) return ok(undefined);
    try {
      const normalized = normalizeAppState(state, this.deps).state;
      const previous = this.storage.getItem(STORAGE_KEY);
      const snapshot = {
        ...normalized,
        storageVersion: CURRENT_SCHEMA_VERSION,
        universes: normalized.universes.map((universe) =>
          this.prepareUniverse(universe),
        ),
      };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      if (previous && previous !== this.storage.getItem(STORAGE_KEY))
        this.storage.setItem(`${STORAGE_BACKUP_PREFIX}:last-save`, previous);
      return ok(undefined);
    } catch (cause) {
      return err(
        "STORAGE_WRITE_FAILED",
        "Dreamforge could not write to browser storage. Existing data was retained where possible.",
        cause,
      );
    }
  }
  exportJson(state: AppState): Result<string> {
    try {
      return ok(
        JSON.stringify(
          this.stripDerived(normalizeAppState(state, this.deps).state),
          null,
          2,
        ),
      );
    } catch (cause) {
      return err(
        "EXPORT_FAILED",
        "Dreamforge data could not be exported.",
        cause,
      );
    }
  }
  importJson(json: string): Result<LoadReport> {
    if (!this.storage)
      return err("STORAGE_UNAVAILABLE", "Browser storage is unavailable.");
    try {
      const parsed: unknown = JSON.parse(json);
      const migrated = migrateToCurrentSchema(parsed);
      const normalized = normalizeAppState(migrated.value, this.deps);
      if (!Array.isArray((migrated.value as Record<string, unknown>).universes))
        return err("IMPORT_INVALID", "Import must contain a universes array.");
      const existing = this.storage.getItem(STORAGE_KEY);
      if (existing)
        this.storage.setItem(
          `${STORAGE_BACKUP_PREFIX}:${this.clock.nowIso()}`,
          existing,
        );
      const saved = this.save(normalized.state);
      if (!saved.ok) return saved;
      return ok({
        state: normalized.state,
        issues: normalized.issues,
        migrations: migrated.applied,
      });
    } catch (cause) {
      return err("IMPORT_PARSE_FAILED", "Import is not valid JSON.", cause);
    }
  }
  clear(): Result<void> {
    if (!this.storage) return ok(undefined);
    try {
      this.storage.removeItem(STORAGE_KEY);
      this.removeByPrefix(`${STORAGE_ENTITY_CHUNK_PREFIX}:`);
      return ok(undefined);
    } catch (cause) {
      return err(
        "STORAGE_CLEAR_FAILED",
        "Dreamforge storage could not be cleared.",
        cause,
      );
    }
  }
  deleteUniverse(universe: Universe): void {
    for (const key of COLLECTION_KEYS)
      this.removeByPrefix(
        `${STORAGE_ENTITY_CHUNK_PREFIX}:${universe.id}:${key}:`,
      );
  }
  loadPage(
    universe: Universe,
    key: CollectionKey,
    page: number,
    pageSize: number,
  ): unknown[] {
    const values = universe[key];
    return values.slice(
      Math.max(0, page) * pageSize,
      Math.max(0, page) * pageSize + pageSize,
    );
  }
  private prepareUniverse(universe: Universe): Record<string, unknown> {
    const clone = this.stripDerived(universe) as Record<string, unknown>;
    const collections: Partial<Record<CollectionKey, StorageChunkManifest>> =
      {};
    for (const key of COLLECTION_KEYS) {
      const items = universe[key];
      this.removeByPrefix(
        `${STORAGE_ENTITY_CHUNK_PREFIX}:${universe.id}:${key}:`,
      );
      if (items.length > LARGE_ENTITY_STORAGE_THRESHOLD && this.storage) {
        const count = Math.ceil(items.length / STORAGE_ENTITY_CHUNK_SIZE);
        for (let index = 0; index < count; index += 1)
          this.storage.setItem(
            chunkKey(universe.id, key, index),
            JSON.stringify(
              items.slice(
                index * STORAGE_ENTITY_CHUNK_SIZE,
                (index + 1) * STORAGE_ENTITY_CHUNK_SIZE,
              ),
            ),
          );
        clone[key] = [];
        collections[key] = {
          mode: "chunked-local",
          total: items.length,
          chunkSize: STORAGE_ENTITY_CHUNK_SIZE,
          chunkCount: count,
          updated: this.clock.nowIso(),
        };
      }
    }
    clone.storageIndex = {
      version: CURRENT_SCHEMA_VERSION,
      engine: "local chunk store",
      collections,
      updated: this.clock.nowIso(),
    };
    return clone;
  }
  private hydrateChunks(
    value: Record<string, unknown>,
    issues: ValidationIssue[],
  ): void {
    const universes = Array.isArray(value.universes) ? value.universes : [];
    for (const raw of universes) {
      if (typeof raw !== "object" || !raw) continue;
      const universe = raw as Record<string, unknown>;
      const id = typeof universe.id === "string" ? universe.id : "";
      const index =
        typeof universe.storageIndex === "object" && universe.storageIndex
          ? (universe.storageIndex as Record<string, unknown>)
          : {};
      const collections =
        typeof index.collections === "object" && index.collections
          ? (index.collections as Record<string, unknown>)
          : {};
      for (const key of COLLECTION_KEYS) {
        const meta =
          typeof collections[key] === "object" && collections[key]
            ? (collections[key] as Record<string, unknown>)
            : {};
        if (meta.mode !== "chunked-local") continue;
        const items: unknown[] = [];
        const count = Number(meta.chunkCount) || 0;
        for (let chunk = 0; chunk < count; chunk += 1) {
          const rawChunk = this.storage?.getItem(chunkKey(id, key, chunk));
          if (!rawChunk) {
            issues.push({
              path: `${id}.${key}.chunk[${chunk}]`,
              message: "Storage chunk is missing; remaining data was retained.",
              severity: "error",
            });
            continue;
          }
          try {
            const parsed: unknown = JSON.parse(rawChunk);
            if (Array.isArray(parsed)) items.push(...parsed);
            else
              issues.push({
                path: `${id}.${key}.chunk[${chunk}]`,
                message: "Storage chunk was not an array.",
                severity: "error",
              });
          } catch {
            issues.push({
              path: `${id}.${key}.chunk[${chunk}]`,
              message: "Storage chunk could not be parsed.",
              severity: "error",
            });
          }
        }
        if (items.length > 0 || !Array.isArray(universe[key]))
          universe[key] = items;
      }
    }
  }
  private stripDerived<T>(value: T): T {
    if (Array.isArray(value))
      return value.map((item) => this.stripDerived(item)) as T;
    if (typeof value !== "object" || value === null) return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value))
      if (!["relationshipIndex", "storageSummary"].includes(key))
        output[key] = this.stripDerived(item);
    return output as T;
  }
  private removeByPrefix(prefix: string): void {
    if (!this.storage) return;
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => this.storage?.removeItem(key));
  }
}

export const createLegacyStorageFacade = (
  storage: StorageLike | null,
  deps: SchemaDependencies,
) => {
  const repository = new BrowserStorageRepository(storage, deps);
  return {
    getState: (): AppState => {
      const result = repository.load();
      if (!result.ok) {
        console.error(result.error.message, result.error.cause);
        return normalizeAppState({}, deps).state;
      }
      result.value.issues.forEach((issue) =>
        console.warn(`Storage recovery: ${issue.path}: ${issue.message}`),
      );
      return result.value.state;
    },
    saveState: (state: AppState): void => {
      const result = repository.save(state);
      if (!result.ok)
        throw new Error(result.error.message, { cause: result.error.cause });
    },
    deleteUniverse: (universe: Universe): void =>
      repository.deleteUniverse(universe),
    loadEntitiesPage: (
      universe: Universe,
      key: CollectionKey,
      page: number,
      size: number,
    ): unknown[] => repository.loadPage(universe, key, page, size),
    clearAllChunks: (): void => {
      for (const universe of repository.load().ok
        ? (repository.load() as { ok: true; value: LoadReport }).value.state
            .universes
        : [])
        repository.deleteUniverse(universe);
    },
    exportState: (state: AppState): Result<string> =>
      repository.exportJson(state),
    importState: (json: string): Result<LoadReport> =>
      repository.importJson(json),
  };
};
