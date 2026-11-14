import { test, expect } from "@playwright/test";
import { relationshipState } from "../fixtures/states.ts";

const snapshot = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("dreamforge-studio", 1);
        req.onsuccess = () => {
          const db = req.result,
            r = db
              .transaction("snapshots")
              .objectStore("snapshots")
              .get("current");
          r.onsuccess = () => {
            db.close();
            resolve(r.result.state);
          };
          r.onerror = reject;
        };
        req.onerror = reject;
      }),
  );
const compactPrompt =
  "Create exactly 1 small village called Willowford and exactly 3 characters, all human: Mara the miller, Tovin the farmer, and Elin the mediator. Include exactly 1 disagreement: whether to divert the river to the mill. Mara wants more power, Tovin needs irrigation, and Elin wants a compromise. No magic. Keep the setting grounded and local. Generate only this village, these three characters, and this disagreement.";
const blankArchitectWorld = async (page) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Create a world/ }).click();
  await page.getByLabel("World name").fill("Disposable Architect test");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Build with Architect/ }),
  ).toBeVisible();
  await page.goto("/#ai");
};
const reviewCompact = async (page, prompt = compactPrompt) => {
  await page.locator("#world-prompt").fill(prompt);
  await page.getByRole("button", { name: /Review blueprint/ }).click();
};
const generateCompact = async (page) => {
  await page
    .getByRole("button", { name: "Generate draft", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A new corner of your world",
      exact: true,
    }),
  ).toBeVisible();
};

