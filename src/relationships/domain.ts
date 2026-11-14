import { systemClock, type Clock } from "../shared/clock.ts";
import type { IdFactory } from "../shared/id.ts";
import { CURRENT_SCHEMA_VERSION } from "../shared/schemaVersion.ts";

export const RELATIONSHIP_TYPES = [
  "Ally",
  "Enemy",
  "Family",
  "Member Of",
  "Leader Of",
  "Located In",
  "Controls",
  "Created By",
  "Rival",
  "Mentor",
  "Secret Connection",
  "Romantic",
  "Trade",
  "Cultural",
  "Religious",
  "Military",
  "Professional",
  "Friendship",
  "Neighbor",
  "Rivalry",
  "Custom",
] as const;
export const RELATIONSHIP_VISIBILITY_OPTIONS = [
  "Public",
  "Secret",
  "Rumored",
] as const;
export const RELATIONSHIP_STABILITY_OPTIONS = [
  "Stable",
  "Fragile",
  "Volatile",
] as const;
export const RELATIONSHIP_TONE_OPTIONS = [
  "Respect",
  "Loyalty",
  "Affection",
  "Admiration",
  "Fear",
  "Distrust",
  "Rivalry",
  "Hatred",
  "Obsession",
] as const;
export const RELATIONSHIP_STORY_LEVELS = [
  "Low",
  "Moderate",
  "High",
  "Very High",
] as const;
export const RELATIONSHIP_CATEGORY_DEFS = [
  "Allies",
  "Enemies",
  "Family",
  "Political",
  "Military",
  "Religious",
  "Mentorship",
  "Romantic",
  "Secret",
  "Custom",
].map((id) => ({ id, label: id })) as ReadonlyArray<{
  id: RelationshipCategory;
  label: string;
}>;

export type RelationshipVisibility =
  (typeof RELATIONSHIP_VISIBILITY_OPTIONS)[number];
export type RelationshipStability =
  (typeof RELATIONSHIP_STABILITY_OPTIONS)[number];
export type RelationshipTone = (typeof RELATIONSHIP_TONE_OPTIONS)[number];
export type RelationshipStoryLevel = (typeof RELATIONSHIP_STORY_LEVELS)[number];
export type RelationshipCategory =
  | "Allies"
  | "Enemies"
  | "Family"
  | "Political"
  | "Military"
  | "Religious"
  | "Mentorship"
  | "Romantic"
  | "Secret"
  | "Custom";

export interface RelationshipRecord extends Record<string, unknown> {
  id: string;
  sourceId: string;
  sourceType: string;
  targetId: string;
  targetType: string;
  type: string;
  description: string;
  importance: string;
  tags: string;
  strength?: number;
  influence?: number;
  visibility?: string;
  stability?: string;
  tone?: string;
  created?: string;
  updated?: string;
}

export interface RelationshipIntelligence {
  strength: number;
  influence: number;
  visibility: RelationshipVisibility;
  stability: RelationshipStability;
  tone: RelationshipTone;
  story: { label: RelationshipStoryLevel; score: number };
  categories: RelationshipCategory[];
  primaryCategory: RelationshipCategory;
}

export interface RelationshipIndex {
  version: number;
  total: number;
  byEntity: Record<string, string[]>;
  byType: Record<string, string[]>;
  byVisibility: Record<string, string[]>;
  byTone: Record<string, string[]>;
  highInfluence: string[];
  unstable: string[];
  secret: string[];
  updated: string;
}

const text = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.includes(value as T);
const clamp = (value: unknown, fallback = 5): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? fallback : Math.min(10, Math.max(1, parsed));
};

