import {
  StudioRepository,
  validateImport,
  cleanSnapshot,
} from "../src/storage/studioRepository.ts";
import { RELATIONSHIP_TYPES } from "../src/relationships/domain.ts";
import {
  analyzeWorldPrompt,
  answerWorldbuildingQuestion,
  buildRelationshipIndex,
  getRelationshipIntelligence,
  findShortestRelationshipPath,
  generateRelationshipInsights,
} from "./world-engine.js";
import { exampleWorld } from "./demo.js";
import { askLocalAI, validateEndpoint } from "./local-ai.js";
import { createLocalDraft } from "./ai-draft.js";
import {
  reviewArchitectBrief,
  castToText,
  castFromText,
  validateSettlementConstraints,
} from "./architect-constraints.js";
import { themes, currentTheme, themeChooser } from "./themes.js";

const repo = new StudioRepository();
const root = document.querySelector("#app");
const dialog = document.querySelector("#editor");
const collections = {
  characters: "Characters",
  locations: "Locations",
  factions: "Factions",
  loreNotes: "Lore notes",
};
const types = {
  characters: "Character",
  locations: "Location",
  factions: "Faction",
  loreNotes: "Lore Note",
};
const glyphs = {
  dashboard: "◈",
  entities: "▤",
  graph: "⌘",
  relationships: "⇄",
  timeline: "◷",
  audit: "◎",
  ai: "✧",
  chat: "✦",
  guide: "?",
  settings: "⚙",
};
const navigation = [
  ["dashboard", "World desk"],
  ["entities", "World codex"],
  ["graph", "Constellation"],
  ["relationships", "Relationships"],
  ["timeline", "Timeline"],
  ["audit", "Continuity"],
  ["ai", "World Architect"],
  ["chat", "Universe Chat"],
];
let state,
  activePage = "",
  busy = false,
  saveLabel = "Saved on this device";
let entityTab = "characters",
  entityQuery = "",
  entityPage = 0;
let relationshipQuery = "",
  relationshipType = "",
  relationshipVisibility = "",
  relationshipPage = 0;
let graphSelection = "",
  graphQuery = "",
  graphType = "",
  graphZoom = 1;
let aiDraftController = null;
let chatMode = "offline";
let generation = null,
  worker = null,
  promptDraft = "",
  generationProfile = "",
  previewTab = "characters",
  previewPage = 0;
let toastTimer;
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const uid = () => crypto.randomUUID();
const world = () =>
  state?.universes.find((w) => w.id === state.currentUniverseId);
const allEntities = (w) =>
  Object.keys(collections).flatMap((key) =>
    (w?.[key] || []).map((item) => ({ key, item })),
  );
const link = (page, label, cls = "") =>
  `<a class="${cls}" href="#${page}">${label}</a>`;
const btn = (label, action, cls = "secondary", extra = "") =>
  `<button class="button ${cls}" data-action="${action}" ${extra}>${label}</button>`;
const badge = (label, cls = "") =>
  `<span class="badge ${cls}">${e(label)}</span>`;
const prettyDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "Undated"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const formField = (name, label, value = "", kind = "input", options = []) =>
  `<label class="field">${label}${
    kind === "textarea"
      ? `<textarea name="${name}" aria-label="${e(label)}" rows="4">${e(value)}</textarea>`
      : kind === "select"
        ? `<select name="${name}" aria-label="${e(label)}">${options
            .map((o) => {
              const [v, t] = Array.isArray(o) ? o : [o, o];
              return `<option value="${e(v)}" ${String(v) === String(value) ? "selected" : ""}>${e(t)}</option>`;
            })
            .join("")}</select>`
        : `<input name="${name}" aria-label="${e(label)}" value="${e(value)}" ${name === "name" ? 'required maxlength="180"' : ""} />`
  }</label>`;