test("compact Architect preserves the exact named cast, scope and conflict through save and reopen", async ({
  page,
  context,
}) => {
  const errors = checkErrors(page),
    external = [];
  await context.route("**/*", (request) => {
    const url = new URL(request.request().url());
    if (url.hostname === "127.0.0.1") return request.continue();
    external.push(url.href);
    return request.abort();
  });
  await blankArchitectWorld(page);
  const before = (await snapshot(page)).universes[0];
  await page.getByLabel("Detail profile").selectOption("minimal");
  await reviewCompact(page);
  await expect(page.getByLabel("Generation scope")).toHaveValue("settlement");
  await expect(page.getByLabel("Settlement name")).toHaveValue("Willowford");
  await expect(page.getByLabel("Named cast")).toHaveValue(
    "Mara | miller | Human | wants more power\nTovin | farmer | Human | needs irrigation\nElin | mediator | Human | wants a compromise",
  );
  await generateCompact(page);
  expect((await snapshot(page)).universes[0]).toEqual(before);
  await expect(page.locator(".draft-item")).toHaveCount(3);
  await page.getByRole("tab", { name: /^Locations/ }).click();
  await expect(page.locator(".draft-item")).toHaveCount(1);
  await expect(page.locator(".draft-item")).toContainText("Willowford");
  await page.getByRole("tab", { name: /^Lore notes/ }).click();
  await expect(page.locator(".draft-item")).toHaveCount(1);
  await expect(page.locator(".draft-item")).toContainText(
    "whether to divert the river to the mill",
  );
  await page.getByRole("tab", { name: /^Relationships/ }).click();
  await expect(page.locator(".draft-item").nth(1)).toContainText(
    "Mara → Central disagreement",
  );
  await page
    .getByRole("button", { name: "Add approved entries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible();
  const saved = (await snapshot(page)).universes[0];
  expect(
    saved.characters.map((person) => [
      person.name,
      person.role,
      person.species,
      person.goals,
    ]),
  ).toEqual([
    ["Mara", "miller", "Human", "wants more power"],
    ["Tovin", "farmer", "Human", "needs irrigation"],
    ["Elin", "mediator", "Human", "wants a compromise"],
  ]);
  expect(saved.locations.map((place) => place.name)).toEqual(["Willowford"]);
  expect(saved.factions).toHaveLength(0);
  expect(saved.loreNotes).toHaveLength(1);
  expect(saved.relationships).toHaveLength(6);
  expect(saved.loreNotes[0].content).toContain("Elin wants a compromise");
  expect(
    [...saved.characters, ...saved.locations, ...saved.loreNotes].every(
      (entry) => entry.canon === "draft",
    ),
  ).toBe(true);
  const ids = new Set(
    [...saved.characters, ...saved.locations, ...saved.loreNotes].map(
      (entry) => entry.id,
    ),
  );
  expect(
    saved.relationships.every(
      (relation) => ids.has(relation.sourceId) && ids.has(relation.targetId),
    ),
  ).toBe(true);
  expect(saved.generatorRuns[0].settings.constraints.name).toBe("Willowford");
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/#entities");
  await expect(
    reopened.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible();
  expect((await snapshot(reopened)).universes[0]).toEqual(saved);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("editable compact constraints validate mismatches and support alternate cast, species and scope", async ({
  page,
}) => {
  await blankArchitectWorld(page);
  const before = (await snapshot(page)).universes[0];
  await reviewCompact(
    page,
    "Create one town called Brackenport with exactly two characters, all human: Isha the baker and Ren the ferryman. Include one dispute over opening the bridge. Isha supports trade, and Ren opposes tolls. No magic.",
  );
  await expect(page.getByLabel("Settlement name")).toHaveValue("Brackenport");
  await page.getByLabel("Character count").fill("3");
  await page
    .getByRole("button", { name: "Generate draft", exact: true })
    .click();
  await expect(page.locator(".form-error")).toContainText("exactly 3");
  expect((await snapshot(page)).universes[0]).toEqual(before);
  await page.getByLabel("Character count").fill("2");
  await page.getByLabel("Settlement type").selectOption("hamlet");
  await page.getByLabel("Settlement name").fill("Cedar Hollow");
  await page.getByLabel("Default species").fill("Elf");
  await page
    .getByLabel("Named cast")
    .fill(
      "Ayla | keeper | | protects the grove\nBorin | scout | Dwarf | seeks a trail",
    );
  await page
    .getByLabel("Central conflict", { exact: true })
    .fill("whether to open the grove to travelers");
  await generateCompact(page);
  await page
    .getByRole("button", { name: "Add approved entries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible();
  const saved = (await snapshot(page)).universes[0];
  expect(
    saved.characters.map((person) => [
      person.name,
      person.role,
      person.species,
    ]),
  ).toEqual([
    ["Ayla", "keeper", "Elf"],
    ["Borin", "scout", "Dwarf"],
  ]);
  expect(saved.locations[0].name).toBe("Cedar Hollow");
  expect(saved.loreNotes[0].content).toContain("open the grove");
});

test("cancelled blueprint, cancelled worker and discarded compact drafts do not change stored entries", async ({
  page,
}) => {
  // Delay dispatch, rather than replace the actual generator, to make cancellation deterministic.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message) {
        setTimeout(() => super.postMessage(message), 300);
      }
    };
  });
  await blankArchitectWorld(page);
  const before = (await snapshot(page)).universes[0];
  await reviewCompact(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await snapshot(page)).universes[0]).toEqual(before);
  await reviewCompact(page);
  await page
    .getByRole("button", { name: "Generate draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel generation", exact: true })
    .click();
  await reviewCompact(page);
  await generateCompact(page);
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  expect((await snapshot(page)).universes[0]).toEqual(before);
  await reviewCompact(page);
  await generateCompact(page);
  await page
    .getByRole("button", { name: "Add approved entries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible();
  const saved = (await snapshot(page)).universes[0];
  expect(saved.characters).toHaveLength(3);
  expect(saved.loreNotes).toHaveLength(1);
  expect(saved.generatorRuns).toHaveLength(1);
});

test("excluding a compact cast member filters its connections and zero-conflict drafts stay small", async ({
  page,
}) => {
  await blankArchitectWorld(page);
  await reviewCompact(page);
  await page.getByLabel("Central conflict count").selectOption("0");
  await page.getByLabel("Central conflict", { exact: true }).fill("");
  await generateCompact(page);
  await page.locator(".draft-item").first().getByRole("checkbox").uncheck();
  await page
    .getByRole("button", { name: "Add approved entries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible();
  const saved = (await snapshot(page)).universes[0];
  expect(saved.characters.map((person) => person.name)).toEqual([
    "Tovin",
    "Elin",
  ]);
  expect(saved.loreNotes).toHaveLength(0);
  expect(saved.relationships).toHaveLength(2);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).universes[0]).toEqual(saved);
});
const example = async (page) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore an example ↗", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Your world/, level: 1 }),
  ).toBeVisible();
};
const route = async (page, hash) => {
  await page.goto("/#" + hash);
  await expect(page.locator("#main-content h1")).toBeVisible();
};
const checkErrors = (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
};

test("new desk, world creation, goals, entity editing, deletion and previous-save recovery", async ({
  page,
}) => {
  const errors = checkErrors(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "＋ Create a world", exact: true })
    .click();
  await page.getByLabel("World name").fill("Journey World");
  await page
    .getByLabel(/The premise/)
    .fill("A city in the canopy of a moving forest.");
  await page
    .getByLabel(/Creative goals/)
    .fill("Find out why the forest walks.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator("[data-goal]").check();
  await expect
    .poll(async () => (await snapshot(page)).universes[0].goals[0].done)
    .toBe(true);
  await route(page, "entities");
  for (const name of ["Aster", "Bram"]) {
    await page.getByRole("button", { name: "＋ New entry" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page
      .getByLabel("Description", { exact: true })
      .fill("A keeper of the walking forest.");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await page.locator(".entity-card").first().click();
  await page.getByRole("button", { name: "Edit entry", exact: true }).click();
  await page.getByLabel("Goals", { exact: true }).fill("Find the first tree.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator(".entity-card").first().click();
  await page.getByRole("button", { name: "Delete entry", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".entity-card")).toHaveCount(1);
  await route(page, "settings");
  await page.getByRole("button", { name: "Recover previous save" }).click();
  await page.getByRole("button", { name: "Recover", exact: true }).click();
  await route(page, "entities");
  await expect(page.locator(".entity-card")).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Aster", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("relationships, map path, search, timeline, chat, backups and malformed import protection", async ({
  page,
}) => {
  const errors = checkErrors(page);
  await example(page);
  await route(page, "relationships");
  await page.getByRole("button", { name: "＋ Add relationship" }).click();
  await page.getByLabel("From", { exact: true }).selectOption("c1");
  await page.getByLabel("To", { exact: true }).selectOption("c3");
  await page
    .locator("dialog")
    .getByLabel("Relationship type", { exact: true })
    .selectOption("Mentor");
  await page
    .getByLabel("What binds them?")
    .fill("Mara teaches Vesper to choose.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".relationship-card")).toHaveCount(13);
  await page.getByLabel("Visibility", { exact: true }).selectOption("Secret");
  await expect(page.locator(".relationship-card")).toHaveCount(3);
  await route(page, "graph");
  await page.getByLabel("Path start").selectOption("c1");
  await page.getByLabel("Path end").selectOption("c3");
  await page.getByRole("button", { name: "Trace connection" }).click();
  await expect(page.locator("#path-result")).toHaveText(
    "Mara Vey → Vesper Nine",
  );
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search all worlds").fill("Drowned");
  await page.locator("#search-results button").first().click();
  await expect(page.locator("dialog h2")).toHaveText("The Drowned Archive");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await route(page, "timeline");
  await page.getByRole("button", { name: "＋ Record a moment" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("The Choir hears a warning");
  await page.getByLabel("Kind of record").selectOption("belief");
  await page
    .getByLabel("What happened, or what is believed?")
    .fill("The Choir believes the next tide will be the last.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "The Choir hears a warning" }),
  ).toBeVisible();
  await route(page, "chat");
  await page
    .getByRole("button", { name: "Who are the main characters?", exact: true })
    .click();
  await expect(page.locator(".message.assistant")).toContainText("Mara");
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(2);
  await route(page, "settings");
  const downloadP = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ Export all worlds" }).click();
  const download = await downloadP;
  const file = await download.path();
  await page.locator("#import-file").setInputFiles(file);
  await page.getByRole("button", { name: "Import copies" }).click();
  await expect
    .poll(async () => (await snapshot(page)).universes.length)
    .toBe(2);
  await page.locator("#import-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"universes":[{"id":"bad","name":"Broken","characters":"bad"}]}',
    ),
  });
  await expect(page.locator("#toast")).toContainText("Import stopped");
  expect((await snapshot(page)).universes).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("legacy relationship state migrates once, reloads, and leaves legacy bytes intact", async ({
  page,
}) => {
  const errors = checkErrors(page);
  await page.addInitScript(
    (s) => localStorage.setItem("dreamforge_data", JSON.stringify(s)),
    relationshipState,
  );
  await route(page, "relationships");
  await expect(page.locator(".relationship-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".relationship-card")).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("dreamforge_data")),
    ),
  ).toEqual(relationshipState);
  expect((await snapshot(page)).universes[0].relationships).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("all screens remain usable at 390px, with no remote dependencies", async ({
  page,
}) => {
  const errors = checkErrors(page),
    external = [];
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(r.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await example(page);
  for (const hash of [
    "dashboard",
    "entities",
    "relationships",
    "graph",
    "timeline",
    "audit",
    "ai",
    "chat",
    "guide",
    "settings",
  ]) {
    await route(page, hash);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      hash,
    ).toBe(false);
  }
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("5000-citizen draft generates off-thread, paginates, saves atomically, reloads, and exports", async ({
  page,
}) => {
  test.setTimeout(150000);
  const errors = checkErrors(page);
  await example(page);
  await route(page, "ai");
  await page
    .locator("#world-prompt")
    .fill(
      "Create a Type II civilization around a red dwarf star with exactly 5000 citizens, no magic.",
    );
  await page.getByRole("button", { name: "Review blueprint →" }).click();
  await expect(page.locator(".blueprint-grid")).toContainText("5,000");
  await page
    .getByRole("button", { name: "Generate draft", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A new corner of your world",
      exact: true,
    }),
  ).toBeVisible({ timeout: 120000 });
  await expect(page.locator(".draft-item")).toHaveCount(24);
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("Page 2");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("The Reviewed Citizen");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Add approved entries" }).click();
  await expect(
    page.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible();
  const s = await snapshot(page);
  expect(s.universes[0].characters).toHaveLength(5004);
  expect(
    s.universes[0].characters.some((c) => c.name === "The Reviewed Citizen"),
  ).toBe(true);
  expect(s.universes[0].generatorRuns).toHaveLength(1);
  await route(page, "graph");
  expect(await page.locator(".graph-node").count()).toBeLessThanOrEqual(71);
  expect(errors).toEqual([]);
});

test("another tab cannot silently overwrite a newer save", async ({
  page,
  context,
}) => {
  await example(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator("#main-content h1")).toBeVisible();
  await page.locator("[data-goal]").first().check();
  await expect
    .poll(async () => (await snapshot(page)).universes[0].goals[0].done)
    .toBe(true);
  await other.locator("[data-goal]").nth(1).click();
  await expect(other.locator("#toast")).toContainText("Another tab changed");
  const s = await snapshot(page);
  expect(s.universes[0].goals[0].done).toBe(true);
  expect(s.universes[0].goals[1].done).toBe(false);
});

test("optional local AI is explicit, reads a bounded excerpt, and cannot change canon", async ({
  page,
}) => {
  await example(page);
  let requestBody;
  await page.route("http://127.0.0.1:11434/api/show", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ details: { family: "test-adapter" } }),
    }),
  );
  await page.route("http://127.0.0.1:11434/api/chat", (route) => {
    requestBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          content: "A suggestion: let the tide reveal a forgotten bridge.",
        },
      }),
    });
  });
  await route(page, "settings");
  await page.getByLabel("Model name", { exact: true }).fill("test-local-model");
  await page.getByLabel("Enable local AI in Universe Chat").check();
  await page.getByRole("button", { name: "Save AI settings" }).click();
  const before = (await snapshot(page)).universes[0];
  await route(page, "chat");
  await page.locator("#chat-mode").selectOption("local");
  await page
    .getByLabel("Ask about your world")
    .fill("What should happen next?");
  await page.getByRole("button", { name: "Send ↑" }).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "A suggestion:",
  );
  expect(requestBody.messages[0].content).toContain("The Orrery of Tides");
  expect(requestBody.messages[0].content.length).toBeLessThan(26500);
  const after = (await snapshot(page)).universes[0];
  expect(after.characters).toEqual(before.characters);
  expect(after.relationships).toEqual(before.relationships);
  expect(after.chat).toHaveLength(2);
});

test("five palettes persist, retain the original colors, and fit a phone", async ({
  page,
}) => {
  await example(page);
  await route(page, "settings");
  for (const [id, name] of [
    ["rose", "Rose"],
    ["crimson", "Crimson"],
    ["gilded", "Gilded"],
    ["observatory", "Observatory"],
    ["amethyst", "Amethyst"],
  ]) {
    await page.getByRole("button", { name: `${name} palette` }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await page.reload();
    await expect(
      page.getByRole("button", { name: `${name} palette` }),
    ).toHaveAttribute("aria-pressed", "true");
    if (id === "observatory")
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).backgroundColor,
        ),
      ).toBe("rgb(16, 23, 24)");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await snapshot(page)).universes[0].characters).toHaveLength(4);
});

