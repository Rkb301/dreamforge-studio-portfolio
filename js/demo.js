export function exampleWorld() {
  const now = new Date().toISOString();
  const entity = (id, name, description, extra = {}) => ({
    id,
    name,
    description,
    created: now,
    updated: now,
    tags: "Orrery of Tides",
    notes: "",
    ...extra,
  });
  return {
    id: crypto.randomUUID(),
    name: "The Orrery of Tides",
    created: now,
    updated: now,
    premise:
      "An ocean moon. A city held above the tide by a failing machine. Seven nights until the sea remembers what was taken from it.",
    genre: "Science fantasy",
    rules:
      "The tide follows the moon’s buried engine, not gravity. Memories can power the engine, but a spent memory cannot be recovered. No one can predict which memory it will take.",
    goals: [
      {
        id: "g1",
        text: "Decide what the city is willing to forget to survive.",
        done: false,
      },
      {
        id: "g2",
        text: "Connect the missing cartographer to the engine’s origin.",
        done: false,
      },
      {
        id: "g3",
        text: "Establish the cost of memory-powered technology.",
        done: true,
      },
    ],
    characters: [
      entity(
        "c1",
        "Mara Vey",
        "Keeper of the tide engine. Mara knows the machine is failing because it has started returning memories instead of consuming them.",
        {
          role: "The reluctant keeper",
          species: "Human",
          personality: "Precise in public; superstitious when alone.",
          goals: "Keep the city afloat without sacrificing another childhood.",
          secrets: "The voice inside the engine is her mother’s.",
          canon: "canon",
        },
      ),
      entity(
        "c2",
        "Ilan Sorell",
        "A cartographer who maps places erased from collective memory. His newest map shows a staircase beneath the tide.",
        {
          role: "The missing cartographer",
          species: "Human",
          goals: "Find the city that existed before the Orrery.",
          secrets: "He remembers Mara’s mother, though they never met.",
          canon: "canon",
        },
      ),
      entity(
        "c3",
        "Vesper Nine",
        "An emissary assembled from nine donated memories. Every night, a different donor chooses where Vesper walks.",
        {
          role: "The divided emissary",
          species: "Memory construct",
          goals: "Make one decision that belongs to no donor.",
          canon: "draft",
        },
      ),
      entity(
        "c4",
        "Captain Eda Rook",
        "Captain of the last salvage vessel permitted beyond the lantern buoys. She brings back objects still warm from houses that sank a century ago.",
        {
          role: "The salvage captain",
          species: "Human",
          goals: "Bring her crew home before the seventh tide.",
          canon: "canon",
        },
      ),
    ],
    locations: [
      entity(
        "l1",
        "The Orrery",
        "A city of brass bridges and salt-dark observatories, suspended above a moon-wide ocean.",
        { region: "The upper tide", importance: "Capital", canon: "canon" },
      ),
      entity(
        "l2",
        "The Drowned Archive",
        "A library below the waterline whose books remember their readers. Its doors open only during the lowest tide.",
        {
          region: "Below the city",
          importance: "Lost history",
          canon: "canon",
        },
      ),
      entity(
        "l3",
        "Lantern Quay",
        "A harbor of floating lanterns. Each light marks someone the city has forgotten.",
        {
          region: "The lower ring",
          importance: "Trade and remembrance",
          canon: "canon",
        },
      ),
      entity(
        "l4",
        "The Tide Engine",
        "A silent sphere at the heart of the city. Recently, it has begun to hum the same lullaby in every language.",
        { region: "Orrery core", importance: "Survival", canon: "canon" },
      ),
    ],
    factions: [
      entity(
        "f1",
        "The Keepers of Brass",
        "Engine custodians sworn to publish the true cost of every tide. Their last three ledgers are missing.",
        {
          leader: "Mara Vey",
          ideology: "No survival without an accounting.",
          goals: "Repair the engine.",
          canon: "canon",
        },
      ),
      entity(
        "f2",
        "The Salt Assembly",
        "Elected delegates of the lower ring, whose homes flood first and whose memories pay the highest price.",
        {
          ideology: "The cost must be shared.",
          goals: "Suspend compulsory memory tithes.",
          canon: "canon",
        },
      ),
      entity(
        "f3",
        "The Ninth Choir",
        "A clandestine circle that believes the returned memories are messages from a living ocean.",
        {
          ideology: "The sea is trying to speak.",
          goals: "Let the engine finish its message.",
          canon: "draft",
        },
      ),
    ],
    loreNotes: [
      entity(
        "n1",
        "The price of a tide",
        "Every seventh night, the Orrery must surrender a collective memory to keep the sea below its bridges.",
        {
          category: "World rule",
          content:
            "The keeper can offer a subject, but cannot choose which memories the engine consumes. Personal records survive, creating a gap between knowing a thing and remembering it.",
          canon: "canon",
        },
      ),
      entity(
        "n2",
        "A staircase that should not exist",
        "Ilan’s last map places a staircase inside a part of the Archive surveyed as solid stone.",
        {
          category: "Mystery",
          content:
            "The map carries tomorrow’s date. Its margin reads: “Do not bring a light. It remembers fire.”",
          canon: "draft",
        },
      ),
      entity(
        "n3",
        "The Seventh Tide",
        "The Assembly has voted to withhold the next tithe until the Keepers reveal the missing ledgers.",
        {
          category: "Conflict",
          content:
            "Mara has seven nights to find another source of power. Eda offers a salvage route beneath the Archive, but only if every memory taken from her crew is returned.",
          canon: "canon",
        },
      ),
    ],
    relationships: [
      [
        "c1",
        "f1",
        "Leader Of",
        "Mara inherited the office after her mother vanished.",
        "Public",
        "Stable",
      ],
      [
        "c1",
        "c2",
        "Friendship",
        "Ilan left his last map with Mara. She has not opened it.",
        "Public",
        "Fragile",
      ],
      [
        "c1",
        "l4",
        "Controls",
        "Only the keeper can choose what the engine is offered.",
        "Public",
        "Fragile",
      ],
      [
        "c2",
        "l2",
        "Located In",
        "Ilan’s coat was recovered at the Archive entrance.",
        "Rumored",
        "Volatile",
      ],
      [
        "f1",
        "f2",
        "Rival",
        "The Assembly demands an account of the missing memories.",
        "Public",
        "Volatile",
      ],
      [
        "c3",
        "f3",
        "Member Of",
        "One of Vesper’s nine donors founded the Choir.",
        "Secret",
        "Fragile",
      ],
      [
        "c4",
        "c1",
        "Ally",
        "Eda offers a route beneath the engine in exchange for her crew’s memories.",
        "Public",
        "Fragile",
      ],
      [
        "c4",
        "l3",
        "Located In",
        "The salvage ship returns to the same empty berth every dawn.",
        "Public",
        "Stable",
      ],
      [
        "f3",
        "l4",
        "Religious",
        "The Choir believes the engine is translating the ocean.",
        "Secret",
        "Stable",
      ],
      [
        "l1",
        "l4",
        "Created By",
        "The engine raised the first bridge from the ocean.",
        "Rumored",
        "Stable",
      ],
      [
        "c2",
        "c3",
        "Secret Connection",
        "Vesper remembers drawing the map in Ilan’s handwriting.",
        "Secret",
        "Volatile",
      ],
      [
        "f2",
        "l3",
        "Controls",
        "Quay workers answer to the elected Assembly.",
        "Public",
        "Stable",
      ],
    ].map(
      ([sourceId, targetId, type, description, visibility, stability], i) => ({
        id: "r" + i,
        sourceId,
        targetId,
        sourceType:
          sourceId[0] === "c"
            ? "Character"
            : sourceId[0] === "f"
              ? "Faction"
              : "Location",
        targetType:
          targetId[0] === "c"
            ? "Character"
            : targetId[0] === "f"
              ? "Faction"
              : "Location",
        type,
        description,
        visibility,
        stability,
        strength: 7,
        influence: (i % 3) + 6,
        tone: i % 2 ? "Distrust" : "Loyalty",
        tags: "",
        importance: "High",
        created: now,
        updated: now,
      }),
    ),
    events: [
      {
        id: "ev1",
        title: "The engine returns a memory",
        detail:
          "Mara hears her mother’s lullaby inside the Tide Engine. A memory thought consumed has returned.",
        kind: "fact",
        date: "Night 01",
        source: "Creator-authored example",
        created: now,
      },
    ],
    generatorRuns: [],
    chat: [],
  };
}
