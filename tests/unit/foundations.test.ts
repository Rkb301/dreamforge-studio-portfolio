import { describe, expect, it } from "vitest";
import {
  createGenerationContext,
  validateGeneratedPackageBoundary,
} from "../../src/generation/context.ts";
import { normalizeAppState } from "../../src/domain/schema.ts";
import { migrateToCurrentSchema } from "../../src/domain/migrations.ts";
import { FixedClock } from "../../src/shared/clock.ts";
import { StableIdFactory } from "../../src/shared/id.ts";
import { SeededRandom } from "../../src/shared/random.ts";
import { malformedParseable } from "../fixtures/states.ts";

describe("shared foundations and schemas", () => {
  it("provides deterministic clocks and IDs", () => {
    const clock = new FixedClock("2026-02-03T04:05:06Z");
    const ids = new StableIdFactory("fixture");
    expect(clock.nowIso()).toBe("2026-02-03T04:05:06.000Z");
    expect(ids.next()).toBe("id-fixture-0001");
  });
  it("provides repeatable seeded random sequences", () => {
    const left = new SeededRandom("seed");
    const right = new SeededRandom("seed");
    expect([left.next(), left.next(), left.integer(1, 10)]).toEqual([
      right.next(),
      right.next(),
      right.integer(1, 10),
    ]);
  });
  it("records deterministic generation metadata", () => {
    const context = createGenerationContext({
      seed: "town-1",
      generatorVersion: "test",
      inputPrompt: "one town",
      settings: {},
      clock: new FixedClock("2026-01-01Z"),
      ids: new StableIdFactory(),
    });
    expect(context.metadata).toMatchObject({
      seed: "town-1",
      inputPrompt: "one town",
      determinism: "seeded-extracted-path",
    });
    expect(context.random.next()).toBe(new SeededRandom("town-1").next());
  });
  it("validates generator package boundaries", () => {
    expect(
      validateGeneratedPackageBoundary({
        factions: [],
        characters: [],
        locations: [],
        loreNotes: [],
        relationships: [],
      }),
    ).toBe(true);
    expect(validateGeneratedPackageBoundary({ characters: [] })).toBe(false);
  });
  it("migrates legacy schema in order", () =>
    expect(migrateToCurrentSchema({ universes: [] })).toMatchObject({
      value: { storageVersion: 3 },
      applied: expect.arrayContaining([
        "2-to-3: add generator-run metadata and rebuildable projections",
      ]),
    }));
  it("normalizes malformed but parseable data with visible issues", () => {
    const result = normalizeAppState(malformedParseable, {
      clock: new FixedClock("2026-01-01Z"),
      ids: new StableIdFactory(),
    });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.state.universes[0]?.characters).toEqual([]);
  });
});