test("local Architect drafts are validated and only added after creator approval", async ({
  page,
}) => {
  const errors = checkErrors(page);
  await example(page);
  await page.route("http://127.0.0.1:11434/api/show", (r) =>
    r.fulfill({ json: {} }),
  );
  let body;
  await page.route("http://127.0.0.1:11434/api/chat", (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({
      json: {
        message: {
          content: JSON.stringify({
            entries: [
              {
                key: "e1",
                kind: "characters",
                name: "The Glass Archivist",
                description: "She preserves dangerous memories.",
              },
              {
                key: "e2",
                kind: "locations",
                name: "The Glass Vault",
                description: "A hidden place beneath the tide.",
              },
            ],
            relationships: [
              {
                source: "e1",
                target: "e2",
                type: "Located In",
                description: "The archivist works here.",
              },
            ],
          }),
        },
      },
    });
  });
  await route(page, "settings");
  await page.getByLabel("Model name", { exact: true }).fill("test-local");
  await page.getByLabel("Enable local AI in Universe Chat").check();
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await route(page, "ai");
  await page
    .locator("#world-prompt")
    .fill("An archivist hiding a morally difficult secret and her vault.");
  await page.getByRole("button", { name: "Draft with local AI ✦" }).click();
  await expect(
    page.getByRole("heading", { name: "A new corner of your world" }),
  ).toBeVisible();
  expect(body.format.properties.entries.maxItems).toBe(8);
  expect((await snapshot(page)).universes[0].characters).toHaveLength(4);
  await page.getByRole("button", { name: "Add approved entries" }).click();
  await expect(
    page.getByRole("heading", { name: "World codex", exact: true }),
  ).toBeVisible();
  await page.reload();
  const w = (await snapshot(page)).universes[0];
  expect(w.characters).toHaveLength(5);
  expect(w.characters.find((c) => c.name === "The Glass Archivist").canon).toBe(
    "draft",
  );
  expect(w.relationships).toHaveLength(13);
  expect(w.aiDraftRuns[0].model).toBe("test-local");
  expect(errors).toEqual([]);
});

