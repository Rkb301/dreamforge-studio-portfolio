import { describe, expect, it } from "vitest";
import {
  castFromText,
  castToText,
  generateArchitectDraft,
  reviewArchitectBrief,
  validateSettlementConstraints,
} from "../../js/architect-constraints.js";

export const villagePrompt =
  "Create exactly 1 small village called Willowford and exactly 3 characters, all human: Mara the miller, Tovin the farmer, and Elin the mediator. Include exactly 1 disagreement: whether to divert the river to the mill. Mara wants more power, Tovin needs irrigation, and Elin wants a compromise. No magic. Keep the setting grounded and local. Generate only this village, these three characters, and this disagreement.";
const world = () => ({
  id: "test-world",
  name: "Disposable world",
  characters: [],
  locations: [],
  factions: [],
  loreNotes: [],
  relationships: [],
});

describe("reviewed compact Architect constraints", () => {
  it("recognizes the supplied village, human cast, roles and individual stakes", () => {
    const c = reviewArchitectBrief(villagePrompt);
    expect(c).toMatchObject({
      scope: "settlement",
      name: "Willowford",
      characterCount: 3,
      species: "Human",
      magicMode: "No magic",
      conflictCount: 1,
      conflict: "whether to divert the river to the mill",
    });
    expect(c.cast).toEqual([
      {
        name: "Mara",
        role: "miller",
        species: "Human",
        goal: "wants more power",
      },
      {
        name: "Tovin",
        role: "farmer",
        species: "Human",
        goal: "needs irrigation",
      },
      {
        name: "Elin",
        role: "mediator",
        species: "Human",
        goal: "wants a compromise",
      },
    ]);
  });
  it("creates exactly the reviewed people/place/dispute without mutating the destination", () => {
    const destination = world(),
      before = structuredClone(destination);
    const draft = generateArchitectDraft(
      villagePrompt,
      destination,
      "massive",
      reviewArchitectBrief(villagePrompt),
    );
    expect(destination).toEqual(before);
    expect(draft.locations.map((place) => place.name)).toEqual(["Willowford"]);
    expect(draft.characters.map((person) => person.name)).toEqual([
      "Mara",
      "Tovin",
      "Elin",
    ]);
    expect(draft.characters.every((person) => person.species === "Human")).toBe(
      true,
    );
    expect(draft.conflicts).toHaveLength(1);
    expect(draft.conflicts[0].content).toContain("Tovin needs irrigation");
    expect(draft.factions).toEqual([]);
    expect(draft.mysteries).toEqual([]);
    expect(draft.loreNotes).toEqual([]);
    const ids = new Set(
      [...draft.locations, ...draft.characters, ...draft.conflicts].map(
        (entry) => entry.id,
      ),
    );
    expect(draft.relationships).toHaveLength(6);
    expect(
      draft.relationships.every(
        (relation) => ids.has(relation.sourceId) && ids.has(relation.targetId),
      ),
    ).toBe(true);
    expect(draft.analysis.validationWarnings.join(" ")).toContain(
      "not automatically interpreted",
    );
  });
  it("generalizes to alternate names, a town, word counts and a different dispute", () => {
    const prompt =
      "Create one town called Brackenport with exactly two characters, all human: Isha the baker and Ren the ferryman. Include one dispute over opening the bridge. Isha supports trade, and Ren opposes tolls. No magic.";
    const c = reviewArchitectBrief(prompt),
      draft = generateArchitectDraft(prompt, world(), "", c);
    expect(c).toMatchObject({
      name: "Brackenport",
      settlementType: "town",
      characterCount: 2,
      conflictCount: 1,
    });
    expect(
      draft.characters.map((person) => [
        person.name,
        person.role,
        person.goals,
      ]),
    ).toEqual([
      ["Isha", "baker", "supports trade"],
      ["Ren", "ferryman", "opposes tolls"],
    ]);
    expect(draft.conflicts[0].content).toContain("opening the bridge");
  });
  it("applies edited names, species and zero-conflict count, allowing a place-only draft", () => {
    const c = {
      ...reviewArchitectBrief(villagePrompt),
      name: "Cedar Hollow",
      characterCount: 0,
      cast: [],
      species: "Elf",
      conflictCount: 0,
      conflict: "",
    };
    const draft = generateArchitectDraft(villagePrompt, world(), "", c);
    expect(draft.characters).toEqual([]);
    expect(draft.conflicts).toEqual([]);
    expect(draft.relationships).toEqual([]);
    expect(draft.locations[0].name).toBe("Cedar Hollow");
    const cast = castFromText(
      "Ayla | keeper | | protects the grove\nBorin | scout | Dwarf | seeks a trail",
      "Elf",
    );
    expect(cast[0].species).toBe("Elf");
    expect(cast[1].species).toBe("Dwarf");
    expect(castFromText(castToText(cast), "Elf")).toEqual(cast);
  });
  it.each([
    [{ characterCount: 2 }, /exactly 2/],
    [{ characterCount: 51 }, /0–50/],
    [{ characterCount: 1.5 }, /0–50/],
    [{ conflict: "" }, /Describe the central conflict/],
    [{ conflictCount: 2 }, /zero or one/],
    [{ conflictCount: 0 }, /Remove the conflict/],
    [{ name: "" }, /settlement a name/],
    [
      {
        cast: [
          { name: "Same", role: "keeper", species: "Human" },
          { name: "same", role: "scout", species: "Human" },
          { name: "Other", role: "farmer", species: "Human" },
        ],
      },
      /distinct names/,
    ],
  ])("blocks contradictory or unsupported constraints %j", (changes, error) => {
    expect(() =>
      validateSettlementConstraints({
        ...reviewArchitectBrief(villagePrompt),
        ...changes,
      }),
    ).toThrow(error);
  });
  it("requires edits for unrecognized cast syntax rather than pretending to understand", () => {
    const c = reviewArchitectBrief(
      "A village called Lowmoor with 2 characters: Jun, Ko. They disagree about everything.",
    );
    expect(c.cast.map((person) => person.name)).toEqual([
      "Resident 1",
      "Resident 2",
    ]);
    expect(c.warnings.join(" ")).toContain("not recognized");
    expect(() => castFromText("Unstructured line", "Human")).toThrow(
      /one character per line/,
    );
  });
  it("keeps explicitly larger scales on the existing seeder", () => {
    for (const prompt of [
      "A Type II civilization with exactly 5000 citizens, no magic",
      "An empire with 12 characters and a village",
      "A galaxy with 5 planets",
    ])
      expect(reviewArchitectBrief(prompt).scope).toBe("legacy");
    const draft = generateArchitectDraft(
      "A city with exactly 4 characters, no magic",
      world(),
      "minimal",
      { scope: "legacy" },
    );
    expect(draft.characters).toHaveLength(4);
    expect(draft.generationRunMetadata.generatorVersion).toBe(
      "dreamforge-world-seeder-v0.3.4",
    );
  });
});