function toast(message) {
  clearTimeout(toastTimer);
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.classList.add("show");
  toastTimer = setTimeout(() => t.classList.remove("show"), 6500);
}
function header(kicker, title, description, actions = "") {
  return `<header class="page-heading"><div><p class="eyebrow">${kicker}</p><h1>${e(title)}</h1><p class="lede">${e(description)}</p></div><div class="actions">${actions}</div></header>`;
}
function empty(title, description, action = "") {
  return `<div class="empty-state"><span class="empty-symbol">✧</span><h2>${e(title)}</h2><p>${e(description)}</p>${action}</div>`;
}
function requireWorld() {
  if (world()) return true;
  document.querySelector("#main-content").innerHTML = empty(
    "A world of your own",
    "Create a world or open the example to start exploring.",
    btn("Create a world", "new-world", "primary") +
      btn("Explore the example", "example"),
  );
  return false;
}
function openDialog(title, body, onSubmit) {
  dialog.innerHTML = `<form method="dialog"><div class="dialog-heading"><div><p class="eyebrow">DREAMFORGE STUDIO</p><h2>${e(title)}</h2></div><button class="icon-button" type="button" data-close aria-label="Close dialog">×</button></div>${body}<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" data-close>Cancel</button><button class="button primary" type="submit">Save changes</button></div></form>`;
  dialog
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => dialog.close()));
  dialog.querySelector("form").onsubmit = async (ev) => {
    ev.preventDefault();
    const b = dialog.querySelector("[type=submit]");
    b.disabled = true;
    try {
      await onSubmit(new FormData(ev.target));
      dialog.close();
    } catch (err) {
      dialog.querySelector(".form-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
  dialog.showModal();
}
async function commit(change, message = "Saved on this device") {
  if (busy)
    throw new Error("A save is still finishing. Try again in a moment.");
  busy = true;
  saveLabel = "Saving…";
  updateSaveStatus();
  try {
    const draft = cleanSnapshot(state);
    await change(draft);
    await repo.save(draft);
    state = draft;
    saveLabel = "Saved on this device";
    render();
    if (message) toast(message);
  } catch (err) {
    saveLabel = "Save failed · previous save intact";
    updateSaveStatus();
    throw err;
  } finally {
    busy = false;
    updateSaveStatus();
  }
}
function updateSaveStatus() {
  const s = document.querySelector("#save-status");
  if (s) s.textContent = saveLabel;
}
function currentDraft(draft) {
  return draft.universes.find((w) => w.id === state.currentUniverseId);
}
function navigate(page) {
  if (location.hash === `#${page}`) render();
  else location.hash = page;
}
function shell() {
  const w = world();
  root.innerHTML = `<aside class="sidebar"><a class="brand" href="#dashboard"><span class="brand-mark">✧</span>dreamforge<span class="version">STUDIO</span></a><label class="world-picker"><span>YOUR WORKSPACE</span><select id="world-select" aria-label="Current world"><option value="">Choose a world</option>${state.universes.map((u) => `<option value="${e(u.id)}" ${u.id === w?.id ? "selected" : ""}>${e(u.name)}</option>`).join("")}</select></label><nav aria-label="Main navigation">${[...navigation, ["guide", "Field guide"], ["settings", "Settings & backups"]].map(([p, n], i) => `${i === 6 ? '<p class="nav-caption">CREATE & DISCOVER</p>' : ""}<a href="#${p}" ${p === activePage ? 'aria-current="page" class="active"' : ""}><span class="nav-icon">${glyphs[p]}</span>${n}${p === "entities" && w ? `<span class="nav-count">${allEntities(w).length}</span>` : ""}</a>`).join("")}</nav><div class="sidebar-bottom"><div class="local-note"><span class="status-dot"></span><div>Yours, by design.<small>Private. Local. Ready to wander.</small></div></div></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">STUDIO <span>/</span> ${e(w?.name || "Your next world")}</span><div class="topbar-right"><button class="search-trigger" data-action="search">⌕ <span>Find anything</span><kbd>Ctrl K</kbd></button><span class="save-indicator"><span class="status-dot"></span><span id="save-status">${saveLabel}</span></span></div></header><main id="main-content" tabindex="-1"></main><footer class="workspace-footer"><span>DREAMFORGE <span class="muted">/</span> A place for your impossible ideas.</span><span>0.5 · YOUR DEVICE. YOUR WORLDS.</span></footer></div>`;
  document.querySelector("#world-select").onchange = (ev) =>
    commit((s) => {
      s.currentUniverseId = ev.target.value || null;
    }, "World opened").catch((err) => toast(err.message));
}
function render() {
  if (!state) return;
  document.documentElement.dataset.theme = currentTheme(state);
  const raw = location.hash.slice(1) || "dashboard";
  activePage = [...navigation.map((n) => n[0]), "settings", "guide"].includes(
    raw,
  )
    ? raw
    : "dashboard";
  shell();
  if (
    activePage !== "dashboard" &&
    activePage !== "settings" &&
    activePage !== "guide" &&
    !requireWorld()
  )
    return;
  const main = document.querySelector("#main-content");
  ({
    dashboard: renderDesk,
    entities: renderEntities,
    relationships: renderRelationships,
    graph: renderGraph,
    timeline: renderTimeline,
    audit: renderAudit,
    ai: renderArchitect,
    chat: renderChat,
    settings: renderSettings,
    guide: renderGuide,
  })[activePage](main);
}
function orbitalArt() {
  return `<div class="orbital-art" aria-hidden="true"><svg viewBox="0 0 540 400"><defs><radialGradient id="moon"><stop stop-color="var(--c-567775)"/><stop offset=".68" stop-color="var(--c-273c3d)"/><stop offset="1" stop-color="var(--c-111e21)"/></radialGradient><pattern id="lines" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0H6" stroke="var(--c-c2d4c5)" stroke-opacity=".12"/></pattern></defs><g fill="none" stroke="var(--c-73948b)" stroke-opacity=".25"><ellipse cx="275" cy="202" rx="215" ry="73" transform="rotate(-31 275 202)"/><ellipse cx="275" cy="202" rx="235" ry="112" transform="rotate(31 275 202)"/><circle cx="275" cy="202" r="158" stroke-dasharray="2 9"/><path d="M275 20V380M80 202H470" stroke-dasharray="3 6"/></g><circle cx="275" cy="202" r="105" fill="url(#moon)" stroke="var(--c-6f9282)" stroke-opacity=".4"/><circle cx="275" cy="202" r="104" fill="url(#lines)"/><path d="M232 107Q338 150 294 303Q375 285 380 201Q375 128 304 100Z" fill="var(--c-080f13)" opacity=".5"/><ellipse cx="275" cy="202" rx="215" ry="73" transform="rotate(-31 275 202)" fill="none" stroke="var(--c-d6b187)" stroke-opacity=".48" stroke-dasharray="410 990"/><g fill="var(--c-e8bd8e)"><circle cx="105" cy="300" r="5"/><circle cx="457" cy="211" r="3"/><path d="M418 68V88M408 78H428"/></g><g fill="var(--c-88aa99)"><circle cx="160" cy="63" r="2"/><circle cx="391" cy="333" r="2"/><circle cx="71" cy="141" r="2"/></g><g fill="var(--c-96aca3)" font-family="monospace" font-size="9" letter-spacing="2"><text x="366" y="44">FIG. 01 / POSSIBILITY</text><text x="104" y="345">AN UNCHARTED WORLD</text></g></svg></div>`;
}
function renderDesk(main) {
  const w = world();
  main.innerHTML = `<section class="desk-hero">${orbitalArt()}<div class="hero-copy"><p class="eyebrow"><span class="tiny-star">✧</span> THE WORLDBUILDER’S DESK</p><h1>${w ? "Your world.<br><em>Still unfolding.</em>" : "Every world starts<br>with a <em>what if.</em>"}</h1><p>${w ? e(w.premise || "Give this world a premise. A single impossible idea is enough to begin.") : "Give your impossible ideas a place to live. Shape the people, trace their connections, and discover the stories between them."}</p><div class="actions">${w ? btn("✧ Build with Architect", "go-ai", "primary") + btn("Edit world brief ↗", "edit-world") : btn("＋ Create a world", "new-world", "primary") + btn("Explore an example ↗", "example")}</div><div class="hero-footnote"><span class="status-dot"></span> Everything you create stays on this device.</div></div></section>`;
  if (w) {
    const counts = Object.keys(collections)
      .map(
        (k) =>
          `<button class="stat" data-action="collection" data-key="${k}"><span>${collections[k]}</span><strong>${w[k].length.toLocaleString()}</strong><small>Explore ${collections[k].toLowerCase()} ↗</small></button>`,
      )
      .join("");
    main.insertAdjacentHTML(
      "beforeend",
      `<div class="stats">${counts}</div><div class="desk-grid"><section class="panel"><div class="section-heading"><div><p class="eyebrow">YOUR CREATIVE COMPASS</p><h2>What matters in this world</h2></div>${btn("Edit brief", "edit-world", "text-button")}</div><p class="world-rules">${e(w.rules || "Define what can happen here, what cannot, and what every extraordinary power costs.")}</p><div class="goals">${(w.goals || []).map((g) => `<label class="goal ${g.done ? "done" : ""}"><input type="checkbox" data-goal="${e(g.id)}" ${g.done ? "checked" : ""}/><span>${e(g.text)}</span></label>`).join("") || '<p class="muted">Add a goal in your world brief to give your next session a direction.</p>'}</div></section><section class="panel warm-panel"><p class="eyebrow">FOLLOW A THREAD</p><h2>Stories live<br>in the connections.</h2><p>${w.relationships.length ? `${w.relationships.length.toLocaleString()} relationships connect the people and places in your world. Find the secret, the fragile alliance, or the person in between.` : "Give two characters a shared past. Add a place they disagree about. See what starts to happen."}</p>${link("graph", "Explore your constellation <span>↗</span>", "feature-link")}</section></div><section><div class="section-heading"><div><p class="eyebrow">BACK INTO THE WORLD</p><h2>On your desk</h2></div>${link("entities", "View the codex ↗", "text-link")}</div><div class="entity-grid">${
        allEntities(w)
          .slice()
          .sort((a, b) =>
            String(b.item.updated).localeCompare(String(a.item.updated)),
          )
          .slice(0, 3)
          .map(({ key, item }) => entityCard(item, key))
          .join("") ||
        empty(
          "The first page is yours",
          "Add a character, a place, or one small piece of lore.",
          btn("Add a character", "new-entity", "primary"),
        )
      }</div></section>`,
    );
  } else {
    main.insertAdjacentHTML(
      "beforeend",
      `<section><div class="section-heading"><div><p class="eyebrow">A LITTLE INSPIRATION</p><h2>Take the first step into somewhere.</h2></div><span class="muted">Start small. Let it grow.</span></div><div class="starter-grid"><button class="starter-card ocean" data-action="example"><div class="starter-art"><span class="moon-disc"></span><span class="waterline"></span></div><div class="starter-content">${badge("EXPLORE AN EXAMPLE")}<h3>The Orrery of Tides <span>↗</span></h3><p>A city above an impossible ocean. A machine that eats memories. Seven nights to change everything.</p><small>SCIENCE FANTASY · 14 ENTRIES · 12 CONNECTIONS</small></div></button><button class="starter-card blank" data-action="new-world"><div class="blank-art">＋<span>THE UNWRITTEN</span></div><div class="starter-content">${badge("MAKE IT YOURS")}<h3>A world only you could make <span>↗</span></h3><p>A quiet town, an unruly kingdom, a civilization between stars. Begin with the idea you can’t let go.</p><small>YOUR PREMISE · YOUR RULES · YOUR CANON</small></div></button></div></section>`,
    );
  }
  if (state.universes.length)
    main.insertAdjacentHTML(
      "beforeend",
      `<section class="world-shelf"><div class="section-heading"><h2>Your worlds</h2>${btn("＋ New world", "new-world", "text-button")}</div><div class="shelf-items">${state.universes.map((u) => `<button data-action="open-world" data-id="${e(u.id)}" class="shelf-world ${u.id === w?.id ? "selected" : ""}"><span class="shelf-icon">◈</span><span><strong>${e(u.name)}</strong><small>${allEntities(u).length} entries · ${e(u.genre || "Uncharted")}</small></span><span>↗</span></button>`).join("")}</div></section>`,
    );
}
function editWorld(isNew = false) {
  const w = isNew ? null : world();
  openDialog(
    w ? "World brief" : "Create a world",
    `${formField("name", "World name", w?.name || "")}${formField("premise", "The premise · what makes this world worth exploring?", w?.premise || "", "textarea")}${formField("genre", "Genre / atmosphere", w?.genre || "")}${formField("rules", "World rules · possibilities, limits, and costs", w?.rules || "", "textarea")}${formField("goals", "Creative goals · one per line", (w?.goals || []).map((g) => g.text).join("\n"), "textarea")}<p class="muted small">Your brief is creator canon. Architect and Chat never rewrite it automatically.</p>`,
    async (fd) => {
      const name = String(fd.get("name")).trim();
      if (!name) throw Error("Give your world a name.");
      await commit(
        (s) => {
          let u = w ? s.universes.find((u) => u.id === w.id) : null;
          if (!u) {
            u = {
              id: uid(),
              created: new Date().toISOString(),
              characters: [],
              locations: [],
              factions: [],
              loreNotes: [],
              relationships: [],
              events: [],
              generatorRuns: [],
              chat: [],
            };
            s.universes.push(u);
          }
          Object.assign(u, {
            name,
            premise: String(fd.get("premise")),
            genre: String(fd.get("genre")),
            rules: String(fd.get("rules")),
            updated: new Date().toISOString(),
            goals: String(fd.get("goals"))
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((text) => ({
                id: uid(),
                text,
                done: (w?.goals || []).some((g) => g.text === text && g.done),
              })),
          });
          s.currentUniverseId = u.id;
        },
        w ? "World brief saved" : "Your world is ready",
      );
    },
  );
}
function entityCard(item, key) {
  return `<button class="entity-card ${key}" data-action="inspect" data-key="${key}" data-id="${e(item.id)}"><div class="entity-card-top"><span class="entity-emblem">${{ characters: "♙", locations: "⌖", factions: "⚑", loreNotes: "✎" }[key]}</span>${badge(item.canon === "draft" ? "Draft" : "Canon", item.canon === "draft" ? "draft" : "")}</div><p class="eyebrow">${e(item.scaleType || types[key])}</p><h3>${e(item.name)}</h3><p>${e(item.description || item.summary || "An unwritten piece of your world.")}</p><div class="entity-card-bottom"><span>${e(item.role || item.category || item.region || types[key])}</span><span>↗</span></div></button>`;
}
function renderEntities(main) {
  const w = world();
  let list = w[entityTab].filter((i) =>
    JSON.stringify(i).toLowerCase().includes(entityQuery.toLowerCase()),
  );
  entityPage = Math.min(
    entityPage,
    Math.max(0, Math.ceil(list.length / 24) - 1),
  );
  main.innerHTML =
    header(
      "THE WORLD, IN WORDS",
      "World codex",
      "The people, places, and ideas that make this world yours.",
      btn("＋ New entry", "new-entity", "primary"),
    ) +
    `<div class="toolbar"><div class="tabs" role="tablist" aria-label="Entity type">${Object.keys(
      collections,
    )
      .map(
        (k) =>
          `<button role="tab" aria-selected="${k === entityTab}" data-action="collection" data-key="${k}">${collections[k]} <span>${w[k].length}</span></button>`,
      )
      .join(
        "",
      )}</div><input class="filter-input" aria-label="Search codex" placeholder="Find a name, detail, or tag…" id="entity-search" value="${e(entityQuery)}" /></div><p class="result-count">${list.length.toLocaleString()} ${collections[entityTab].toLowerCase()} ${entityQuery ? "matching your search" : ""}</p><div class="entity-grid">${
      list
        .slice(entityPage * 24, entityPage * 24 + 24)
        .map((i) => entityCard(i, entityTab))
        .join("") ||
      empty(
        "A little space for possibility",
        entityQuery
          ? "Try a different name, detail, or tag."
          : "Every world needs a first entry.",
        entityQuery
          ? ""
          : btn(
              `Add ${types[entityTab].toLowerCase()}`,
              "new-entity",
              "primary",
            ),
      )
    }</div>${pagination(list.length, entityPage, 24, "entities")}`;
  bindSearch("entity-search", (v) => {
    entityQuery = v;
    entityPage = 0;
    renderEntities(main);
  });
}
function pagination(total, page, size, kind) {
  return total > size
    ? `<div class="pagination">${btn("← Previous", "page", "secondary", `data-kind="${kind}" data-page="${page - 1}" ${page === 0 ? "disabled" : ""}`)}<span>Page ${page + 1} of ${Math.ceil(total / size)}</span>${btn("Next →", "page", "secondary", `data-kind="${kind}" data-page="${page + 1}" ${(page + 1) * size >= total ? "disabled" : ""}`)}</div>`
    : "";
}
function bindSearch(id, update) {
  const input = document.getElementById(id);
  input.oninput = () => {
    const start = input.selectionStart;
    const value = input.value;
    update(value);
    const next = document.getElementById(id);
    next.focus();
    next.setSelectionRange(start, start);
  };
}
function inspectEntity(key, id) {
  const w = world(),
    item = w[key].find((i) => i.id === id);
  if (!item) return;
  const connections = w.relationships.filter(
    (r) => r.sourceId === id || r.targetId === id,
  );
  const extras = Object.entries(item).filter(
    ([k, v]) =>
      ![
        "id",
        "name",
        "description",
        "tags",
        "created",
        "updated",
        "canon",
      ].includes(k) &&
      v &&
      (!Array.isArray(v) || v.length),
  );
  dialog.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">${e(types[key])} · ${e(item.canon || "canon")}</p><h2>${e(item.name)}</h2></div><button class="icon-button" data-close aria-label="Close dialog">×</button></div><p class="detail-description">${e(item.description)}</p><div class="detail-fields">${extras.map(([k, v]) => `<section><h3>${e(k.replace(/([A-Z])/g, " $1"))}</h3><p>${e(typeof v === "object" ? JSON.stringify(v, null, 2) : v)}</p></section>`).join("")}</div><h3>Connections <span class="muted">${connections.length}</span></h3><div class="connection-list">${
    connections
      .slice(0, 60)
      .map((r) => {
        const other = allEntities(w).find(
          (x) => x.item.id === (r.sourceId === id ? r.targetId : r.sourceId),
        );
        return other
          ? `<button data-action="inspect" data-key="${other.key}" data-id="${e(other.item.id)}"><span>${e(other.item.name)}</span>${badge(r.type)}<span>↗</span></button>`
          : "";
      })
      .join("") ||
    '<p class="muted">No connections yet. Add a relationship to bring this entry into the story.</p>'
  }</div><div class="dialog-actions">${btn("Edit entry", "edit-entity", "primary", `data-key="${key}" data-id="${e(id)}"`)}${btn("Find on map", "focus-graph", "secondary", `data-id="${e(id)}"`)}${btn("Delete entry", "delete-entity", "danger", `data-key="${key}" data-id="${e(id)}"`)}</div>`;
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
}
function editEntity(key = entityTab, id) {
  const item = world()[key].find((i) => i.id === id);
  const fields = {
    characters: ["role", "species", "personality", "goals", "secrets"],
    locations: ["region", "importance"],
    factions: ["leader", "ideology", "goals", "allies", "enemies"],
    loreNotes: ["category", "summary", "content"],
  }[key];
  if (dialog.open) dialog.close();
  openDialog(
    item ? "Edit entry" : `New ${types[key].toLowerCase()}`,
    `${formField("name", "Name", item?.name || "")}${formField("description", "Description", item?.description || "", "textarea")}<div class="form-columns">${formField(
      "canon",
      "Canon status",
      item?.canon || "canon",
      "select",
      [
        ["canon", "Canon · established"],
        ["draft", "Draft · exploring"],
      ],
    )}${formField("tags", "Tags, separated by commas", item?.tags || "")}</div>${fields.map((k) => formField(k, k[0].toUpperCase() + k.slice(1), item?.[k] || "", ["personality", "goals", "secrets", "content", "ideology"].includes(k) ? "textarea" : "input")).join("")}${formField("notes", "Creator notes", item?.notes || "", "textarea")}`,
    async (fd) => {
      if (!String(fd.get("name")).trim()) throw Error("An entry needs a name.");
      await commit((s) => {
        const w = currentDraft(s),
          now = new Date().toISOString();
        const next = {
          ...(item || {}),
          ...Object.fromEntries(fd),
          name: String(fd.get("name")).trim(),
          id: item?.id || uid(),
          created: item?.created || now,
          updated: now,
        };
        const index = w[key].findIndex((i) => i.id === next.id);
        if (index < 0) w[key].push(next);
        else w[key][index] = next;
        w.updated = now;
      }, "Entry saved");
    },
  );
}
function renderRelationships(main) {
  const w = world(),
    entities = new Map(allEntities(w).map((x) => [x.item.id, x.item]));
  const list = w.relationships
    .filter(
      (r) =>
        (!relationshipType || r.type === relationshipType) &&
        (!relationshipVisibility ||
          getRelationshipIntelligence(r).visibility ===
            relationshipVisibility) &&
        `${entities.get(r.sourceId)?.name} ${entities.get(r.targetId)?.name} ${JSON.stringify(r)}`
          .toLowerCase()
          .includes(relationshipQuery.toLowerCase()),
    )
    .sort(
      (a, b) =>
        getRelationshipIntelligence(b).influence -
        getRelationshipIntelligence(a).influence,
    );
  relationshipPage = Math.min(
    relationshipPage,
    Math.max(0, Math.ceil(list.length / 24) - 1),
  );
  main.innerHTML =
    header(
      "THE SPACE BETWEEN",
      "Relationships",
      "Alliances, secrets, and unfinished business. Follow what connects your world.",
      btn("＋ Add relationship", "new-relationship", "primary"),
    ) +
    `<div class="metrics-inline"><span><strong>${w.relationships.length}</strong> connections</span><span><strong>${w.relationships.filter((r) => getRelationshipIntelligence(r).visibility === "Secret").length}</strong> secrets</span><span><strong>${w.relationships.filter((r) => getRelationshipIntelligence(r).stability === "Volatile").length}</strong> volatile bonds</span></div><div class="toolbar"><input id="relationship-search" class="filter-input" aria-label="Search relationships" placeholder="Find a person, bond, or secret…" value="${e(relationshipQuery)}"/><select id="relationship-type" aria-label="Relationship type"><option value="">All types</option>${RELATIONSHIP_TYPES.map((t) => `<option ${t === relationshipType ? "selected" : ""}>${e(t)}</option>`).join("")}</select><select id="relationship-visibility" aria-label="Visibility"><option value="">All visibility</option>${["Public", "Secret", "Rumored"].map((t) => `<option ${t === relationshipVisibility ? "selected" : ""}>${t}</option>`).join("")}</select></div><p class="result-count">${list.length} connections · strongest influence first</p><div class="relationship-grid">${
      list
        .slice(relationshipPage * 24, relationshipPage * 24 + 24)
        .map((r) => {
          const intel = getRelationshipIntelligence(r);
          return `<article class="relationship-card"><div class="rel-top">${badge(r.type)}${badge(intel.visibility, intel.visibility === "Secret" ? "draft" : "")}</div><h3>${e(entities.get(r.sourceId)?.name || "Missing entry")} <span>→</span> ${e(entities.get(r.targetId)?.name || "Missing entry")}</h3><p>${e(r.description || "A connection waiting for its story.")}</p><div class="meter-row"><span>Strength <b>${intel.strength}/10</b></span><meter min="0" max="10" value="${intel.strength}"></meter></div><div class="meter-row"><span>Influence <b>${intel.influence}/10</b></span><meter min="0" max="10" value="${intel.influence}"></meter></div><div class="rel-footer"><span>${e(intel.stability)} · ${e(intel.tone)}<small>Story potential: ${e(intel.story?.level || "Emerging")}</small></span>${btn("Edit ↗", "edit-relationship", "text-button", `data-id="${e(r.id)}"`)}</div></article>`;
        })
        .join("") ||
      empty(
        "Make the first connection",
        "Who trusts whom? What place holds a secret? Connect two entries to begin.",
      )
    }</div>${pagination(list.length, relationshipPage, 24, "relationships")}`;
  const insights =
    allEntities(w).length < 500
      ? generateRelationshipInsights(w)
      : w.relationships
          .filter((r) => getRelationshipIntelligence(r).visibility === "Secret")
          .slice(0, 3)
          .map((r) => ({
            title: "A hidden connection",
            explanation: relationshipTitle(r, w),
            action:
              "Decide who would benefit if this connection became public.",
          }));
  if (insights.length)
    main.insertAdjacentHTML(
      "beforeend",
      `<section class="panel relationship-insights"><p class="eyebrow">WHAT THE CONNECTIONS SUGGEST</p><h2>Story threads to pull</h2><div class="guide-grid">${insights
        .slice(0, 3)
        .map(
          (i) =>
            `<article><h3>${e(i.title)}</h3><p>${e(i.explanation)}</p><p>${e(i.action)}</p></article>`,
        )
        .join("")}</div></section>`,
    );
  bindSearch("relationship-search", (v) => {
    relationshipQuery = v;
    relationshipPage = 0;
    renderRelationships(main);
  });
  document.querySelector("#relationship-type").onchange = (ev) => {
    relationshipType = ev.target.value;
    relationshipPage = 0;
    renderRelationships(main);
  };
  document.querySelector("#relationship-visibility").onchange = (ev) => {
    relationshipVisibility = ev.target.value;
    relationshipPage = 0;
    renderRelationships(main);
  };
}
function editRelationship(id) {
  const w = world(),
    r = w.relationships.find((r) => r.id === id),
    entities = allEntities(w);
  if (entities.length < 2) {
    toast("Add at least two entries to connect.");
    return;
  }
  const intel = r ? getRelationshipIntelligence(r) : {};
  const opts = entities.map(({ key, item }) => [
    item.id,
    `${item.name} (${types[key]})`,
  ]);
  openDialog(
    r ? "Edit relationship" : "Add relationship",
    `<div class="form-columns">${formField("sourceId", "From", r?.sourceId || opts[0][0], "select", opts)}${formField("targetId", "To", r?.targetId || opts[1][0], "select", opts)}</div>${formField("type", "Relationship type", r?.type || "Ally", "select", RELATIONSHIP_TYPES)}${formField("description", "What binds them?", r?.description || "", "textarea")}<div class="form-columns">${formField("strength", "Strength · 1–10", intel.strength || 5)}${formField("influence", "Influence · 1–10", intel.influence || 5)}${formField("visibility", "Who knows?", intel.visibility || "Public", "select", ["Public", "Secret", "Rumored"])}${formField("stability", "Stability", intel.stability || "Stable", "select", ["Stable", "Fragile", "Volatile"])}${formField("tone", "Emotional tone", intel.tone || "Respect", "select", ["Respect", "Loyalty", "Affection", "Admiration", "Fear", "Distrust", "Rivalry", "Hatred", "Obsession"])}${formField("tags", "Tags", r?.tags || "")}</div>${r ? btn("Delete this relationship", "delete-relationship", "danger", `type="button" data-id="${e(id)}"`) : ""}`,
    async (fd) => {
      const values = Object.fromEntries(fd);
      if (values.sourceId === values.targetId)
        throw Error("Choose two different entries.");
      for (const k of ["strength", "influence"]) {
        values[k] = Number(values[k]);
        if (!Number.isInteger(values[k]) || values[k] < 1 || values[k] > 10)
          throw Error(
            "Strength and influence must be whole numbers from 1 to 10.",
          );
      }
      values.sourceType =
        types[entities.find((x) => x.item.id === values.sourceId).key];
      values.targetType =
        types[entities.find((x) => x.item.id === values.targetId).key];
      await commit((s) => {
        const next = {
          ...r,
          ...values,
          id: r?.id || uid(),
          created: r?.created || new Date().toISOString(),
          updated: new Date().toISOString(),
        };
        const u = currentDraft(s),
          i = u.relationships.findIndex((x) => x.id === next.id);
        if (i < 0) u.relationships.push(next);
        else u.relationships[i] = next;
      }, "Relationship saved");
    },
  );
}
function renderGraph(main) {
  const w = world(),
    all = allEntities(w),
    byId = new Map(all.map((x) => [x.item.id, x]));
  let selected = byId.get(graphSelection);
  if (!selected) {
    selected = all[0];
    graphSelection = selected?.item.id || "";
  }
  const connected = w.relationships.filter(
      (r) => r.sourceId === graphSelection || r.targetId === graphSelection,
    ),
    neighborIds = new Set(connected.flatMap((r) => [r.sourceId, r.targetId]));
  const matches = all.filter(
    (x) =>
      (!graphType || x.key === graphType) &&
      `${x.item.name} ${x.item.tags}`
        .toLowerCase()
        .includes(graphQuery.toLowerCase()),
  );
  const nodes = [...matches]
    .sort(
      (a, b) =>
        Number(neighborIds.has(b.item.id)) - Number(neighborIds.has(a.item.id)),
    )
    .slice(0, 70);
  if (selected && !nodes.some((n) => n.item.id === graphSelection))
    nodes.unshift(selected);
  const nodeIds = new Set(nodes.map((n) => n.item.id)),
    edges = w.relationships
      .filter((r) => nodeIds.has(r.sourceId) && nodeIds.has(r.targetId))
      .slice(0, 180);
  const coords = new Map(
    nodes.map((n, i) => {
      if (n.item.id === graphSelection) return [n.item.id, [420, 280]];
      const angle = i * 2.39996,
        radius = 110 + Math.sqrt(i / nodes.length) * 160;
      return [
        n.item.id,
        [
          420 + Math.cos(angle) * radius * 1.23,
          280 + Math.sin(angle) * radius * 0.87,
        ],
      ];
    }),
  );
  main.innerHTML =
    header(
      "SEE THE BIGGER PICTURE",
      "Your constellation",
      "Every point is an entry. Every line is a connection. Select a point to follow its story.",
      btn("＋ Connect entries", "new-relationship", "primary"),
    ) +
    `<div class="toolbar"><input class="filter-input" id="graph-search" aria-label="Search constellation" placeholder="Focus on a name or tag…" value="${e(graphQuery)}"/><select id="graph-type" aria-label="Map entry type"><option value="">All entry types</option>${Object.entries(
      collections,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${graphType === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select><span class="muted small">${nodes.length} of ${all.length} entries · ${edges.length} connections shown</span></div><div class="map-layout"><section class="map-canvas"><div class="map-label">${e(w.name)}<small>AN ATLAS OF CONNECTIONS</small></div><svg id="world-graph" viewBox="0 0 840 560" role="group" aria-label="Interactive relationship map"><g class="graph-scene" transform="translate(420 280) scale(${graphZoom}) translate(-420 -280)">${edges
      .map((r) => {
        const a = coords.get(r.sourceId),
          b = coords.get(r.targetId);
        return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="graph-edge ${r.sourceId === graphSelection || r.targetId === graphSelection ? "focused" : ""}" ${getRelationshipIntelligence(r).visibility === "Secret" ? 'stroke-dasharray="4 5"' : ""}/>`;
      })
      .join("")}${nodes
      .map(({ key, item }) => {
        const [x, y] = coords.get(item.id),
          sel = item.id === graphSelection;
        return `<g transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="Explore ${e(item.name)}" data-action="graph-node" data-id="${e(item.id)}" class="graph-node ${key} ${sel ? "selected" : ""}"><circle r="${sel ? 27 : 11}"/><circle r="${sel ? 35 : 17}" class="node-halo"/><text y="${sel ? 53 : 31}" text-anchor="middle">${e(item.name.length > 25 ? item.name.slice(0, 24) + "…" : item.name)}</text></g>`;
      })
      .join(
        "",
      )}</g></svg><div class="map-bottom"><div class="legend">${Object.entries(
      collections,
    )
      .map(([k, v]) => `<span class="${k}"><i></i>${v}</span>`)
      .join(
        "",
      )}</div><div class="zoom">${btn("−", "zoom-out", "icon-button", 'aria-label="Zoom out"')}${btn("Reset", "zoom-reset", "text-button")}${btn("＋", "zoom-in", "icon-button", 'aria-label="Zoom in"')}</div></div></section><aside class="panel map-inspector">${
      selected
        ? `<p class="eyebrow">IN FOCUS · ${types[selected.key]}</p><h2>${e(selected.item.name)}</h2><p>${e(selected.item.description || "An unwritten entry.")}</p>${btn("Open entry ↗", "inspect", "secondary", `data-key="${selected.key}" data-id="${e(graphSelection)}"`)}<h3>Follow a connection <span class="muted">${connected.length}</span></h3><div class="connection-list">${
            connected
              .slice(0, 35)
              .map((r) => {
                const other = byId.get(
                  r.sourceId === graphSelection ? r.targetId : r.sourceId,
                );
                return other
                  ? `<button data-action="graph-node" data-id="${e(other.item.id)}"><span>${e(other.item.name)}<small>${e(r.type)} · ${e(getRelationshipIntelligence(r).visibility)}</small></span><span>↗</span></button>`
                  : "";
              })
              .join("") || '<p class="muted">No connections yet.</p>'
          }</div>`
        : empty(
            "Your map begins here",
            "Add entries to reveal your constellation.",
          )
    }</aside></div><section class="panel path-panel"><h3>Find the thread between two entries</h3><div class="toolbar"><select id="path-source" aria-label="Path start">${all.map((n) => `<option value="${e(n.item.id)}">${e(n.item.name)}</option>`).join("")}</select><span>→</span><select id="path-target" aria-label="Path end">${all.map((n, i) => `<option value="${e(n.item.id)}" ${i === 1 ? "selected" : ""}>${e(n.item.name)}</option>`).join("")}</select>${btn("Trace connection", "find-path")}</div><p id="path-result" class="muted" aria-live="polite">Trace the shortest chain of relationships. Connections can be followed in either direction.</p></section>`;
  bindSearch("graph-search", (v) => {
    graphQuery = v;
    renderGraph(main);
  });
  document.querySelector("#graph-type").onchange = (ev) => {
    graphType = ev.target.value;
    renderGraph(main);
  };
}
function auditIssues(w) {
  const issues = [],
    all = allEntities(w),
    ids = new Set(all.map((n) => n.item.id)),
    seen = new Map();
  for (const { key, item } of all) {
    const name = item.name.toLowerCase().trim();
    if (seen.has(name))
      issues.push({
        title: `Shared name: ${item.name}`,
        detail:
          "Two entries share this name. Clarify their identities or rename one.",
        key,
        id: item.id,
        level: "Review",
      });
    seen.set(name, item.id);
    if (!item.description?.trim())
      issues.push({
        title: `${item.name} needs a description`,
        detail:
          "Give this entry enough context to be useful in the codex and chat.",
        key,
        id: item.id,
        level: "Suggestion",
      });
    if (key === "characters" && !item.goals?.trim())
      issues.push({
        title: `What does ${item.name} want?`,
        detail: "A clear goal makes a character easier to write and connect.",
        key,
        id: item.id,
        level: "Suggestion",
      });
  }
  for (const r of w.relationships) {
    if (!ids.has(r.sourceId) || !ids.has(r.targetId))
      issues.push({
        title: "A connection points to a missing entry",
        detail: r.description || r.type,
        id: r.id,
        level: "Broken link",
        relationship: true,
      });
  }
  const linked = new Set(
    w.relationships.flatMap((r) => [r.sourceId, r.targetId]),
  );
  for (const { key, item } of all)
    if (!linked.has(item.id))
      issues.push({
        title: `${item.name} is unconnected`,
        detail:
          "Add one meaningful relationship to place this entry in the wider world.",
        key,
        id: item.id,
        level: "Suggestion",
      });
  return issues;
}
function renderAudit(main) {
  const issues = auditIssues(world());
  main.innerHTML =
    header(
      "MAKE THE WORLD HOLD TOGETHER",
      "Continuity",
      "Find missing pieces and broken links. These checks suggest questions; they do not decide your canon.",
    ) +
    `<div class="audit-summary"><span class="audit-symbol">◎</span><div><h2>${issues.length ? `${issues.length} threads to review` : "Your foundations look connected"}</h2><p>Checks cover missing references, duplicate names, empty descriptions, character goals, and isolated entries.</p></div>${badge("STRUCTURAL CHECKS")}</div><div class="issue-list">${issues
      .slice(0, 100)
      .map(
        (i) =>
          `<article class="issue"><div>${badge(i.level)}<h3>${e(i.title)}</h3><p>${e(i.detail)}</p></div>${btn("Review ↗", i.relationship ? "edit-relationship" : "inspect", "secondary", `data-id="${e(i.id)}" ${i.key ? `data-key="${i.key}"` : ""}`)}</article>`,
      )
      .join(
        "",
      )}</div>${issues.length > 100 ? '<p class="muted">Showing the first 100 findings. Review a few, then run the check again.</p>' : ""}<p class="footnote">Language-level contradictions and fictional plausibility still need your judgment. A clean structural check is not proof of narrative consistency.</p>`;
}
function renderTimeline(main) {
  const events = world().events || [];
  main.innerHTML =
    header(
      "THE WORLD REMEMBERS",
      "Timeline",
      "Record what happened, what someone believes, and what became a myth.",
      btn("＋ Record a moment", "new-event", "primary"),
    ) +
    `<div class="timeline-intro">${badge("FACT", "fact")}${badge("BELIEF", "draft")}${badge("MYTH", "myth")}<p>Different kinds of truth, kept distinct. Every moment keeps its source.</p></div><div class="timeline">${
      events
        .slice()
        .reverse()
        .map(
          (ev) =>
            `<article class="timeline-event"><div class="timeline-date">${e(ev.date || prettyDate(ev.created))}<span></span></div><div class="panel"><div class="rel-top">${badge(ev.kind, ev.kind)}<small class="muted">${e(ev.source || "Creator-authored")}</small></div><h2>${e(ev.title)}</h2><p>${e(ev.detail)}</p></div></article>`,
        )
        .join("") ||
      empty(
        "What happened here?",
        "Record a discovery, a promise, or an event that changes how you see this world.",
        btn("Record the first moment", "new-event", "primary"),
      )
    }</div><p class="footnote">Timeline entries are entered and edited by the creator.</p>`;
}
function newEvent() {
  openDialog(
    "Record a moment",
    `${formField("name", "Title")}${formField("date", "In-world date or chapter · free text", "")}${formField(
      "kind",
      "Kind of record",
      "fact",
      "select",
      [
        ["fact", "Fact · established event"],
        ["belief", "Belief · held by someone"],
        ["myth", "Myth · told in the world"],
      ],
    )}${formField("detail", "What happened, or what is believed?", "", "textarea")}${formField("source", "Source / whose belief?", "Creator-authored")}<p class="muted small">Timeline entries are kept as written. Add a later correction rather than silently replacing history.</p>`,
    async (fd) => {
      if (!String(fd.get("name")).trim() || !String(fd.get("detail")).trim())
        throw Error("Add both a title and a description.");
      await commit((s) => {
        const w = currentDraft(s);
        w.events ||= [];
        w.events.push({
          id: uid(),
          title: String(fd.get("name")).trim(),
          date: String(fd.get("date")),
          kind: String(fd.get("kind")),
          detail: String(fd.get("detail")),
          source: String(fd.get("source")),
          created: new Date().toISOString(),
        });
      }, "Moment recorded");
    },
  );
}
async function startLocalDraft() {
  if (worker || aiDraftController || generation) return;
  if (!state.localAI?.enabled) {
    toast("Enable a local model in Settings first.");
    return;
  }
  if (!promptDraft.trim()) {
    toast("Describe a small scene or story seed first.");
    return;
  }
  const controller = new AbortController();
  aiDraftController = controller;
  const target = structuredClone(world());
  const prompt = promptDraft;
  render();
  try {
    const draft = await createLocalDraft(
      state.localAI,
      target,
      prompt,
      controller.signal,
    );
    if (controller.signal.aborted) return;
    generation = { ...draft, worldId: target.id };
    previewPage = 0;
    previewTab = draft.characters.length
      ? "characters"
      : Object.keys(collections).find((k) => draft[k].length);
    toast("Local AI draft ready. Review before adding it.");
  } catch (err) {
    if (!controller.signal.aborted)
      toast(`Local AI stopped: ${err.message} No paid fallback was used.`);
  } finally {
    if (aiDraftController === controller) aiDraftController = null;
    render();
  }
}
function renderArchitect(main) {
  if (generation) {
    renderPreview(main);
    return;
  }
  main.innerHTML =
    header(
      "FROM POSSIBILITY TO PLACE",
      "World Architect",
      "Describe a world. Review its blueprint. Keep only what belongs.",
    ) +
    `<div class="architect-layout"><section class="panel architect-composer"><div class="step-label"><span>01</span> THE IDEA</div><h2>What are we imagining?</h2><label class="field"><span class="muted">Be specific about species, scale, atmosphere, and limits.</span><textarea id="world-prompt" rows="7" placeholder="A thriving cat-only Type II civilization around a red dwarf star, with 500 citizens. No magic.">${e(promptDraft)}</textarea></label><div class="prompt-examples">${["An ancient vampire empire with 12 characters", "A Type I civilization with 5 countries, 3 cities per country and 300 citizens", "A thriving cat-only Type II civilization around a red dwarf star with 800 citizens"].map((p, i) => btn(["A gothic court", "A planetary civilization", "A feline star system"][i], "prompt-example", "prompt-chip", `data-prompt="${e(p)}"`)).join("")}</div><div class="toolbar"><label class="field compact">Detail profile<select id="generation-profile">${[
      ["", "Auto detect"],
      ["minimal", "Minimal"],
      ["standard", "Standard"],
      ["detailed", "Detailed"],
      ["massive", "Massive"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${v === generationProfile ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></label>${btn(worker || aiDraftController ? "Working…" : "Review blueprint →", "blueprint", "primary", worker || aiDraftController ? "disabled" : "")}</div><div id="generation-status" role="status">${worker || aiDraftController ? '<p class="working">' + (aiDraftController ? "Your local model is writing a story seed. This may take up to two minutes." : "Building in a background worker. You can continue exploring.") + "</p>" + btn("Cancel generation", "cancel-generation") : ""}</div><p class="footnote">Procedural World Seeder · runs on your device · no AI model required. The result is a starting point for your authorship.</p><div class="local-draft-option"><p class="eyebrow">OR, FOLLOW A DIFFERENT THREAD</p><h3>A story seed from your local AI.</h3><p>Develop this brief into a compact cast, place, or piece of lore: 1–8 entries total. For exact population counts or large civilizations, use the procedural blueprint above.</p>${btn("Draft with local AI ✦", "local-draft", "secondary", worker || aiDraftController || !state.localAI?.enabled ? "disabled" : "")}<p class="footnote">${state.localAI?.enabled ? e(state.localAI.model || "Choose a model in Settings") + " · runs on your device · no usage charge" : '<a href="#settings">Set up a local model in Settings</a>. No subscription or credits.'}</p></div></section><aside class="architect-side"><div class="panel"><p class="eyebrow">A GOOD PROMPT HAS</p><ol class="prompt-guide"><li><strong>A place in the universe</strong><span>A person, a city, a planet, or a civilization.</span></li><li><strong>Something distinctive</strong><span>Who lives here? What changes everyday life?</span></li><li><strong>Rules worth respecting</strong><span>No magic. Only cats. Exactly 500 citizens.</span></li></ol></div><div class="architect-promise"><span>✧</span><h3>Your canon stays yours.</h3><p>Everything begins as a draft. Edit, exclude, or cancel before adding it to your world.</p></div></aside></div>`;
  document.querySelector("#world-prompt").oninput = (ev) =>
    (promptDraft = ev.target.value);
  document.querySelector("#generation-profile").onchange = (ev) =>
    (generationProfile = ev.target.value);
}
function blueprint() {
  if (!promptDraft.trim()) {
    toast("Describe the world you want to build first.");
    return;
  }
  const analysis = analyzeWorldPrompt(promptDraft, generationProfile);
  const constraints = reviewArchitectBrief(promptDraft);
  const bp = analysis.blueprint;
  openDialog(
    "Review the blueprint",
    `<details><summary>Author brief</summary><p>${e(promptDraft)}</p></details>${formField(
      "scope",
      "Generation scope",
      constraints.scope,
      "select",
      [
        ["settlement", "Compact settlement — one place and a named cast"],
        ["legacy", "Larger world — procedural scale defaults"],
      ],
    )}<section id="settlement-constraints" ${constraints.scope === "settlement" ? "" : "hidden"}><p>Review these fields before generating. Compact drafts add exactly one place, the cast below, and zero or one central conflict. No extra countries, factions or mysteries are added. The detail profile does not increase these counts.</p>${constraints.warnings.length ? `<ul class="footnote">${constraints.warnings.map((warning) => `<li>${e(warning)}</li>`).join("")}</ul>` : ""}<div class="form-columns">${formField("settlementName", "Settlement name", constraints.name)}${formField("settlementType", "Settlement type", constraints.settlementType, "select", ["village", "hamlet", "town", "settlement", "city"])}${formField("characterCount", "Character count", constraints.characterCount)}${formField("species", "Default species", constraints.species)}${formField("magicMode", "Magic rule", constraints.magicMode)}${formField("conflictCount", "Central conflict count", constraints.conflictCount, "select", ["0", "1"])}</div>${formField("cast", "Named cast", castToText(constraints.cast), "textarea")}<p class="footnote">One character per line: Name | Role | Species | Goal. A blank species uses Default species. Recognized names and roles use the form “Name the role”; goals use “Name wants/needs …”. Edit anything missed or incorrect.</p>${formField("conflict", "Central conflict", constraints.conflict, "textarea")}<p id="compact-counts" role="status"></p><p class="footnote">Other instructions remain in the author brief. This offline seeder does not understand arbitrary prose, infer politics, or resolve the disagreement. The reviewed fields control the draft.</p></section><section id="legacy-constraints" ${constraints.scope === "legacy" ? "" : "hidden"}><div class="blueprint-grid">${Object.entries(
      bp,
    )
      .filter(([, v]) => typeof v === "number" && v > 0)
      .map(
        ([k, v]) =>
          `<div><strong>${v.toLocaleString()}</strong><span>${e(k.replace(/([A-Z])/g, " $1"))}</span></div>`,
      )
      .join(
        "",
      )}</div><dl class="blueprint-details"><dt>Scale</dt><dd>${e(analysis.scaleLabel || analysis.scale)}</dd><dt>Technology</dt><dd>${e(analysis.technologyLevel)}</dd><dt>Species</dt><dd>${e(analysis.speciesLabel)}</dd><dt>Magic</dt><dd>${e(analysis.magicMode)}</dd></dl><p class="footnote">Larger-world seeding uses procedural defaults and may invent names, roles and conflicts. Use Compact settlement above for a supplied cast and one dispute. Cancel and edit the prompt for other scale changes.${analysis.performancePlan?.requiresWarning ? " This is a large generation; the worker keeps the interface responsive while it runs." : ""}</p></section>`,
    async (form) => {
      const reviewed =
        form.get("scope") === "settlement"
          ? validateSettlementConstraints({
              ...constraints,
              scope: "settlement",
              name: form.get("settlementName"),
              settlementType: form.get("settlementType"),
              characterCount: Number(form.get("characterCount")),
              species: form.get("species"),
              magicMode: form.get("magicMode"),
              conflictCount: Number(form.get("conflictCount")),
              conflict: form.get("conflict"),
              cast: castFromText(form.get("cast"), form.get("species")),
            })
          : { scope: "legacy" };
      startGeneration(reviewed);
    },
  );
  dialog.querySelector("[type=submit]").textContent = "Generate draft";
  const updateConstraintReview = () => {
    const compact =
      dialog.querySelector('[name="scope"]').value === "settlement";
    dialog.querySelector("#settlement-constraints").hidden = !compact;
    dialog.querySelector("#legacy-constraints").hidden = compact;
    const count = dialog.querySelector('[name="characterCount"]').value;
    const conflicts = dialog.querySelector('[name="conflictCount"]').value;
    dialog.querySelector("#compact-counts").textContent =
      `Draft plan: 1 place, ${count} characters, ${conflicts} central conflict(s).`;
  };
  dialog
    .querySelector("form")
    .addEventListener("input", updateConstraintReview);
  updateConstraintReview();
}
function startGeneration(constraints) {
  if (worker || aiDraftController || generation) return;
  const universe = cleanSnapshot(state).universes.find(
    (w) => w.id === state.currentUniverseId,
  );
  const worldId = universe.id;
  worker = new Worker(new URL("./generation-worker.js", import.meta.url), {
    type: "module",
  });
  const activeWorker = worker;
  worker.onmessage = ({ data }) => {
    if (worker !== activeWorker) return;
    if (data.phase) {
      const status = document.querySelector("#generation-status");
      if (status) status.textContent = data.phase;
      return;
    }
    worker.terminate();
    worker = null;
    if (data.error) {
      toast(`Generation failed: ${data.error}`);
      render();
      return;
    }
    generation = { ...data.generated, worldId };
    previewPage = 0;
    previewTab = "characters";
    toast("Your draft is ready to review");
    if (activePage === "ai") render();
  };
  worker.onerror = () => {
    if (worker !== activeWorker) return;
    worker.terminate();
    worker = null;
    toast("The generation worker failed. Your world was not changed.");
    render();
  };
  worker.postMessage({
    prompt: promptDraft,
    profile: generationProfile,
    constraints,
    universe,
  });
  render();
}
function previewCollection() {
  return previewTab === "loreNotes"
    ? [
        ...generation.loreNotes,
        ...(generation.conflicts || []),
        ...(generation.mysteries || []),
      ]
    : generation[previewTab];
}
function renderPreview(main) {
  const target = state.universes.find((w) => w.id === generation.worldId);
  const groups = { ...collections, relationships: "Relationships" },
    list = previewCollection(),
    warnings = generation.analysis.validationWarnings || [];
  main.innerHTML =
    header(
      "02 / REVIEW YOUR DRAFT",
      "A new corner of your world",
      `Destination: ${target?.name || "Missing world"}. Edit entries and exclude anything you do not want.`,
      btn("Discard draft", "discard-generation") +
        btn("Add approved entries", "save-generation", "primary"),
    ) +
    `<div class="draft-banner">${badge("NOT YET IN YOUR WORLD", "draft")}<span>${e(generation.analysis.scaleLabel)} · ${generation.characters.length.toLocaleString()} characters · ${generation.relationships.length.toLocaleString()} connections</span></div>${warnings.length ? `<details class="validation-panel" open><summary>${warnings.length} validation notes to review</summary><ul>${warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul></details>` : '<p class="validation-ok">✓ The seeder’s built-in checks found no issues. Review the content before accepting.</p>'}<div class="tabs" role="tablist" aria-label="Draft sections">${Object.entries(
      groups,
    )
      .map(
        ([k, v]) =>
          `<button role="tab" aria-selected="${k === previewTab}" data-action="preview-tab" data-key="${k}">${v} <span>${k === "loreNotes" ? generation.loreNotes.length + (generation.conflicts?.length || 0) + (generation.mysteries?.length || 0) : generation[k].length}</span></button>`,
      )
      .join("")}</div><div class="draft-list">${list
      .slice(previewPage * 24, previewPage * 24 + 24)
      .map(
        (item) =>
          `<article class="draft-item ${item._include === false ? "excluded" : ""}"><label class="include-toggle"><input type="checkbox" data-include="${e(item.id)}" ${item._include !== false ? "checked" : ""}/> Include</label><div><h3>${e(item.name || relationshipTitle(item, generation))}</h3><p>${e(item.description || item.content || "")}</p></div>${previewTab === "relationships" ? "" : btn("Edit", "edit-draft", "secondary", `data-id="${e(item.id)}"`)}</article>`,
      )
      .join(
        "",
      )}</div>${pagination(list.length, previewPage, 24, "preview")}<p class="footnote">Excluded entries also exclude relationships pointing to them. All approved generated entries are marked Draft. Large previews are paginated; every page remains editable.</p>`;
}
function relationshipTitle(r, w) {
  const names = new Map(allEntities(w).map((n) => [n.item.id, n.item.name]));
  for (const item of [...(w.conflicts || []), ...(w.mysteries || [])])
    names.set(item.id, item.name);
  return `${names.get(r.sourceId) || "?"} → ${names.get(r.targetId) || "?"} · ${r.type}`;
}
async function saveGeneration() {
  const gen = generation;
  if (!gen) return;
  await commit((s) => {
    const w = s.universes.find((w) => w.id === gen.worldId);
    if (!w) throw Error("The destination world no longer exists.");
    const accepted = {};
    for (const key of Object.keys(collections)) {
      const source =
        key === "loreNotes"
          ? [
              ...gen.loreNotes,
              ...(gen.conflicts || []),
              ...(gen.mysteries || []),
            ]
          : gen[key];
      accepted[key] = source
        .filter((i) => i._include !== false)
        .map((i) => {
          const copy = { ...i, canon: "draft" };
          delete copy._include;
          return copy;
        });
    }
    const ids = new Set([
      ...allEntities(w).map((n) => n.item.id),
      ...Object.values(accepted)
        .flat()
        .map((i) => i.id),
    ]);
    for (const loc of accepted.locations)
      loc.associatedFactions = (loc.associatedFactions || []).filter((id) =>
        ids.has(id),
      );
    for (const key of Object.keys(collections)) w[key].push(...accepted[key]);
    for (const r of gen.relationships)
      if (r._include !== false && ids.has(r.sourceId) && ids.has(r.targetId)) {
        const copy = { ...r };
        delete copy._include;
        w.relationships.push(copy);
      }
    w.generatorRuns ||= [];
    if (gen.generationRunMetadata)
      w.generatorRuns.push(gen.generationRunMetadata);
    if (gen.aiProvenance) {
      w.aiDraftRuns ||= [];
      w.aiDraftRuns.push(gen.aiProvenance);
    }
    w.events ||= [];
    w.events.push({
      id: uid(),
      title: "A new draft enters the world",
      detail: `Approved ${Object.values(accepted).flat().length} draft entries from: ${gen.analysis.originalPrompt}`,
      kind: "fact",
      date: "Creative session",
      source: gen.aiProvenance
        ? "Creator-approved local AI draft"
        : "Creator-approved World Seeder run",
      created: new Date().toISOString(),
    });
    w.updated = new Date().toISOString();
    s.currentUniverseId = w.id;
  }, "Approved draft saved");
  generation = null;
  navigate("entities");
}
function renderChat(main) {
  const w = world();
  main.innerHTML =
    header(
      "A SECOND PAIR OF EYES",
      "Universe Chat",
      "Ask about the world you have built, or find the next thread to follow.",
    ) +
    `<section class="chat-workspace"><div class="chat-mode-bar"><label>Reader mode <select id="chat-mode"><option value="offline" ${chatMode === "offline" ? "selected" : ""}>Offline world reader</option>${state.localAI?.enabled ? '<option value="local" ' + (chatMode === "local" ? "selected" : "") + ">Local AI · " + e(state.localAI.model || "choose model in settings") + "</option>" : ""}</select></label>${badge("READ-ONLY · NEVER EDITS CANON")}</div><div class="chat-messages" id="chat-messages" role="log" aria-live="polite">${(w.chat || []).length ? (w.chat || []).map((m) => `<div class="message ${m.role === "user" ? "user" : "assistant"}"><p class="eyebrow">${m.role === "user" ? "YOU" : e(m.mode || "WORLD READER")}</p><p>${e(m.text)}</p></div>`).join("") : `<div class="chat-welcome"><span>✦</span><h2>There’s a story in here.</h2><p>I can explore your entries, trace relationships, and suggest where to go next.</p><div class="chat-prompts">${["Summarize my universe", "Who are the main characters?", "What conflicts exist?", "What should I build next?"].map((q) => btn(q, "chat-prompt", "prompt-chip", `data-prompt="${e(q)}"`)).join("")}</div></div>`}</div><form id="chat-form" class="chat-composer"><label class="sr-only" for="chat-input">Ask about your world</label><input id="chat-input" placeholder="What is this world trying to tell us?" autocomplete="off" required maxlength="4000"/><button class="button primary" type="submit">Send ↑</button></form><p class="footnote">Offline reader uses stored entries and local rules. Local AI, when enabled, receives a bounded world excerpt and may invent details; its replies remain suggestions.</p></section>`;
  document.querySelector("#chat-mode").onchange = (ev) => {
    chatMode = ev.target.value;
  };
  document.querySelector("#chat-form").onsubmit = (ev) => {
    ev.preventDefault();
    sendChat(document.querySelector("#chat-input").value);
  };
  document.querySelector("#chat-messages").scrollTop = 999999;
}
async function sendChat(q) {
  q = q.trim();
  if (!q) return;
  const w = world(),
    worldId = w.id,
    mode = document.querySelector("#chat-mode").value;
  const send = document.querySelector("#chat-form button");
  send.disabled = true;
  send.textContent = "Reading…";
  try {
    let answer;
    if (mode === "local") {
      answer = await askLocalAI(state.localAI, w, q, allEntities(w));
    } else {
      const context = {
        ...w,
        relationshipIndex: buildRelationshipIndex(w.relationships),
      };
      if (/premise|world rules|creative goals/i.test(q)) {
        answer = `${w.name}\n\nPremise: ${w.premise || "Not yet written."}\n\nWorld rules: ${w.rules || "Not yet written."}\n\nCreative goals:\n${(w.goals || []).map((g) => `${g.done ? "Done" : "Open"}: ${g.text}`).join("\n") || "No goals recorded yet."}`;
      } else if (/timeline|recent events|beliefs|myths/i.test(q)) {
        answer =
          (w.events || [])
            .slice(-10)
            .map(
              (ev) =>
                `[${ev.kind.toUpperCase()}] ${ev.title}: ${ev.detail} (Source: ${ev.source || "Creator"})`,
            )
            .join("\n\n") ||
          "No timeline moments are recorded yet. Add a fact, belief, or myth in Timeline.";
      } else answer = answerWorldbuildingQuestion(context, q);
    }
    await commit((s) => {
      const target = s.universes.find((x) => x.id === worldId);
      target.chat ||= [];
      target.chat.push(
        { role: "user", text: q, created: new Date().toISOString() },
        {
          role: "assistant",
          mode:
            mode === "local" ? "LOCAL AI · SUGGESTION" : "OFFLINE WORLD READER",
          text: answer,
          created: new Date().toISOString(),
        },
      );
    }, "");
  } catch (err) {
    toast(err.message);
  } finally {
    if (send.isConnected) {
      send.disabled = false;
      send.textContent = "Send ↑";
    }
  }
}
function renderSettings(main) {
  main.innerHTML =
    header(
      "YOURS, BY DESIGN",
      "Settings & backups",
      "Your worlds belong to you. Keep a portable copy and choose how you work.",
    ) +
    themeChooser(state) +
    `<section class="ownership-note"><span>✦</span><div><p class="eyebrow">IMAGINATION WITHOUT A METER</p><h2>No credits. No per-message charges.</h2><p>Dreamforge’s AI runs on your device. Chat and Architect share the same local model, with no paid fallback. Your hardware supplies the computing power; speed and quality depend on the model. The studio and procedural tools work without a model.</p><p>Your prompts and worlds stay on this device. There is no remote moderation service or fiction keyword blacklist. A model may still decline a request; you can choose another compatible local model without losing your work.</p></div></section><div class="settings-grid"><section class="panel"><p class="eyebrow">KEEP YOUR WORLDS SAFE</p><h2>A copy you can carry.</h2><p>Worlds save to this browser’s IndexedDB. A JSON backup includes entries, relationships, briefs, goals, timeline, and chat.</p><div class="actions">${btn("↓ Export all worlds", "export", "primary")}${btn("Recover previous save", "recover")}</div><label class="import-zone">↑ Import a Dreamforge backup<input id="import-file" type="file" accept=".json,application/json"/><small>Imports are added as separate worlds. Existing worlds are preserved.</small></label><p class="footnote">Browser storage belongs to this exact address and browser profile. Use Export → Import to move from another port or browser. Clearing browser data can remove local saves.</p></section><section class="panel"><p class="eyebrow">OPTIONAL, ALWAYS</p><h2>A local AI collaborator.</h2><p>Connect an installed Ollama model for Chat and Architect. Run <strong>Start-Local-AI.cmd</strong> in your DreamForge folder for a local server with Ollama cloud features disabled; then use <strong>Find my local AI</strong>. It reuses installed models without downloading anything.</p><form id="local-ai-form">${formField("endpoint", "Ollama address", state.localAI?.endpoint || "http://127.0.0.1:11434")}${formField("model", "Model name", state.localAI?.model || "")}<label class="goal"><input name="enabled" type="checkbox" ${state.localAI?.enabled ? "checked" : ""}/> Enable local AI in Universe Chat and Architect</label><div class="actions"><button type="submit" class="button primary">Save AI settings</button>${btn("Check connection", "check-ai", "secondary", 'type="button"')}${btn("Find my local AI", "discover-ai", "text-button", 'type="button"')}</div><p id="ai-status" role="status" class="small muted"></p><div id="installed-models"></div></form><p class="footnote">Localhost addresses only. Requests go directly from this browser to Ollama. Its allowed origins must include this studio’s address. No model is downloaded or started automatically.</p></section></div><section class="panel danger-zone"><div><h3>Manage the current world</h3><p>${world() ? e(world().name) : "No world selected"}</p></div>${btn("Delete current world", "delete-world", "danger", world() ? "" : "disabled")}</section>`;
  document.querySelector("#import-file").onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const imported = validateImport(JSON.parse(await file.text()));
      if (!imported.universes.length)
        throw Error("This backup contains no worlds.");
      openDialog(
        "Import worlds as copies",
        `<p>${imported.universes.length} world(s) will be added. Your existing worlds will stay as they are.</p><ul>${imported.universes.map((w) => `<li>${e(w.name)} · ${allEntities(w).length} entries</li>`).join("")}</ul>`,
        async () => {
          await commit((s) => {
            for (const w of imported.universes) {
              w.id = uid();
              if (s.universes.some((u) => u.name === w.name))
                w.name += " (imported)";
              s.universes.push(w);
            }
            s.currentUniverseId = imported.universes[0].id;
          }, "Backup imported as separate worlds");
        },
      );
      dialog.querySelector("[type=submit]").textContent = "Import copies";
    } catch (err) {
      toast(`Import stopped: ${err.message}`);
    }
    ev.target.value = "";
  };
  document.querySelector("#local-ai-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      const endpoint = validateEndpoint(String(fd.get("endpoint")));
      await commit((s) => {
        s.localAI = {
          enabled: fd.has("enabled"),
          endpoint,
          model: String(fd.get("model")).trim(),
        };
      }, "Local AI preferences saved");
    } catch (err) {
      toast(err.message);
    }
  };
}
function renderGuide(main) {
  main.innerHTML =
    header(
      "YOUR FIELD GUIDE",
      "Worlds worth getting lost in.",
      "Dreamforge is a private studio for authoring, connecting, and exploring fictional worlds.",
    ) +
    `<section class="guide-intro panel"><p class="eyebrow">THE NORTH STAR</p><h2>Return. Discover. Investigate.<br>Intervene. Witness consequences.</h2><p>That is the long-term Dreamforge vision. Today’s studio makes your world readable and editable, helps you seed new material, and keeps creator choices explicit.</p></section><div class="guide-grid">${[
      [
        "01",
        "Start with the brief",
        "Write the premise, genre, rules, and a few creative goals on your World desk. Those are the boundaries for your authorship.",
      ],
      [
        "02",
        "Give your world inhabitants",
        "Add characters, locations, factions, and lore in the Codex. Mark established entries Canon and unresolved ideas Draft.",
      ],
      [
        "03",
        "Make the connections matter",
        "Relationships carry strength, influence, visibility, stability, and tone. Explore the constellation or trace a path between entries.",
      ],
      [
        "04",
        "Create, then decide",
        "The Architect interprets a prompt, shows a blueprint, and produces an editable draft. Nothing joins the world until you approve it.",
      ],
      [
        "05",
        "Keep different truths distinct",
        "Record facts, beliefs, and myths in the Timeline, with their sources. Continuity flags structural gaps for you to review.",
      ],
      [
        "06",
        "Take your worlds with you",
        "Export a JSON backup regularly. Import older Dreamforge exports as copies. Optional local AI can read a bounded excerpt in Chat.",
      ],
    ]
      .map(
        ([n, t, d]) =>
          `<article class="panel"><span class="guide-number">${n}</span><h3>${t}</h3><p>${d}</p></article>`,
      )
      .join("")}</div>`;
}
function searchDialog() {
  const entries = state.universes.flatMap((w) =>
    allEntities(w).map((x) => ({ ...x, worldId: w.id, worldName: w.name })),
  );
  dialog.innerHTML = `<div class="dialog-heading"><h2>Find anything</h2><button class="icon-button" data-close aria-label="Close dialog">×</button></div><input id="global-search" class="global-search" aria-label="Search all worlds" placeholder="A name, a place, a fragment of lore…"/><div id="search-results" class="connection-list"></div>`;
  const results = dialog.querySelector("#search-results");
  const show = (q) => {
    const list = entries.filter((x) =>
      `${x.worldName} ${JSON.stringify(x.item)}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    );
    results.innerHTML =
      `<p class="muted small">${list.length} results across all worlds · showing up to 30</p>` +
      list
        .slice(0, 30)
        .map(
          (x) =>
            `<button data-action="search-result" data-world="${e(x.worldId)}" data-key="${x.key}" data-id="${e(x.item.id)}"><span>${e(x.item.name)}<small>${e(x.worldName)} · ${types[x.key]}</small></span><span>↗</span></button>`,
        )
        .join("");
  };
  dialog.querySelector("#global-search").oninput = (ev) =>
    show(ev.target.value);
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  show("");
  dialog.showModal();
}
function confirmDelete(title, description, change) {
  if (dialog.open) dialog.close();
  openDialog(
    title,
    `<p>${e(description)}</p><p class="footnote">A previous-save checkpoint is kept. Export a backup if you want a permanent copy.</p>`,
    async () =>
      commit(change, "Deleted. The previous save is recoverable in Settings."),
  );
  dialog.querySelector("[type=submit]").textContent = "Delete";
  dialog.querySelector("[type=submit]").className = "button danger";
}
function download() {
  const snapshot = cleanSnapshot(state);
  delete snapshot.localAI;
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `dreamforge-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup exported");
}
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const { action, id, key } = el.dataset;
  try {
    switch (action) {
      case "theme":
        if (themes.some((t) => t.id === id)) {
          await commit((s) => {
            s.appearance = { ...s.appearance, theme: id };
          }, "Palette saved");
        }
        break;
      case "choose-model": {
        const form = document.querySelector("#local-ai-form");
        form.elements.model.value = el.dataset.model;
        toast("Model selected. Save AI settings to keep it.");
        break;
      }
      case "local-draft":
        startLocalDraft();
        break;
      case "new-world":
        editWorld(true);
        break;
      case "edit-world":
        editWorld();
        break;
      case "example":
        await commit((s) => {
          const w = exampleWorld();
          s.universes.push(w);
          s.currentUniverseId = w.id;
        }, "Welcome to the Orrery of Tides");
        break;
      case "open-world":
        await commit((s) => {
          s.currentUniverseId = id;
        }, "World opened");
        navigate("dashboard");
        break;
      case "go-ai":
        navigate("ai");
        break;
      case "collection":
        entityTab = key;
        entityPage = 0;
        entityQuery = "";
        navigate("entities");
        break;
      case "new-entity":
        editEntity();
        break;
      case "inspect":
        inspectEntity(key, id);
        break;
      case "edit-entity":
        editEntity(key, id);
        break;
      case "delete-entity":
        confirmDelete(
          "Delete entry?",
          `This removes the entry and its ${world().relationships.filter((r) => r.sourceId === id || r.targetId === id).length} connected relationships.`,
          (s) => {
            const w = currentDraft(s);
            w[key] = w[key].filter((i) => i.id !== id);
            w.relationships = w.relationships.filter(
              (r) => r.sourceId !== id && r.targetId !== id,
            );
            for (const l of w.locations)
              l.associatedFactions = (l.associatedFactions || []).filter(
                (f) => f !== id,
              );
          },
        );
        break;
      case "new-relationship":
        editRelationship();
        break;
      case "edit-relationship":
        editRelationship(id);
        break;
      case "delete-relationship":
        confirmDelete(
          "Delete relationship?",
          "The connected entries will remain.",
          (s) => {
            const w = currentDraft(s);
            w.relationships = w.relationships.filter((r) => r.id !== id);
          },
        );
        break;
      case "graph-node":
        graphSelection = id;
        renderGraph(document.querySelector("#main-content"));
        break;
      case "focus-graph":
        dialog.close();
        graphSelection = id;
        navigate("graph");
        break;
      case "zoom-in":
      case "zoom-out":
      case "zoom-reset":
        graphZoom =
          action === "zoom-reset"
            ? 1
            : Math.max(
                0.6,
                Math.min(2, graphZoom + (action === "zoom-in" ? 0.2 : -0.2)),
              );
        document
          .querySelector(".graph-scene")
          .setAttribute(
            "transform",
            `translate(420 280) scale(${graphZoom}) translate(-420 -280)`,
          );
        break;
      case "find-path": {
        const w = {
            ...world(),
            relationshipIndex: buildRelationshipIndex(world().relationships),
          },
          a = document.querySelector("#path-source").value,
          b = document.querySelector("#path-target").value,
          path = findShortestRelationshipPath(w, a, b);
        document.querySelector("#path-result").textContent = path
          ? [a, ...path.map((edge) => edge.nextId)]
              .map(
                (id) =>
                  allEntities(w).find((x) => x.item.id === id)?.item.name || id,
              )
              .join(" → ")
          : "No path connects these entries yet.";
        break;
      }
      case "page":
        if (el.dataset.kind === "entities")
          entityPage = Number(el.dataset.page);
        else if (el.dataset.kind === "relationships")
          relationshipPage = Number(el.dataset.page);
        else previewPage = Number(el.dataset.page);
        render();
        break;
      case "new-event":
        newEvent();
        break;
      case "prompt-example":
        promptDraft = el.dataset.prompt;
        renderArchitect(document.querySelector("#main-content"));
        break;
      case "blueprint":
        blueprint();
        break;
      case "cancel-generation":
        worker?.terminate();
        worker = null;
        aiDraftController?.abort();
        aiDraftController = null;
        render();
        toast("Generation cancelled. Your world is unchanged.");
        break;
      case "discard-generation":
        generation = null;
        render();
        break;
      case "preview-tab":
        previewTab = key;
        previewPage = 0;
        render();
        break;
      case "edit-draft": {
        const item = previewCollection().find((i) => i.id === id);
        openDialog(
          "Edit draft entry",
          formField("name", "Name", item.name) +
            formField(
              "description",
              "Description",
              item.description || "",
              "textarea",
            ),
          (fd) => {
            item.name = String(fd.get("name"));
            item.description = String(fd.get("description"));
            render();
          },
        );
        break;
      }
      case "save-generation":
        await saveGeneration();
        break;
      case "chat-prompt":
        await sendChat(el.dataset.prompt);
        break;
      case "export":
        download();
        break;
      case "recover": {
        const prev = await repo.previous();
        if (!prev) {
          toast("No previous save exists yet.");
          break;
        }
        openDialog(
          "Recover previous save?",
          `<p>The previous snapshot contains ${prev.universes.length} worlds. Recovering swaps it with the current save; the current save then becomes the previous checkpoint.</p>`,
          () =>
            commit((s) => {
              for (const k of Object.keys(s)) delete s[k];
              Object.assign(s, prev);
            }, "Previous save recovered"),
        );
        dialog.querySelector("[type=submit]").textContent = "Recover";
        break;
      }
      case "delete-world":
        confirmDelete(
          "Delete this world?",
          `Remove “${world().name}” and its entries from the workspace.`,
          (s) => {
            s.universes = s.universes.filter(
              (w) => w.id !== s.currentUniverseId,
            );
            s.currentUniverseId = s.universes[0]?.id || null;
          },
        );
        break;
      case "search":
        searchDialog();
        break;
      case "search-result":
        dialog.close();
        if (state.currentUniverseId !== el.dataset.world)
          await commit((s) => {
            s.currentUniverseId = el.dataset.world;
          }, "");
        inspectEntity(key, id);
        break;
      case "discover-ai":
      case "check-ai": {
        const form = document.querySelector("#local-ai-form"),
          status = document.querySelector("#ai-status");
        status.textContent = "Checking local model libraries…";
        document.querySelector("#installed-models").innerHTML = "";
        const addresses =
          action === "discover-ai"
            ? ["http://127.0.0.1:11435", "http://127.0.0.1:11434"]
            : [validateEndpoint(form.elements.endpoint.value)];
        let connected = false;
        for (const endpoint of addresses) {
          try {
            const response = await fetch(`${endpoint}/api/tags`, {
              redirect: "error",
              signal: AbortSignal.timeout(3000),
            });
            if (!response.ok) throw Error(`HTTP ${response.status}`);
            const data = await response.json();
            const models = (data.models || []).filter(
              (m) =>
                typeof m.name === "string" &&
                !/cloud/i.test(m.name) &&
                !m.remote_host &&
                !m.remote_model,
            );
            form.elements.endpoint.value = endpoint;
            status.textContent = `Connected at ${endpoint}. ${models.length} local model(s). Choose one, enable AI, and save settings.`;
            document.querySelector("#installed-models").innerHTML = models
              .map((m) =>
                btn(
                  e(m.name) +
                    (m.size ? ` · ${(m.size / 1e9).toFixed(1)} GB` : ""),
                  "choose-model",
                  "model-choice",
                  `type="button" data-model="${e(m.name)}"`,
                ),
              )
              .join("");
            if (!models.length)
              status.textContent +=
                " Install a compatible local model in Ollama first; Dreamforge does not download models.";
            connected = true;
            break;
          } catch {
            /* Try the next loopback address; never a hosted fallback. */
          }
        }
        if (!connected)
          status.textContent =
            "No connection. Run Start-Local-AI.cmd in your DreamForge folder, then try again. For a separately managed Ollama server, allow this studio’s origin in OLLAMA_ORIGINS.";
        break;
      }
    }
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("change", async (ev) => {
  const el = ev.target;
  if (el.dataset.goal) {
    try {
      await commit((s) => {
        const g = currentDraft(s).goals.find((g) => g.id === el.dataset.goal);
        g.done = el.checked;
      }, "Goal updated");
    } catch (err) {
      toast(err.message);
      render();
    }
  }
  if (el.dataset.include) {
    const item = previewCollection().find((i) => i.id === el.dataset.include);
    item._include = el.checked;
    el.closest(".draft-item").classList.toggle("excluded", !el.checked);
  }
});
document.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
    ev.preventDefault();
    if (!dialog.open) searchDialog();
  }
  if (
    (ev.key === "Enter" || ev.key === " ") &&
    ev.target.matches(".graph-node")
  ) {
    ev.preventDefault();
    ev.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});
window.addEventListener("hashchange", render);
window.addEventListener("beforeunload", (ev) => {
  if (worker || aiDraftController || generation || busy) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});
try {
  state = await repo.open();
  if (state.localAI) {
    try {
      state.localAI.endpoint = validateEndpoint(state.localAI.endpoint);
    } catch {
      state.localAI.enabled = false;
    }
  }
  render();
} catch (err) {
  root.innerHTML = `<main class="boot-error"><span class="brand-mark">✧</span><h1>Your saved worlds need attention.</h1><p>${e(err.message)}</p><p>No legacy data was overwritten. Keep this browser profile intact and recover a complete JSON export from your previous build.</p><button class="button secondary" id="retry-boot">Try again</button></main>`;
  document.querySelector("#retry-boot").onclick = () => location.reload();
}