test("invalid local drafts and cloud models leave the manuscript intact", async ({
  page,
}) => {
  await example(page);
  let remote = false;
  let inferenceCount = 0;
  await page.route("http://127.0.0.1:11434/api/show", (r) =>
    r.fulfill({ json: remote ? { remote_model: "hidden-cloud-route" } : {} }),
  );
  await page.route("http://127.0.0.1:11434/api/chat", (r) => {
    inferenceCount++;
    return r.fulfill({ json: { message: { content: "not valid json" } } });
  });
  await route(page, "settings");
  await page.getByLabel("Model name", { exact: true }).fill("test-local");
  await page.getByLabel("Enable local AI in Universe Chat").check();
  await page.getByRole("button", { name: "Save AI settings" }).click();
  const before = (await snapshot(page)).universes[0];
  await route(page, "ai");
  await page.locator("#world-prompt").fill("A small story seed.");
  await page.getByRole("button", { name: "Draft with local AI ✦" }).click();
  await expect(page.locator("#toast")).toContainText("unreadable JSON");
  remote = true;
  await page.getByRole("button", { name: "Draft with local AI ✦" }).click();
  await expect(page.locator("#toast")).toContainText("remote server");
  expect(inferenceCount).toBe(1);
  expect((await snapshot(page)).universes[0]).toEqual(before);
});
