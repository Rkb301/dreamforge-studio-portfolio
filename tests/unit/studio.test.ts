import { describe, it, expect } from "vitest";
import {
  validateImport,
  cleanSnapshot,
} from "../../src/storage/studioRepository.ts";
import { relationshipState } from "../fixtures/states.ts";

describe("studio import boundary", () => {
  it("accepts complete old exports without changing IDs", () => {
    expect(validateImport(relationshipState).universes[0]?.id).toBe(
      relationshipState.universes[0]?.id,
    );
  });
  it("rejects malformed collections rather than normalizing them away", () => {
    const broken = structuredClone(relationshipState);
    (broken.universes[0] as Record<string, unknown>).characters = "broken";
    expect(() => validateImport(broken)).toThrow("must be an array");
  });
  it("rejects newer schema and duplicate IDs", () => {
    expect(() =>
      validateImport({ ...relationshipState, storageVersion: 999 }),
    ).toThrow("newer schema");
    expect(() =>
      validateImport({
        ...relationshipState,
        universes: [
          ...relationshipState.universes,
          ...relationshipState.universes,
        ],
      }),
    ).toThrow("Duplicate world IDs");
  });
  it("rejects incomplete chunk manifests", () => {
    const broken = structuredClone(relationshipState);
    const w = broken.universes[0];
    if (!w) throw Error("missing fixture");
    w.storageIndex = {
      collections: { characters: { mode: "chunked-local", total: 999 } },
    };
    expect(() => validateImport(broken)).toThrow("chunk manifest");
  });
  it("strips rebuildable indexes while preserving unknown authored fields", () => {
    const s = structuredClone(relationshipState);
    const w = s.universes[0];
    if (!w) throw Error("missing fixture");
    w.relationshipIndex = { huge: true };
    w.specialRule = "Memories have mass";
    const copy = cleanSnapshot(s);
    expect(copy.universes[0]?.relationshipIndex).toBeUndefined();
    expect(copy.universes[0]?.specialRule).toBe("Memories have mass");
    expect(w.relationshipIndex).toEqual({ huge: true });
  });
});