export const inferRelationshipStrength = (
  rel: Readonly<Record<string, unknown>>,
): number => {
  if (rel.strength !== undefined && rel.strength !== "")
    return clamp(rel.strength);
  const importance = text(rel.importance);
  if (importance.includes("high")) return 8;
  if (importance.includes("low")) return 3;
  if (
    [
      "Enemy",
      "Rival",
      "Rivalry",
      "Leader Of",
      "Secret Connection",
      "Family",
      "Romantic",
    ].includes(String(rel.type))
  )
    return 7;
  if (
    ["Ally", "Mentor", "Member Of", "Friendship", "Professional"].includes(
      String(rel.type),
    )
  )
    return 6;
  return 5;
};

export const inferRelationshipInfluence = (
  rel: Readonly<Record<string, unknown>>,
): number => {
  if (rel.influence !== undefined && rel.influence !== "")
    return clamp(rel.influence);
  const importance = text(rel.importance);
  if (importance.includes("high")) return 8;
  if (importance.includes("low")) return 3;
  if (
    ["Controls", "Leader Of", "Member Of", "Located In"].includes(
      String(rel.type),
    )
  )
    return 8;
  if (
    [
      "Enemy",
      "Rival",
      "Rivalry",
      "Secret Connection",
      "Military",
      "Trade",
    ].includes(String(rel.type))
  )
    return 7;
  if (["Ally", "Professional", "Cultural"].includes(String(rel.type))) return 6;
  return 4;
};

export const inferRelationshipVisibility = (
  rel: Readonly<Record<string, unknown>>,
): RelationshipVisibility => {
  if (isOneOf(RELATIONSHIP_VISIBILITY_OPTIONS, rel.visibility))
    return rel.visibility;
  const value = text([rel.type, rel.description, rel.tags].join(" "));
  if (
    rel.type === "Secret Connection" ||
    value.includes("secret") ||
    value.includes("hidden")
  )
    return "Secret";
  return value.includes("rumor") ||
    value.includes("rumour") ||
    value.includes("whisper")
    ? "Rumored"
    : "Public";
};

export const inferRelationshipStability = (
  rel: Readonly<Record<string, unknown>>,
): RelationshipStability => {
  if (isOneOf(RELATIONSHIP_STABILITY_OPTIONS, rel.stability))
    return rel.stability;
  if (["Enemy", "Rival", "Rivalry"].includes(String(rel.type)))
    return "Volatile";
  return ["Secret Connection", "Romantic", "Custom"].includes(String(rel.type))
    ? "Fragile"
    : "Stable";
};

export const inferRelationshipTone = (
  rel: Readonly<Record<string, unknown>>,
): RelationshipTone => {
  if (isOneOf(RELATIONSHIP_TONE_OPTIONS, rel.tone)) return rel.tone;
  if (rel.type === "Enemy") return "Hatred";
  if (["Rival", "Rivalry"].includes(String(rel.type))) return "Rivalry";
  if (rel.type === "Mentor") return "Admiration";
  if (
    ["Family", "Friendship", "Romantic", "Neighbor"].includes(String(rel.type))
  )
    return "Affection";
  if (
    [
      "Ally",
      "Member Of",
      "Leader Of",
      "Professional",
      "Trade",
      "Cultural",
      "Military",
      "Religious",
    ].includes(String(rel.type))
  )
    return "Loyalty";
  if (rel.type === "Secret Connection") return "Distrust";
  return rel.type === "Controls" ? "Fear" : "Respect";
};

