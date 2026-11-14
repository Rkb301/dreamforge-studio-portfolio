import type { Clock } from "../shared/clock.ts";
import type { IdFactory } from "../shared/id.ts";
import { SeededRandom, type RandomSource } from "../shared/random.ts";

export interface GeneratorRunMetadata {
  id: string;
  seed: string;
  timestamp: string;
  generatorVersion: string;
  inputPrompt: string;
  settings: Readonly<Record<string, unknown>>;
  determinism: "seeded-extracted-path" | "legacy-boundary-only";
}

export interface GenerationContext {
  metadata: GeneratorRunMetadata;
  clock: Clock;
  ids: IdFactory;
  random: RandomSource;
}

export interface GenerationContextInput {
  seed: string;
  generatorVersion: string;
  inputPrompt: string;
  settings: Readonly<Record<string, unknown>>;
  determinism?: GeneratorRunMetadata["determinism"];
  clock: Clock;
  ids: IdFactory;
}

export const createGenerationContext = (
  input: GenerationContextInput,
): GenerationContext => ({
  metadata: {
    id: input.ids.next("generation"),
    seed: input.seed,
    timestamp: input.clock.nowIso(),
    generatorVersion: input.generatorVersion,
    inputPrompt: input.inputPrompt,
    settings: input.settings,
    determinism: input.determinism ?? "seeded-extracted-path",
  },
  clock: input.clock,
  ids: input.ids,
  random: new SeededRandom(input.seed),
});

export interface GeneratedPackageBoundary {
  factions: unknown[];
  characters: unknown[];
  locations: unknown[];
  loreNotes: unknown[];
  relationships: unknown[];
}

export const validateGeneratedPackageBoundary = (
  value: unknown,
): value is GeneratedPackageBoundary => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return [
    "factions",
    "characters",
    "locations",
    "loreNotes",
    "relationships",
  ].every((key) => Array.isArray(candidate[key]));
};
