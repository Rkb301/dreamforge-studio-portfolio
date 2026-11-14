import type { GeneratorRunMetadata } from "../generation/context.ts";
import {
  normalizeRelationship,
  type RelationshipRecord,
} from "../relationships/domain.ts";
import type { Clock } from "../shared/clock.ts";
import type { IdFactory } from "../shared/id.ts";
import { CURRENT_SCHEMA_VERSION } from "../shared/schemaVersion.ts";

export interface EntityRecord extends Record<string, unknown> {
  id: string;
  name: string;
  description: string;
  tags: string;
  notes: string;
  created: string;
  updated: string;
}
export interface Character extends EntityRecord {
  role?: string;
  species?: string;
  personality?: string;
  goals?: string;
  secrets?: string;
}
export interface Location extends EntityRecord {
  region?: string;
  importance?: string;
  associatedFactions?: string[];
}
export interface Faction extends EntityRecord {
  leader?: string;
  ideology?: string;
  goals?: string;
  allies?: string;
  enemies?: string;
}
export interface LoreNote extends EntityRecord {
  category?: string;
  summary?: string;
  content?: string;
}
export interface Universe extends Record<string, unknown> {
  id: string;
  name: string;
  created: string;
  updated: string;
  characters: Character[];
  locations: Location[];
  factions: Faction[];
  loreNotes: LoreNote[];
  relationships: RelationshipRecord[];
  generatorRuns: GeneratorRunMetadata[];
}
export interface AppState extends Record<string, unknown> {
  storageVersion: number;
  universes: Universe[];
  currentUniverseId: string | null;
}
export interface StorageChunkManifest {
  mode: "chunked-local";
  total: number;
  chunkSize: number;
  chunkCount: number;
  updated: string;
}
export interface StorageManifest {
  version: number;
  engine: "local chunk store";
  collections: Partial<Record<CollectionKey, StorageChunkManifest>>;
  updated: string;
}
export type CollectionKey =
  "characters" | "locations" | "factions" | "loreNotes" | "relationships";
export const COLLECTION_KEYS: readonly CollectionKey[] = [
  "characters",
  "locations",
  "factions",
  "loreNotes",
  "relationships",
];
export interface ValidationIssue {
  path: string;
  message: string;
  severity: "warning" | "error";
}
export interface SchemaDependencies {
  clock: Clock;
  ids: IdFactory;
}
export interface NormalizationResult {
  state: AppState;
  issues: ValidationIssue[];
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const entity = (
  value: unknown,
  deps: SchemaDependencies,
  prefix: string,
): EntityRecord => {
  const source = object(value);
  const now = deps.clock.nowIso();
  const created = string(source.created, now);
  return {
    ...source,
    id: string(source.id, deps.ids.next(prefix)),
    name: string(source.name, `Untitled ${prefix}`),
    description: string(source.description),
    tags: Array.isArray(source.tags)
      ? source.tags.join(", ")
      : string(source.tags),
    notes: string(source.notes),
    created,
    updated: string(source.updated, created),
  };
};

export const defaultAppState = (): AppState => ({
  storageVersion: CURRENT_SCHEMA_VERSION,
  universes: [],
  currentUniverseId: null,
});
export const normalizeAppState = (
  value: unknown,
  deps: SchemaDependencies,
): NormalizationResult => {
  const issues: ValidationIssue[] = [];
  const source = object(value);
  if (!Array.isArray(source.universes))
    issues.push({
      path: "universes",
      message: "Expected an array; recovered as empty.",
      severity: "error",
    });
  const universes = array(source.universes).flatMap(
    (raw, index): Universe[] => {
      if (Object.keys(object(raw)).length === 0) {
        issues.push({
          path: `universes[${index}]`,
          message: "Invalid universe record was not loaded.",
          severity: "error",
        });
        return [];
      }
      const univ = object(raw);
      const now = deps.clock.nowIso();
      const created = string(univ.created, now);
      const normalizeEntities = (
        key: CollectionKey,
        prefix: string,
      ): EntityRecord[] => {
        if (!Array.isArray(univ[key]))
          issues.push({
            path: `universes[${index}].${key}`,
            message: "Expected an array; recovered as empty.",
            severity: "warning",
          });
        return array(univ[key]).map((item) => entity(item, deps, prefix));
      };
      return [
        {
          ...univ,
          id: string(univ.id, deps.ids.next("universe")),
          name: string(univ.name, "Untitled Universe"),
          created,
          updated: string(univ.updated, created),
          characters: normalizeEntities(
            "characters",
            "character",
          ) as Character[],
          locations: normalizeEntities("locations", "location") as Location[],
          factions: normalizeEntities("factions", "faction") as Faction[],
          loreNotes: normalizeEntities("loreNotes", "lore") as LoreNote[],
          relationships: array(univ.relationships).map((item) =>
            normalizeRelationship(item, deps),
          ),
          generatorRuns: array(univ.generatorRuns).filter(
            (item) => Object.keys(object(item)).length > 0,
          ) as GeneratorRunMetadata[],
        },
      ];
    },
  );
  let currentUniverseId =
    typeof source.currentUniverseId === "string"
      ? source.currentUniverseId
      : null;
  if (
    currentUniverseId &&
    !universes.some((univ) => univ.id === currentUniverseId)
  ) {
    issues.push({
      path: "currentUniverseId",
      message: "Missing universe reference reset to first available universe.",
      severity: "warning",
    });
    currentUniverseId = universes[0]?.id ?? null;
  }
  return {
    state: {
      ...source,
      storageVersion: CURRENT_SCHEMA_VERSION,
      universes,
      currentUniverseId,
    },
    issues,
  };
};
export const validateAppState = (
  value: unknown,
  deps: SchemaDependencies,
): NormalizationResult => normalizeAppState(value, deps);
