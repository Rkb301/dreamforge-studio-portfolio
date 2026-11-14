import type { AppState, Universe } from "../../src/domain/schema.ts";

const baseEntity = (id: string, name: string) => ({
  id,
  name,
  description: "",
  tags: "",
  notes: "",
  created: "2026-01-01T00:00:00.000Z",
  updated: "2026-01-01T00:00:00.000Z",
});
export const emptyState: AppState = {
  storageVersion: 3,
  universes: [],
  currentUniverseId: null,
};
export const smallUniverse: Universe = {
  id: "u-1",
  name: "Fixture World",
  created: "2026-01-01T00:00:00.000Z",
  updated: "2026-01-01T00:00:00.000Z",
  characters: [baseEntity("c-1", "Aster"), baseEntity("c-2", "Bram")],
  locations: [],
  factions: [],
  loreNotes: [],
  relationships: [
    {
      id: "r-1",
      sourceId: "c-1",
      sourceType: "Character",
      targetId: "c-2",
      targetType: "Character",
      type: "Secret Connection",
      description: "A hidden pact",
      importance: "High",
      tags: "secret",
    },
  ],
  generatorRuns: [],
};
export const relationshipState: AppState = {
  storageVersion: 2,
  universes: [smallUniverse],
  currentUniverseId: "u-1",
};
export const noRelationshipState: AppState = {
  ...relationshipState,
  universes: [{ ...smallUniverse, relationships: [] }],
};
export const legacyV034Export = {
  storageVersion: 2,
  universes: [
    {
      ...smallUniverse,
      generatorRuns: undefined,
      relationshipIndex: { stale: true },
    },
  ],
  currentUniverseId: "u-1",
};
export const malformedParseable = {
  storageVersion: 2,
  universes: [
    {
      id: "bad",
      name: 42,
      characters: null,
      locations: [],
      factions: [],
      loreNotes: [],
      relationships: [{ type: "Enemy" }],
    },
  ],
  currentUniverseId: "missing",
};
export const generatedMediumWorld = (): AppState => ({
  storageVersion: 3,
  currentUniverseId: "medium",
  universes: [
    {
      ...smallUniverse,
      id: "medium",
      name: "Medium Generated World",
      characters: Array.from({ length: 50 }, (_, index) =>
        baseEntity(`mc-${index}`, `Citizen ${index}`),
      ),
      relationships: Array.from({ length: 49 }, (_, index) => ({
        id: `mr-${index}`,
        sourceId: `mc-${index}`,
        sourceType: "Character",
        targetId: `mc-${index + 1}`,
        targetType: "Character",
        type: "Neighbor",
        description: "",
        importance: "Medium",
        tags: "generated",
      })),
    },
  ],
});
export const relationshipRichWorld = (): AppState => ({
  storageVersion: 3,
  currentUniverseId: "rich",
  universes: [
    {
      ...generatedMediumWorld().universes[0]!,
      id: "rich",
      name: "Relationship Rich World",
      relationships: Array.from({ length: 120 }, (_, index) => ({
        id: `rr-${index}`,
        sourceId: `mc-${index % 50}`,
        sourceType: "Character",
        targetId: `mc-${(index * 7 + 1) % 50}`,
        targetType: "Character",
        type: index % 3 === 0 ? "Enemy" : "Ally",
        description: "",
        importance: "Medium",
        tags: "",
      })),
    },
  ],
});
