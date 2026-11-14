import { describe, expect, it } from "vitest";
import { FixedClock } from "../../src/shared/clock.ts";
import { StableIdFactory } from "../../src/shared/id.ts";
import {
  buildPathfindingInputs,
  buildRelationshipIndex,
  calculateStoryPotential,
  findShortestRelationshipPath,
  getRelationshipIntelligence,
  inferRelationshipInfluence,
  inferRelationshipStability,
  inferRelationshipStrength,
  inferRelationshipTone,
  inferRelationshipVisibility,
  normalizeRelationship,
  type RelationshipRecord,
} from "../../src/relationships/domain.ts";

const rel = (
  overrides: Partial<RelationshipRecord> = {},
): RelationshipRecord => ({
  id: "r1",
  sourceId: "a",
  sourceType: "Character",
  targetId: "b",
  targetType: "Character",
  type: "Ally",
  description: "",
  importance: "",
  tags: "",
  ...overrides,
});
describe("relationship domain", () => {
  it("normalizes legacy relationships with stable dependencies", () =>
    expect(
      normalizeRelationship(
        { type: "Enemy" },
        {
          clock: new FixedClock("2026-01-01T00:00:00Z"),
          ids: new StableIdFactory(),
        },
      ),
    ).toMatchObject({
      id: "relationship-test-0001",
      visibility: "Public",
      stability: "Volatile",
      tone: "Hatred",
    }));
  it("infers visibility", () => {
    expect(inferRelationshipVisibility(rel({ tags: "hidden pact" }))).toBe(
      "Secret",
    );
    expect(
      inferRelationshipVisibility(rel({ description: "whispered rumor" })),
    ).toBe("Rumored");
    expect(inferRelationshipVisibility(rel())).toBe("Public");
  });
  it("infers stability", () => {
    expect(inferRelationshipStability(rel({ type: "Enemy" }))).toBe("Volatile");
    expect(inferRelationshipStability(rel({ type: "Romantic" }))).toBe(
      "Fragile",
    );
    expect(inferRelationshipStability(rel())).toBe("Stable");
  });
  it("infers tone", () => {
    expect(inferRelationshipTone(rel({ type: "Mentor" }))).toBe("Admiration");
    expect(inferRelationshipTone(rel({ type: "Controls" }))).toBe("Fear");
  });
  it("infers and clamps strength", () => {
    expect(inferRelationshipStrength(rel({ importance: "High" }))).toBe(8);
    expect(inferRelationshipStrength(rel({ strength: 99 }))).toBe(10);
  });
  it("infers influence", () =>
    expect(inferRelationshipInfluence(rel({ type: "Controls" }))).toBe(8));
  it("scores story potential", () =>
    expect(
      calculateStoryPotential(rel({ type: "Enemy" }), {
        strength: 10,
        influence: 9,
        visibility: "Secret",
        stability: "Volatile",
        tone: "Hatred",
      }).label,
    ).toBe("Very High"));
  it("builds complete intelligence", () =>
    expect(
      getRelationshipIntelligence(rel({ type: "Secret Connection" })),
    ).toMatchObject({
      visibility: "Secret",
      stability: "Fragile",
      tone: "Distrust",
    }));
  it("constructs rebuildable indexes deterministically", () =>
    expect(
      buildRelationshipIndex([rel()], new FixedClock("2026-01-01T00:00:00Z")),
    ).toMatchObject({
      total: 1,
      byEntity: { a: ["r1"], b: ["r1"] },
      updated: "2026-01-01T00:00:00.000Z",
    }));
  it("builds undirected path inputs", () =>
    expect(buildPathfindingInputs([rel()]).b?.[0]?.nextId).toBe("a"));
  it("finds shortest paths", () => {
    const relationships = [
      rel(),
      rel({ id: "r2", sourceId: "b", targetId: "c" }),
    ];
    expect(findShortestRelationshipPath(relationships, "a", "c")).toHaveLength(
      2,
    );
  });
});