export const calculateStoryPotential = (
  rel: Readonly<Record<string, unknown>>,
  intel: Pick<
    RelationshipIntelligence,
    "strength" | "influence" | "visibility" | "stability" | "tone"
  >,
): { label: RelationshipStoryLevel; score: number } => {
  let score =
    intel.strength >= 10
      ? 3
      : intel.strength >= 8
        ? 2
        : intel.strength >= 6
          ? 1
          : 0;
  score += intel.influence >= 8 ? 2 : intel.influence >= 6 ? 1 : 0;
  score +=
    intel.visibility === "Secret" ? 2 : intel.visibility === "Rumored" ? 1 : 0;
  score +=
    intel.stability === "Volatile" ? 2 : intel.stability === "Fragile" ? 1 : 0;
  if (["Enemy", "Rival", "Secret Connection"].includes(String(rel.type)))
    score += 2;
  if (
    ["Hatred", "Obsession", "Rivalry", "Fear", "Distrust"].includes(intel.tone)
  )
    score += 1;
  if (
    rel.type === "Ally" &&
    ["Distrust", "Fear", "Hatred"].includes(intel.tone)
  )
    score += 2;
  if (
    rel.type === "Enemy" &&
    ["Respect", "Affection", "Admiration"].includes(intel.tone)
  )
    score += 2;
  if (
    rel.type === "Family" &&
    ["Hatred", "Fear", "Distrust"].includes(intel.tone)
  )
    score += 2;
  return {
    label:
      score >= 10
        ? "Very High"
        : score >= 7
          ? "High"
          : score >= 4
            ? "Moderate"
            : "Low",
    score,
  };
};

export const getRelationshipCategories = (
  rel: Readonly<Record<string, unknown>>,
  intelligence?: RelationshipIntelligence,
): RelationshipCategory[] => {
  const intel = intelligence ?? getRelationshipIntelligence(rel);
  const value = text(
    [rel.type, rel.description, rel.tags, intel.tone, intel.visibility].join(
      " ",
    ),
  );
  const found = new Set<RelationshipCategory>();
  if (
    intel.visibility === "Secret" ||
    rel.type === "Secret Connection" ||
    value.includes("secret") ||
    value.includes("hidden")
  )
    found.add("Secret");
  if (rel.type === "Ally") found.add("Allies");
  if (["Enemy", "Rival", "Rivalry"].includes(String(rel.type)))
    found.add("Enemies");
  if (
    rel.type === "Family" ||
    ["marriage", "bloodline", "sibling"].some((term) => value.includes(term))
  )
    found.add("Family");
  if (rel.type === "Mentor") found.add("Mentorship");
  if (
    rel.type === "Romantic" ||
    ["romance", "romantic", "lover", "spouse"].some((term) =>
      value.includes(term),
    )
  )
    found.add("Romantic");
  if (
    rel.type === "Military" ||
    ["military", "army", "navy", "guard", "legion"].some((term) =>
      value.includes(term),
    )
  )
    found.add("Military");
  if (
    rel.type === "Religious" ||
    ["religion", "religious", "temple", "church", "cult", "faith"].some(
      (term) => value.includes(term),
    )
  )
    found.add("Religious");
  if (
    [
      "Member Of",
      "Leader Of",
      "Controls",
      "Located In",
      "Professional",
      "Trade",
      "Cultural",
    ].includes(String(rel.type)) ||
    ["politic", "senate", "council"].some((term) => value.includes(term))
  )
    found.add("Political");
  if (found.size === 0 || rel.type === "Custom") found.add("Custom");
  return RELATIONSHIP_CATEGORY_DEFS.map((def) => def.id).filter((category) =>
    found.has(category),
  );
};

export const getRelationshipIntelligence = (
  rel: Readonly<Record<string, unknown>>,
): RelationshipIntelligence => {
  const base = {
    strength: inferRelationshipStrength(rel),
    influence: inferRelationshipInfluence(rel),
    visibility: inferRelationshipVisibility(rel),
    stability: inferRelationshipStability(rel),
    tone: inferRelationshipTone(rel),
  };
  const story = calculateStoryPotential(rel, base);
  const provisional: RelationshipIntelligence = {
    ...base,
    story,
    categories: [],
    primaryCategory: "Custom",
  };
  const categories = getRelationshipCategories(rel, provisional);
  return {
    ...provisional,
    categories,
    primaryCategory: categories[0] ?? "Custom",
  };
};

