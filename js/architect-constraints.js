import { generateWorld } from "./world-engine.js";

const wordNumbers = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const numberPattern =
  "(\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)";
const countIn = (prompt, noun) => {
  const match = prompt.match(
    new RegExp(
      `\\b(?:exactly\\s+)?${numberPattern}\\s+(?:small\\s+|named\\s+)?${noun}\\b`,
      "i",
    ),
  );
  return match
    ? (wordNumbers[match[1].toLowerCase()] ?? Number(match[1]))
    : null;
};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (text) => String(text ?? "").trim();

// Deliberately bounded grammar. The editable review, rather than inferred prose,
// is the generation contract. Nothing here promises general language understanding.
export function reviewArchitectBrief(prompt) {
  const place = prompt.match(/\b(village|hamlet|town|settlement|city)\b/i);
  const broad =
    /\b(?:civilization|empire|galactic|galaxy|countries|continents|planets|solar system)\b/i.test(
      prompt,
    );
  const name = prompt.match(
    /\b(?:village|hamlet|town|settlement|city)\s+(?:called|named|of)\s+([^.!?:;,\n]+?)(?=\s+(?:and|with|where)\b|[.!?:;,\n]|$)/i,
  )?.[1];
  const species =
    /\b(?:all(?:\s+are)?\s+human|humans?\s+only|only\s+humans?)\b/i.test(prompt)
      ? "Human"
      : prompt.match(
          /\b(?:all(?:\s+are)?\s+|only\s+)(elves|dwarves|cats|vampires|robots)\b/i,
        )?.[1] ||
        prompt.match(/\b(cat|vampire|robot|elf|dwarf)-only\b/i)?.[1] ||
        "Unspecified";
  const cast = [];
  const castBrief =
    prompt.match(/\bcharacters?\b[^.!?\n:]*:\s*([^.!?\n]+)/i)?.[1] || "";
  const pairs =
    /(?:^|[,:;]\s*(?:and\s+)?|\band\s+)([\p{L}][\p{L}'’ -]{0,60}?)\s+the\s+([\p{L}][\p{L}'’ -]{0,60}?)(?=\s*(?:[,;.\n]|$|\band\s+[\p{L}][\p{L}'’ -]{0,60}\s+the\s+))/giu;
  for (const match of castBrief.matchAll(pairs)) {
    const characterName = clean(match[1]);
    if (
      !cast.some(
        (person) => person.name.toLowerCase() === characterName.toLowerCase(),
      )
    )
      cast.push({
        name: characterName,
        role: clean(match[2]),
        species,
        goal: "",
      });
  }
  const names = cast.map((person) => escapeRegex(person.name)).join("|");
  for (const person of cast) {
    const stance = prompt.match(
      new RegExp(
        `\\b${escapeRegex(person.name)}\\s+(wants|needs|seeks|opposes|supports|hopes|prefers)\\b\\s+(.+?)(?=\\s*(?:,?\\s+(?:and\\s+)?(?:${names})\\s+(?:wants|needs|seeks|opposes|supports|hopes|prefers)\\b|[.!?\\n]|$))`,
        "i",
      ),
    );
    if (stance)
      person.goal = `${stance[1]} ${clean(stance[2]).replace(/,$/, "")}`;
  }
  const conflict =
    prompt.match(
      /\b(?:disagreement|dispute|conflict|tension)\s*(?::|over\b|about\b)\s*([^.!?\n]+)/i,
    )?.[1] || "";
  const requestedCount = countIn(prompt, "characters?");
  const characterCount = requestedCount ?? (cast.length || 3);
  if (!cast.length && characterCount <= 50)
    for (let index = 0; index < characterCount; index++)
      cast.push({
        name: `Resident ${index + 1}`,
        role: "Unspecified",
        species,
        goal: "",
      });
  const warnings = [];
  const placeCount = countIn(
    prompt,
    "(?:villages?|hamlets?|towns?|settlements?|cities)",
  );
  if (placeCount !== null && placeCount !== 1)
    warnings.push(
      "Compact scope supports exactly one settlement. Choose the larger-world seeder for multiple places.",
    );
  const conflictCount =
    countIn(prompt, "(?:disagreements?|disputes?|conflicts?)") ??
    (conflict ? 1 : 0);
  if (conflictCount > 1)
    warnings.push(
      "Compact scope supports at most one conflict. Choose one central conflict below or use the larger-world seeder.",
    );
  if (!name)
    warnings.push(
      "No settlement name was recognized. Edit the placeholder before generating.",
    );
  if (species === "Unspecified")
    warnings.push(
      "Species was not recognized. Review the species field and cast.",
    );
  if (cast.some((person) => person.name.startsWith("Resident ")))
    warnings.push(
      "Names and roles were not recognized. Placeholder residents are editable below.",
    );
  if (cast.length !== characterCount)
    warnings.push(
      "The requested character count and recognized cast differ. Correct the count or cast before generating.",
    );
  if (conflict && !cast.some((person) => person.goal))
    warnings.push(
      "Character positions in the dispute were not recognized. Add them in the cast's Goal column if needed.",
    );
  return {
    scope: place && !broad ? "settlement" : "legacy",
    settlementType: place?.[1].toLowerCase() || "settlement",
    name: clean(name) || "Untitled settlement",
    characterCount,
    species,
    magicMode: /\b(?:no magic|without magic|magic-free)\b/i.test(prompt)
      ? "No magic"
      : "Unspecified; follow the author brief",
    conflictCount,
    conflict: clean(conflict),
    cast,
    warnings,
  };
}

export const castToText = (cast) =>
  cast
    .map((person) =>
      [person.name, person.role, person.species, person.goal].join(" | "),
    )
    .join("\n");
export function castFromText(text, species) {
  return clean(text)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const values = line.split("|").map(clean);
      if (values.length < 2 || values.length > 4)
        throw Error(
          "Use one character per line: Name | Role | Species | Goal. Do not use | inside a field.",
        );
      return {
        name: values[0],
        role: values[1],
        species: values[2] || species,
        goal: values[3] || "",
      };
    });
}

export function validateSettlementConstraints(constraints) {
  const c = structuredClone(constraints);
  if (c.scope !== "settlement")
    throw Error("Choose the compact settlement scope.");
  for (const key of [
    "name",
    "settlementType",
    "species",
    "magicMode",
    "conflict",
  ])
    c[key] = clean(c[key]);
  if (!c.name || c.name.length > 120)
    throw Error("Give the settlement a name of 1–120 characters.");
  if (
    !["village", "hamlet", "town", "settlement", "city"].includes(
      c.settlementType,
    )
  )
    throw Error("Choose a supported settlement type.");
  if (
    !Number.isInteger(c.characterCount) ||
    c.characterCount < 0 ||
    c.characterCount > 50
  )
    throw Error(
      "Compact drafts support 0–50 characters. Use the larger-world seeder for populations.",
    );
  if (!Array.isArray(c.cast) || c.cast.length !== c.characterCount)
    throw Error(
      `The cast must contain exactly ${c.characterCount} characters. Edit the count or cast.`,
    );
  if (!c.species || c.species.length > 100)
    throw Error("Review the default species (1–100 characters).");
  const seen = new Set();
  for (const person of c.cast) {
    for (const key of ["name", "role", "species", "goal"])
      person[key] = clean(person[key]);
    person.species ||= c.species;
    if (
      !person.name ||
      !person.role ||
      person.name.length > 120 ||
      person.role.length > 120 ||
      person.species.length > 100 ||
      person.goal.length > 1000
    )
      throw Error(
        "Each character needs a name, role and species. Keep names/roles under 120 characters and goals under 1,000.",
      );
    if (
      seen.has(person.name.toLowerCase()) ||
      person.name.toLowerCase() === c.name.toLowerCase()
    )
      throw Error("Use distinct names for each character and the settlement.");
    seen.add(person.name.toLowerCase());
  }
  if (![0, 1].includes(c.conflictCount))
    throw Error(
      "Compact drafts support zero or one central conflict. Edit this constraint or choose the larger-world seeder.",
    );
  if (c.conflictCount === 1 && !c.conflict)
    throw Error(
      "Describe the central conflict, or set the conflict count to zero.",
    );
  if (c.conflictCount === 0 && c.conflict)
    throw Error(
      "Remove the conflict description or set the conflict count to one.",
    );
  if (c.conflict.length > 2000 || c.magicMode.length > 500)
    throw Error(
      "Keep the conflict under 2,000 characters and magic rule under 500.",
    );
  return c;
}

export function generateArchitectDraft(prompt, universe, profile, constraints) {
  if (!constraints || constraints.scope === "legacy")
    return generateWorld(prompt, universe, profile);
  const c = validateSettlementConstraints(constraints);
  const now = new Date().toISOString();
  const entity = (name, description, fields = {}) => ({
    id: crypto.randomUUID(),
    name,
    description,
    tags: "compact settlement",
    notes: "",
    created: now,
    updated: now,
    canon: "draft",
    ...fields,
  });
  const place = entity(
    c.name,
    `A ${c.settlementType}. Magic rule: ${c.magicMode}.\nAuthor brief: ${prompt}`,
    { region: "Local", importance: "Central setting", associatedFactions: [] },
  );
  const characters = c.cast.map((person) =>
    entity(
      person.name,
      `${person.name} is the ${person.role} in ${c.name}.${person.goal ? ` ${person.name} ${person.goal}.` : ""}`,
      {
        role: person.role,
        species: person.species,
        goals: person.goal,
        personality: "",
        secrets: "",
      },
    ),
  );
  const conflict = c.conflictCount
    ? entity("Central disagreement", c.conflict, {
        category: "Conflict",
        summary: c.conflict,
        content: [
          c.conflict,
          ...c.cast
            .filter((person) => person.goal)
            .map((person) => `${person.name} ${person.goal}.`),
        ].join("\n"),
      })
    : null;
  const relationship = (person, target, targetType, type, description) => ({
    id: crypto.randomUUID(),
    sourceId: person.id,
    sourceType: "characters",
    targetId: target.id,
    targetType,
    type,
    description,
    importance: "Moderate",
    tags: "compact settlement",
    strength: 5,
    influence: 5,
    visibility: "Public",
    stability: "Stable",
    created: now,
    updated: now,
  });
  const relationships = characters.flatMap((person) => [
    relationship(
      person,
      place,
      "locations",
      "Located In",
      `${person.name} lives in ${c.name}.`,
    ),
    ...(conflict
      ? [
          relationship(
            person,
            conflict,
            "loreNotes",
            "Custom",
            `${person.name} is part of the central disagreement.${person.goals ? ` Position: ${person.goals}.` : " Position not specified."}`,
          ),
        ]
      : []),
  ]);
  return {
    characters,
    locations: [place],
    factions: [],
    loreNotes: [],
    conflicts: conflict ? [conflict] : [],
    mysteries: [],
    relationships,
    analysis: {
      originalPrompt: prompt,
      scale: "settlement",
      scaleLabel: `Compact ${c.settlementType}`,
      speciesLabel: c.species,
      magicMode: c.magicMode,
      blueprint: {
        characters: characters.length,
        locations: 1,
        conflicts: c.conflictCount,
        relationships: relationships.length,
      },
      validationWarnings: [
        "Compact seeding follows your reviewed fields. Other instructions are retained in the settlement's author brief; they are not automatically interpreted. Review the draft before approval.",
      ],
    },
    generationRunMetadata: {
      id: crypto.randomUUID(),
      seed: "reviewed-constraints",
      timestamp: now,
      generatorVersion: "dreamforge-compact-settlement-v1",
      inputPrompt: prompt,
      settings: { profileOverride: profile, constraints: c },
      determinism: "legacy-boundary-only",
    },
  };
}
