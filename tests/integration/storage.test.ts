import { describe, expect, it } from "vitest";
import {
  BrowserStorageRepository,
  STORAGE_ENTITY_CHUNK_PREFIX,
  STORAGE_KEY,
  type StorageLike,
} from "../../src/storage/browserStorageRepository.ts";
import { FixedClock } from "../../src/shared/clock.ts";
import { StableIdFactory } from "../../src/shared/id.ts";
import {
  emptyState,
  generatedMediumWorld,
  legacyV034Export,
  malformedParseable,
  noRelationshipState,
  relationshipRichWorld,
  relationshipState,
} from "../fixtures/states.ts";
class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
const repository = () => {
  const storage = new MemoryStorage();
  return {
    storage,
    repo: new BrowserStorageRepository(storage, {
      clock: new FixedClock("2026-01-01Z"),
      ids: new StableIdFactory(),
    }),
  };
};
describe("browser storage repository", () => {
  it.each([
    ["empty", emptyState],
    ["no relationships", noRelationshipState],
    ["relationship bearing", relationshipState],
  ])("loads %s state", (_name, state) => {
    const { repo } = repository();
    expect(repo.save(state).ok).toBe(true);
    expect(repo.load()).toMatchObject({
      ok: true,
      value: { state: { universes: state.universes } },
    });
  });
  it("reconstructs relationships while excluding runtime indexes from durable JSON", () => {
    const { repo, storage } = repository();
    const state = structuredClone(relationshipState);
    state.universes[0]!.relationshipIndex = { stale: true };
    repo.save(state);
    expect(storage.getItem(STORAGE_KEY)).not.toContain("relationshipIndex");
    expect(repo.load().ok).toBe(true);
  });
  it("round trips export and import with backup", () => {
    const { repo } = repository();
    repo.save(noRelationshipState);
    const exported = repo.exportJson(relationshipState);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const imported = repo.importJson(exported.value);
    expect(imported).toMatchObject({
      ok: true,
      value: { state: { currentUniverseId: "u-1" } },
    });
  });
  it("imports legacy v0.3.4 exports", () => {
    const { repo } = repository();
    const result = repo.importJson(JSON.stringify(legacyV034Export));
    expect(result).toMatchObject({
      ok: true,
      value: { state: { storageVersion: 3 } },
    });
  });
  it("reports malformed imports", () =>
    expect(repository().repo.importJson("{oops")).toMatchObject({
      ok: false,
      error: { code: "IMPORT_PARSE_FAILED" },
    }));
  it("normalizes missing optional and malformed fields", () => {
    const result = repository().repo.importJson(
      JSON.stringify(malformedParseable),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.issues.length).toBeGreaterThan(0);
  });
  it("detects partial chunk data", () => {
    const { repo, storage } = repository();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        storageVersion: 2,
        universes: [
          {
            id: "u",
            name: "Chunked",
            characters: [],
            locations: [],
            factions: [],
            loreNotes: [],
            relationships: [],
            storageIndex: {
              collections: {
                characters: { mode: "chunked-local", chunkCount: 2 },
              },
            },
          },
        ],
        currentUniverseId: "u",
      }),
    );
    storage.setItem(
      `${STORAGE_ENTITY_CHUNK_PREFIX}:u:characters:0`,
      JSON.stringify([{ id: "c", name: "One" }]),
    );
    const result = repo.load();
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        result.value.issues.some((issue) => issue.path.includes("chunk[1]")),
      ).toBe(true);
  });
  it("supports representative generated and relationship-rich worlds", () => {
    const { repo } = repository();
    expect(repo.save(generatedMediumWorld()).ok).toBe(true);
    expect(repo.save(relationshipRichWorld()).ok).toBe(true);
  });
});