export interface RelationshipNormalizationDependencies {
  ids: IdFactory;
  clock: Clock;
}
export const normalizeRelationship = (
  input: unknown,
  dependencies: RelationshipNormalizationDependencies,
): RelationshipRecord => {
  const source =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const now = dependencies.clock.nowIso();
  const created =
    typeof source.created === "string" && source.created ? source.created : now;
  const rel: RelationshipRecord = {
    ...source,
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : dependencies.ids.next("relationship"),
    sourceId: typeof source.sourceId === "string" ? source.sourceId : "",
    sourceType:
      typeof source.sourceType === "string" ? source.sourceType : "Character",
    targetId: typeof source.targetId === "string" ? source.targetId : "",
    targetType:
      typeof source.targetType === "string" ? source.targetType : "Character",
    type:
      typeof source.type === "string" && source.type ? source.type : "Custom",
    description:
      typeof source.description === "string" ? source.description : "",
    importance: typeof source.importance === "string" ? source.importance : "",
    tags:
      typeof source.tags === "string"
        ? source.tags
        : Array.isArray(source.tags)
          ? source.tags.join(", ")
          : "",
    created,
    updated:
      typeof source.updated === "string" && source.updated
        ? source.updated
        : created,
  };
  return {
    ...rel,
    strength: inferRelationshipStrength(rel),
    influence: inferRelationshipInfluence(rel),
    visibility: inferRelationshipVisibility(rel),
    stability: inferRelationshipStability(rel),
    tone: inferRelationshipTone(rel),
  };
};

const push = (
  index: Record<string, string[]>,
  key: unknown,
  id: string,
): void => {
  const safe = typeof key === "string" && key ? key : "Unknown";
  (index[safe] ??= []).push(id);
};
export const buildRelationshipIndex = (
  relationships: readonly RelationshipRecord[] = [],
  clock: Clock = systemClock,
): RelationshipIndex => {
  const index: RelationshipIndex = {
    version: CURRENT_SCHEMA_VERSION,
    total: relationships.length,
    byEntity: {},
    byType: {},
    byVisibility: {},
    byTone: {},
    highInfluence: [],
    unstable: [],
    secret: [],
    updated: clock.nowIso(),
  };
  for (const rel of relationships) {
    const intel = getRelationshipIntelligence(rel);
    push(index.byEntity, rel.sourceId, rel.id);
    push(index.byEntity, rel.targetId, rel.id);
    push(index.byType, rel.type, rel.id);
    push(index.byVisibility, intel.visibility, rel.id);
    push(index.byTone, intel.tone, rel.id);
    if (intel.influence >= 8) index.highInfluence.push(rel.id);
    if (intel.stability !== "Stable" || intel.story.score >= 7)
      index.unstable.push(rel.id);
    if (intel.visibility === "Secret") index.secret.push(rel.id);
  }
  return index;
};

export interface PathEdge {
  nextId: string;
  rel: RelationshipRecord;
}
export const buildPathfindingInputs = (
  relationships: readonly RelationshipRecord[],
): Readonly<Record<string, PathEdge[]>> => {
  const adjacency: Record<string, PathEdge[]> = {};
  for (const rel of relationships) {
    (adjacency[rel.sourceId] ??= []).push({ nextId: rel.targetId, rel });
    (adjacency[rel.targetId] ??= []).push({ nextId: rel.sourceId, rel });
  }
  return adjacency;
};
export const findShortestRelationshipPath = (
  relationships: readonly RelationshipRecord[],
  sourceId: string,
  targetId: string,
): PathEdge[] | null => {
  if (!sourceId || !targetId || sourceId === targetId) return [];
  const adjacency = buildPathfindingInputs(relationships);
  const queue: Array<{ id: string; path: PathEdge[] }> = [
    { id: sourceId, path: [] },
  ];
  const visited = new Set([sourceId]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const edge of adjacency[current.id] ?? []) {
      if (visited.has(edge.nextId)) continue;
      const path = [...current.path, edge];
      if (edge.nextId === targetId) return path;
      visited.add(edge.nextId);
      queue.push({ id: edge.nextId, path });
    }
  }
  return null;
};
