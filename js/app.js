import * as RelationshipDomain from '../src/relationships/domain.ts';
import { createGenerationContext } from '../src/generation/context.ts';
import { createLegacyStorageFacade } from '../src/storage/browserStorageRepository.ts';
import { systemClock } from '../src/shared/clock.ts';
import { RuntimeIdFactory } from '../src/shared/id.ts';
import { systemRandom } from '../src/shared/random.ts';
import { CURRENT_SCHEMA_VERSION } from '../src/shared/schemaVersion.ts';

// DreamForge MVP
// This script implements a lightweight worldbuilding application that
// allows users to create and manage fictional universes, entities,
// relationships, search them, run continuity audits, chat with the
// universe, and generate draft lore. All data is stored locally in
// the browser's LocalStorage for persistence across sessions.

/*
 * Data Structures
 *
 * - AppState: holds universes and current universe ID
 * - Universe: { id, name, created, updated, characters, locations, factions, loreNotes, relationships }
 * - Entity: { id, name, description, tags, notes, created, updated, ...specific fields }
 * - Relationship: { id, sourceId, sourceType, targetId, targetType, type, description, importance, tags }
 */

// Storage key for localStorage
const STORAGE_KEY = 'dreamforge_data';
const STORAGE_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
const STORAGE_ENTITY_CHUNK_PREFIX = 'dreamforge_entity_chunk_v1';
const STORAGE_ENTITY_CHUNK_SIZE = 250;
const LARGE_ENTITY_STORAGE_THRESHOLD = 350;
const STORAGE_ENTITY_COLLECTIONS = ['characters', 'locations', 'factions', 'loreNotes', 'relationships'];
const ENTITY_TABLE_PAGE_SIZE = 80;
const RELATIONSHIP_CARD_PAGE_SIZE = 120;
const GRAPH_NODE_RENDER_LIMIT = 160;
const GRAPH_EDGE_RENDER_LIMIT = 320;
const GRAPH_DETAIL_CONNECTION_LIMIT = 120;

function defaultAppState() {
  return {
    storageVersion: STORAGE_SCHEMA_VERSION,
    universes: [],
    currentUniverseId: null
  };
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (err) {
    return false;
  }
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureUniverseShape(universe) {
  const now = new Date().toISOString();
  const shaped = universe || {};
  shaped.id = shaped.id || generateId();
  shaped.name = shaped.name || 'Untitled Universe';
  shaped.created = shaped.created || now;
  shaped.updated = shaped.updated || shaped.created;
  STORAGE_ENTITY_COLLECTIONS.forEach(key => {
    shaped[key] = ensureArray(shaped[key]);
  });
  return shaped;
}

function getChunkStorageKey(universeId, collectionKey, chunkIndex) {
  return `${STORAGE_ENTITY_CHUNK_PREFIX}:${universeId}:${collectionKey}:${chunkIndex}`;
}

function removeStoredChunksByPrefix(prefix) {
  if (!hasLocalStorage()) return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) localStorage.removeItem(key);
  }
}

function clearStoredEntityChunks(universeId, collectionKey, chunkCount = 0) {
  if (!hasLocalStorage() || !universeId) return;
  const prefix = `${STORAGE_ENTITY_CHUNK_PREFIX}:${universeId}:${collectionKey}:`;
  const count = Number(chunkCount) || 0;
  for (let i = 0; i < count; i++) {
    localStorage.removeItem(getChunkStorageKey(universeId, collectionKey, i));
  }
  removeStoredChunksByPrefix(prefix);
}

function clearStoredUniverseChunks(universeId, storageIndex = null) {
  STORAGE_ENTITY_COLLECTIONS.forEach(collectionKey => {
    const meta = storageIndex?.collections?.[collectionKey] || null;
    clearStoredEntityChunks(universeId, collectionKey, meta?.chunkCount || 0);
  });
}

function loadChunkedCollection(universe, collectionKey) {
  const meta = universe.storageIndex?.collections?.[collectionKey];
  if (!meta || meta.mode !== 'chunked-local') return ensureArray(universe[collectionKey]);
  const items = [];
  for (let i = 0; i < meta.chunkCount; i++) {
    const raw = hasLocalStorage() ? localStorage.getItem(getChunkStorageKey(universe.id, collectionKey, i)) : null;
    if (!raw) continue;
    try {
      const chunk = JSON.parse(raw);
      if (Array.isArray(chunk)) items.push(...chunk);
    } catch (err) {
      console.error(`Failed to parse ${collectionKey} chunk ${i}`, err);
    }
  }
  return items.length || !ensureArray(universe[collectionKey]).length ? items : ensureArray(universe[collectionKey]);
}

function hydrateStoredUniverse(universe) {
  const shaped = ensureUniverseShape(universe);
  STORAGE_ENTITY_COLLECTIONS.forEach(collectionKey => {
    shaped[collectionKey] = loadChunkedCollection(shaped, collectionKey);
  });
  return shaped;
}

function normalizeStoredState(state) {
  const normalized = state && Array.isArray(state.universes) ? state : defaultAppState();
  normalized.storageVersion = STORAGE_SCHEMA_VERSION;
  normalized.universes = normalized.universes.map(hydrateStoredUniverse);
  if (normalized.currentUniverseId && !normalized.universes.some(universe => universe.id === normalized.currentUniverseId)) {
    normalized.currentUniverseId = normalized.universes[0]?.id || null;
  }
  return normalized;
}

function cloneUniverseForStorage(universe) {
  const shaped = ensureUniverseShape(universe);
  const clone = { ...shaped };
  const previousIndex = shaped.storageIndex || {};
  const collections = {};
  STORAGE_ENTITY_COLLECTIONS.forEach(collectionKey => {
    const items = ensureArray(shaped[collectionKey]);
    const previousMeta = previousIndex.collections?.[collectionKey] || null;
    if (items.length > LARGE_ENTITY_STORAGE_THRESHOLD && hasLocalStorage()) {
      clearStoredEntityChunks(shaped.id, collectionKey, previousMeta?.chunkCount || 0);
      const chunkCount = Math.ceil(items.length / STORAGE_ENTITY_CHUNK_SIZE);
      for (let i = 0; i < chunkCount; i++) {
        const start = i * STORAGE_ENTITY_CHUNK_SIZE;
        const chunk = items.slice(start, start + STORAGE_ENTITY_CHUNK_SIZE);
        localStorage.setItem(getChunkStorageKey(shaped.id, collectionKey, i), JSON.stringify(chunk));
      }
      clone[collectionKey] = [];
      collections[collectionKey] = {
        mode: 'chunked-local',
        total: items.length,
        chunkSize: STORAGE_ENTITY_CHUNK_SIZE,
        chunkCount,
        updated: new Date().toISOString()
      };
    } else {
      clearStoredEntityChunks(shaped.id, collectionKey, previousMeta?.chunkCount || 0);
      clone[collectionKey] = items;
    }
  });
  clone.storageIndex = {
    version: STORAGE_SCHEMA_VERSION,
    engine: 'local chunk store',
    collections,
    updated: new Date().toISOString()
  };
  clone.storageSummary = STORAGE_ENTITY_COLLECTIONS.reduce((acc, collectionKey) => {
    acc[collectionKey] = collections[collectionKey]
      ? { total: collections[collectionKey].total, mode: collections[collectionKey].mode }
      : { total: ensureArray(clone[collectionKey]).length, mode: 'inline' };
    return acc;
  }, {});
  return clone;
}

const appClock = systemClock;
const appIds = new RuntimeIdFactory(appClock, systemRandom);
const DreamForgeStorage = createLegacyStorageFacade(hasLocalStorage() ? localStorage : null, {
  clock: appClock,
  ids: appIds
});

// Relationship types definitions
const RELATIONSHIP_TYPES = RelationshipDomain.RELATIONSHIP_TYPES;
const RELATIONSHIP_VISIBILITY_OPTIONS = RelationshipDomain.RELATIONSHIP_VISIBILITY_OPTIONS;
const RELATIONSHIP_STABILITY_OPTIONS = RelationshipDomain.RELATIONSHIP_STABILITY_OPTIONS;
const RELATIONSHIP_TONE_OPTIONS = RelationshipDomain.RELATIONSHIP_TONE_OPTIONS;
const RELATIONSHIP_STORY_LEVELS = RelationshipDomain.RELATIONSHIP_STORY_LEVELS;
const RELATIONSHIP_CATEGORY_DEFS = RelationshipDomain.RELATIONSHIP_CATEGORY_DEFS;

// Initialize state from localStorage or default
let appState = loadData();

// DOM elements
const mainContent = document.getElementById('main-content');
const navLinks = document.querySelectorAll('#nav a');
const modalContainer = document.getElementById('modal-container');

// Initialize application on page load
window.addEventListener('DOMContentLoaded', () => {
  // Setup navigation link events
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const hash = link.getAttribute('href');
      window.location.hash = hash;
    });
  });
  // Listen for hash changes
  window.addEventListener('hashchange', renderPage);
  // Render initial page
  if (!window.location.hash) {
    window.location.hash = '#dashboard';
  }
  renderPage();
});

/**
 * Load application state from localStorage.
 * @returns {Object}
 */
function loadData() {
  const state = DreamForgeStorage.getState();
  rebuildAllUniverseIndexes(state);
  return state;
}

/**
 * Save current application state to localStorage.
 */
function saveData() {
  rebuildAllUniverseIndexes(appState);
  DreamForgeStorage.saveState(appState);
}

/**
 * Generate a unique ID based on current timestamp and random segment.
 */
function generateId() {
  return appIds.next();
}

/**
 * Find a universe by ID.
 */
function getUniverseById(id) {
  return appState.universes.find(u => u.id === id);
}

/**
 * Render page based on current hash.
 */
function renderPage() {
  // Highlight active navigation link
  navLinks.forEach(link => link.classList.remove('active'));
  const hash = window.location.hash || '#dashboard';
  const activeLink = document.querySelector(`#nav a[href='${hash}']`);
  if (activeLink) activeLink.classList.add('active');

  switch (hash) {
    case '#dashboard':
      renderDashboard();
      break;
    case '#entities':
      renderEntities();
      break;
    case '#relationships':
      renderRelationships();
      break;
    case '#graph':
      renderGraph();
      break;
    case '#search':
      renderSearch();
      break;
    case '#audit':
      renderAudit();
      break;
    case '#chat':
      renderChat();
      break;
    case '#ai':
      renderAIArchitect();
      break;
    case '#settings':
      renderSettings();
      break;
    default:
      renderDashboard();
  }
}

/**
 * Render the Universe dashboard page.
 */
function renderDashboard() {
  clearMain();
  const container = document.createElement('div');
  container.className = 'grid';

  // Title and create new universe button
  const header = document.createElement('div');
  header.className = 'card';
  const h2 = document.createElement('h2');
  h2.textContent = 'Universes';
  header.appendChild(h2);
  const newBtn = document.createElement('button');
  newBtn.className = 'btn';
  newBtn.textContent = 'Create Universe';
  newBtn.addEventListener('click', () => {
    openUniverseForm();
  });
  header.appendChild(newBtn);
  mainContent.appendChild(header);

  // Universe cards
  appState.universes.forEach(univ => {
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = univ.name;
    card.appendChild(title);

    const counts = document.createElement('p');
    const { characters, locations, factions, loreNotes, relationships } = univ;
    counts.innerHTML = `Characters: <strong>${characters.length}</strong><br>
      Locations: <strong>${locations.length}</strong><br>
      Factions: <strong>${factions.length}</strong><br>
      Lore Notes: <strong>${loreNotes.length}</strong><br>
      Relationships: <strong>${relationships.length}</strong>`;
    card.appendChild(counts);

    // Actions: Open, Rename, Delete
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    const openBtn = document.createElement('button');
    openBtn.className = 'btn';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => {
      appState.currentUniverseId = univ.id;
      saveData();
      window.location.hash = '#entities';
    });
    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn secondary';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      openUniverseForm(univ);
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn secondary';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Delete universe '${univ.name}'? This cannot be undone.`)) {
        DreamForgeStorage.deleteUniverse(univ);
        appState.universes = appState.universes.filter(u => u.id !== univ.id);
        if (appState.currentUniverseId === univ.id) {
          appState.currentUniverseId = null;
        }
        saveData();
        renderDashboard();
      }
    });
    actions.append(openBtn, renameBtn, deleteBtn);
    card.appendChild(actions);
    container.appendChild(card);
  });

  mainContent.appendChild(container);
}

/**
 * Open a modal form to create or edit a universe.
 * @param {Object} [univ] Existing universe to edit
 */
function openUniverseForm(univ = null) {
  const isEdit = !!univ;
  const modal = createModal(isEdit ? 'Edit Universe' : 'Create Universe');
  const form = document.createElement('form');
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.value = isEdit ? univ.name : '';
  form.appendChild(nameLabel);
  form.appendChild(nameInput);
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn';
  submitBtn.textContent = isEdit ? 'Save' : 'Create';
  form.appendChild(submitBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    if (isEdit) {
      univ.name = name;
      univ.updated = new Date().toISOString();
    } else {
      const id = generateId();
      const now = new Date().toISOString();
      const newUniv = {
        id,
        name,
        created: now,
        updated: now,
        characters: [],
        locations: [],
        factions: [],
        loreNotes: [],
        relationships: []
      };
      appState.universes.push(newUniv);
    }
    saveData();
    closeModal();
    renderDashboard();
  });
  modal.body.appendChild(form);
  showModal(modal);
}

/**
 * Render Entities page (characters, locations, factions, lore notes).
 */
function renderPaginationControls(container, { total, pageSize, currentPage, onPageChange, label = 'items' }) {
  container.innerHTML = '';
  if (total <= pageSize) return;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(totalPages - 1, Math.max(0, currentPage));
  const start = safePage * pageSize + 1;
  const end = Math.min(total, start + pageSize - 1);
  container.className = 'pagination-controls';
  const prev = document.createElement('button');
  prev.className = 'btn secondary';
  prev.type = 'button';
  prev.textContent = 'Previous';
  prev.disabled = safePage === 0;
  const status = document.createElement('span');
  status.textContent = `${start}-${end} of ${total} ${label}`;
  const next = document.createElement('button');
  next.className = 'btn secondary';
  next.type = 'button';
  next.textContent = 'Next';
  next.disabled = safePage >= totalPages - 1;
  prev.addEventListener('click', () => onPageChange(safePage - 1));
  next.addEventListener('click', () => onPageChange(safePage + 1));
  container.append(prev, status, next);
}

function getCollectionKeyForTab(tab) {
  switch (tab) {
    case 'Characters':
      return 'characters';
    case 'Locations':
      return 'locations';
    case 'Factions':
      return 'factions';
    case 'Lore Notes':
      return 'loreNotes';
    default:
      return '';
  }
}

function renderEntities() {
  clearMain();
  const universe = getUniverseById(appState.currentUniverseId);
  if (!universe) {
    const warn = document.createElement('p');
    warn.textContent = 'Please select a universe first.';
    mainContent.appendChild(warn);
    return;
  }
  // Tabs for entity types
  const tabs = ['Characters', 'Locations', 'Factions', 'Lore Notes'];
  let currentTab = 'Characters';
  const entityPages = tabs.reduce((acc, tab) => {
    acc[tab] = 0;
    return acc;
  }, {});
  const tabNav = document.createElement('div');
  tabNav.style.display = 'flex';
  tabNav.style.gap = '0.5rem';
  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = tab;
    if (tab === currentTab) {
      btn.classList.remove('secondary');
    }
    btn.addEventListener('click', () => {
      currentTab = tab;
      renderEntityTable();
      // update button appearance
      tabNav.querySelectorAll('button').forEach(b => {
        b.className = 'btn secondary';
      });
      btn.className = 'btn';
    });
    tabNav.appendChild(btn);
  });
  mainContent.appendChild(tabNav);
  const paginationTop = document.createElement('div');
  mainContent.appendChild(paginationTop);
  const tableContainer = document.createElement('div');
  tableContainer.className = 'table-scroll';
  mainContent.appendChild(tableContainer);
  const paginationBottom = document.createElement('div');
  mainContent.appendChild(paginationBottom);
  const createBtn = document.createElement('button');
  createBtn.className = 'btn';
  createBtn.style.marginTop = '1rem';
  createBtn.textContent = 'Create ' + currentTab.slice(0, -1);
  createBtn.addEventListener('click', () => {
    openEntityForm(currentTab.slice(0, -1), null, universe);
  });
  mainContent.appendChild(createBtn);

  function renderEntityTable() {
    tableContainer.innerHTML = '';
    createBtn.textContent = 'Create ' + currentTab.slice(0, -1);
    const table = document.createElement('table');
    table.className = 'table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['Name', 'Description', 'Tags', 'Actions'];
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const items = getEntities(universe, currentTab);
    const collectionKey = getCollectionKeyForTab(currentTab);
    const totalPages = Math.max(1, Math.ceil(items.length / ENTITY_TABLE_PAGE_SIZE));
    entityPages[currentTab] = Math.min(entityPages[currentTab], totalPages - 1);
    const currentPage = entityPages[currentTab];
    const pageItems = DreamForgeStorage.loadEntitiesPage(universe, collectionKey, currentPage, ENTITY_TABLE_PAGE_SIZE);
    renderPaginationControls(paginationTop, {
      total: items.length,
      pageSize: ENTITY_TABLE_PAGE_SIZE,
      currentPage,
      label: currentTab.toLowerCase(),
      onPageChange: page => {
        entityPages[currentTab] = page;
        renderEntityTable();
      }
    });
    renderPaginationControls(paginationBottom, {
      total: items.length,
      pageSize: ENTITY_TABLE_PAGE_SIZE,
      currentPage,
      label: currentTab.toLowerCase(),
      onPageChange: page => {
        entityPages[currentTab] = page;
        renderEntityTable();
      }
    });
    pageItems.forEach(item => {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.textContent = item.name;
      const descTd = document.createElement('td');
      descTd.textContent = item.description || '';
      const tagsTd = document.createElement('td');
      tagsTd.textContent = item.tags || '';
      const actionsTd = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.className = 'btn secondary';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        openEntityForm(currentTab.slice(0, -1), item, universe);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'btn secondary';
      delBtn.style.marginLeft = '0.5rem';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        if (confirm(`Delete ${item.name}?`)) {
          deleteEntity(universe, currentTab, item.id);
          saveData();
          renderEntityTable();
        }
      });
      actionsTd.append(editBtn, delBtn);
      tr.append(nameTd, descTd, tagsTd, actionsTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableContainer.appendChild(table);
  }
  // render initial table
  renderEntityTable();
}

/**
 * Get the array of entities from a universe for a given tab.
 */
function getEntities(universe, tab) {
  switch (tab) {
    case 'Characters':
      return universe.characters;
    case 'Locations':
      return universe.locations;
    case 'Factions':
      return universe.factions;
    case 'Lore Notes':
      return universe.loreNotes;
    default:
      return [];
  }
}

/**
 * Delete an entity by ID from universe based on tab.
 */
function deleteEntity(universe, tab, id) {
  switch (tab) {
    case 'Characters':
      universe.characters = universe.characters.filter(c => c.id !== id);
      // Also remove relationships referencing this entity
      universe.relationships = universe.relationships.filter(r => !(r.sourceId === id || r.targetId === id));
      break;
    case 'Locations':
      universe.locations = universe.locations.filter(l => l.id !== id);
      universe.relationships = universe.relationships.filter(r => !(r.sourceId === id || r.targetId === id));
      break;
    case 'Factions':
      universe.factions = universe.factions.filter(f => f.id !== id);
      universe.relationships = universe.relationships.filter(r => !(r.sourceId === id || r.targetId === id));
      break;
    case 'Lore Notes':
      universe.loreNotes = universe.loreNotes.filter(n => n.id !== id);
      break;
  }
}

/**
 * Open a modal form to create or edit an entity.
 * @param {String} entityType - Type of entity (Character, Location, Faction, Lore Note)
 * @param {Object|null} entity - Existing entity to edit
 * @param {Object} universe - Universe to which the entity belongs
 */
function openEntityForm(entityType, entity = null, universe) {
  const isEdit = !!entity;
  const modal = createModal(`${isEdit ? 'Edit' : 'Create'} ${entityType}`);
  const form = document.createElement('form');

  // Common fields
  const nameInput = createInput(form, 'Name', 'text', entity ? entity.name : '');
  const descInput = createTextarea(form, 'Description', entity ? entity.description : '');
  const tagsInput = createInput(form, 'Tags (comma-separated)', 'text', entity ? entity.tags : '');
  const notesInput = createTextarea(form, 'Notes', entity ? entity.notes : '');

  // Specific fields
  let specificFields = {};
  if (entityType === 'Character') {
    specificFields.role = createInput(form, 'Role', 'text', entity ? entity.role : '');
    specificFields.species = createInput(form, 'Species', 'text', entity ? entity.species : '');
    specificFields.personality = createTextarea(form, 'Personality', entity ? entity.personality : '');
    specificFields.goals = createTextarea(form, 'Goals', entity ? entity.goals : '');
    specificFields.secrets = createTextarea(form, 'Secrets', entity ? entity.secrets : '');
  } else if (entityType === 'Location') {
    specificFields.region = createInput(form, 'Region', 'text', entity ? entity.region : '');
    specificFields.importance = createInput(form, 'Importance', 'text', entity ? entity.importance : '');
    // Associated factions (multiselect)
    const associatedLabel = document.createElement('label');
    associatedLabel.textContent = 'Associated Factions';
    const associatedSelect = document.createElement('select');
    associatedSelect.multiple = true;
    // Populate with factions from universe
    universe.factions.forEach(fac => {
      const option = document.createElement('option');
      option.value = fac.id;
      option.textContent = fac.name;
      if (entity && entity.associatedFactions && entity.associatedFactions.includes(fac.id)) {
        option.selected = true;
      }
      associatedSelect.appendChild(option);
    });
    form.appendChild(associatedLabel);
    form.appendChild(associatedSelect);
    specificFields.associatedFactionsSelect = associatedSelect;
  } else if (entityType === 'Faction') {
    specificFields.leader = createInput(form, 'Leader', 'text', entity ? entity.leader : '');
    specificFields.ideology = createTextarea(form, 'Ideology', entity ? entity.ideology : '');
    specificFields.goals = createTextarea(form, 'Goals', entity ? entity.goals : '');
    // Allies and Enemies list; for simplicity, free-text fields
    specificFields.allies = createTextarea(form, 'Allies (comma-separated names)', entity ? entity.allies : '');
    specificFields.enemies = createTextarea(form, 'Enemies (comma-separated names)', entity ? entity.enemies : '');
  } else if (entityType === 'Lore Note') {
    specificFields.category = createInput(form, 'Category', 'text', entity ? entity.category : '');
    specificFields.summary = createInput(form, 'Summary', 'text', entity ? entity.summary : '');
    specificFields.content = createTextarea(form, 'Full Content', entity ? entity.content : '');
  }
  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn';
  submitBtn.type = 'submit';
  submitBtn.textContent = isEdit ? 'Save' : 'Create';
  form.appendChild(submitBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const newEntity = entity || {};
    if (!entity) newEntity.id = generateId();
    newEntity.name = nameInput.value.trim();
    newEntity.description = descInput.value.trim();
    newEntity.tags = tagsInput.value.trim();
    newEntity.notes = notesInput.value.trim();
    newEntity.created = entity ? entity.created : now;
    newEntity.updated = now;
    // Populate specific fields
    if (entityType === 'Character') {
      newEntity.role = specificFields.role.value.trim();
      newEntity.species = specificFields.species.value.trim();
      newEntity.personality = specificFields.personality.value.trim();
      newEntity.goals = specificFields.goals.value.trim();
      newEntity.secrets = specificFields.secrets.value.trim();
    } else if (entityType === 'Location') {
      newEntity.region = specificFields.region.value.trim();
      newEntity.importance = specificFields.importance.value.trim();
      const selected = Array.from(specificFields.associatedFactionsSelect.selectedOptions).map(opt => opt.value);
      newEntity.associatedFactions = selected;
    } else if (entityType === 'Faction') {
      newEntity.leader = specificFields.leader.value.trim();
      newEntity.ideology = specificFields.ideology.value.trim();
      newEntity.goals = specificFields.goals.value.trim();
      newEntity.allies = specificFields.allies.value.trim();
      newEntity.enemies = specificFields.enemies.value.trim();
    } else if (entityType === 'Lore Note') {
      newEntity.category = specificFields.category.value.trim();
      newEntity.summary = specificFields.summary.value.trim();
      newEntity.content = specificFields.content.value.trim();
    }
    // Validate name
    if (!newEntity.name) {
      alert('Name is required');
      return;
    }
    // Save or update entity in universe
    switch (entityType) {
      case 'Character':
        upsert(universe.characters, newEntity);
        break;
      case 'Location':
        upsert(universe.locations, newEntity);
        break;
      case 'Faction':
        upsert(universe.factions, newEntity);
        break;
      case 'Lore Note':
        upsert(universe.loreNotes, newEntity);
        break;
    }
    universe.updated = now;
    saveData();
    closeModal();
    renderEntities();
  });
  modal.body.appendChild(form);
  showModal(modal);
}

/**
 * Insert or update an item in an array by id.
 */
function upsert(arr, item) {
  const idx = arr.findIndex(el => el.id === item.id);
  if (idx >= 0) arr[idx] = item;
  else arr.push(item);
}

/**
 * Create an input element with label and append to parent form.
 */
function createInput(form, labelText, type = 'text', value = '') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  form.appendChild(label);
  form.appendChild(input);
  return input;
}

/**
 * Create a textarea element with label and append to parent form.
 */
function createTextarea(form, labelText, value = '') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  form.appendChild(label);
  form.appendChild(textarea);
  return textarea;
}

function clampRelationshipScore(value, fallback = 5) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(10, Math.max(1, parsed));
}

function inferRelationshipStrength(rel) {
  return RelationshipDomain.inferRelationshipStrength(rel);
}

function inferRelationshipInfluence(rel) {
  return RelationshipDomain.inferRelationshipInfluence(rel);
}

function inferRelationshipVisibility(rel) {
  return RelationshipDomain.inferRelationshipVisibility(rel);
}

function inferRelationshipStability(rel) {
  return RelationshipDomain.inferRelationshipStability(rel);
}

function inferRelationshipTone(rel) {
  return RelationshipDomain.inferRelationshipTone(rel);
}

function getRelationshipCategories(rel, intel = null) {
  return RelationshipDomain.getRelationshipCategories(rel, intel || undefined);
}

function calculateStoryPotential(rel, intel) {
  return RelationshipDomain.calculateStoryPotential(rel, intel);
}

function getRelationshipIntelligence(rel) {
  return RelationshipDomain.getRelationshipIntelligence(rel);
}

function pushIndexValue(index, key, value) {
  const safeKey = key || 'Unknown';
  if (!index[safeKey]) index[safeKey] = [];
  index[safeKey].push(value);
}

function buildRelationshipIndex(relationships = []) {
  return RelationshipDomain.buildRelationshipIndex(relationships, appClock);
}

function summarizeStorageCollections(universe) {
  const storageCollections = universe.storageIndex?.collections || {};
  return STORAGE_ENTITY_COLLECTIONS.reduce((acc, collectionKey) => {
    const total = ensureArray(universe[collectionKey]).length;
    const meta = storageCollections[collectionKey] || null;
    acc[collectionKey] = {
      total,
      mode: meta?.mode || (total > LARGE_ENTITY_STORAGE_THRESHOLD ? 'chunked-local-ready' : 'inline')
    };
    return acc;
  }, {});
}

function rebuildUniverseIndexes(universe) {
  if (!universe) return;
  ensureUniverseShape(universe);
  universe.relationshipIndex = buildRelationshipIndex(universe.relationships);
  universe.storageSummary = summarizeStorageCollections(universe);
}

function rebuildAllUniverseIndexes(state = appState) {
  ensureArray(state?.universes).forEach(rebuildUniverseIndexes);
}

function getRelationshipEntityPair(universe, rel) {
  const source = getEntityById(universe, rel.sourceId, rel.sourceType);
  const target = getEntityById(universe, rel.targetId, rel.targetType);
  return {
    source,
    target,
    sourceName: source ? source.name : rel.sourceId,
    targetName: target ? target.name : rel.targetId
  };
}

function enrichRelationship(universe, rel) {
  const pair = getRelationshipEntityPair(universe, rel);
  const intel = getRelationshipIntelligence(rel);
  return { rel, ...pair, intel };
}

function getRelationshipSearchText(universe, item) {
  const rel = item.rel || item;
  const enriched = item.rel ? item : enrichRelationship(universe, rel);
  return [
    enriched.sourceName,
    enriched.targetName,
    rel.sourceType,
    rel.targetType,
    rel.type,
    rel.description,
    rel.importance,
    rel.tags,
    enriched.intel.strength,
    enriched.intel.influence,
    enriched.intel.visibility,
    enriched.intel.stability,
    enriched.intel.tone,
    enriched.intel.story.label,
    ...enriched.intel.categories
  ].join(' ').toLowerCase();
}

function getRelationshipDashboard(universe) {
  const relationships = universe.relationships.map(rel => enrichRelationship(universe, rel));
  const entityStats = getAllUniverseEntities(universe).map(item => ({
    ...item,
    connections: getEntityConnections(universe, item.entity.id).length
  }));
  const connectedStats = entityStats.slice().sort((a, b) => b.connections - a.connections || a.entity.name.localeCompare(b.entity.name));
  const leastStats = entityStats.slice().sort((a, b) => a.connections - b.connections || a.entity.name.localeCompare(b.entity.name));
  const alliance = relationships
    .filter(item => item.intel.categories.includes('Allies') || ['Ally', 'Member Of', 'Leader Of'].includes(item.rel.type))
    .sort((a, b) => (b.intel.strength + b.intel.influence) - (a.intel.strength + a.intel.influence))[0];
  const rivalry = relationships
    .filter(item => item.intel.categories.includes('Enemies'))
    .sort((a, b) => (b.intel.strength + b.intel.influence) - (a.intel.strength + a.intel.influence))[0];
  const breakdown = RELATIONSHIP_CATEGORY_DEFS.reduce((acc, def) => {
    acc[def.id] = 0;
    return acc;
  }, {});
  relationships.forEach(item => {
    breakdown[item.intel.primaryCategory] = (breakdown[item.intel.primaryCategory] || 0) + 1;
  });
  return {
    total: relationships.length,
    mostConnected: connectedStats[0] || null,
    leastConnected: leastStats[0] || null,
    strongestAlliance: alliance || null,
    strongestRivalry: rivalry || null,
    secretCount: relationships.filter(item => item.intel.visibility === 'Secret').length,
    publicCount: relationships.filter(item => item.intel.visibility === 'Public').length,
    orphanedCount: entityStats.filter(item => item.connections === 0).length,
    breakdown
  };
}

function generateRelationshipInsights(universe) {
  const insights = [];
  const relationships = universe.relationships.map(rel => enrichRelationship(universe, rel));
  const isolatedCharacters = universe.characters.filter(char => getEntityConnections(universe, char.id).length === 0);
  const isolatedFactions = universe.factions.filter(faction => getEntityConnections(universe, faction.id).length === 0);
  const highInfluenceSecrets = relationships.filter(item => item.intel.visibility === 'Secret' && item.intel.influence >= 7);
  const volatileStrong = relationships.filter(item => item.intel.stability === 'Volatile' && item.intel.strength >= 7);
  const imbalance = relationships.filter(item => item.intel.influence >= 8 && item.intel.strength <= 3);

  if (relationships.length === 0) {
    insights.push({
      title: 'No Relationship Web Yet',
      explanation: 'This universe has entities, but no explicit social, political, or story connections.',
      action: 'Add one ally, one rival, and one secret to give the world immediate pressure.'
    });
  }
  if (isolatedCharacters.length) {
    insights.push({
      title: 'Isolated Character',
      explanation: `${isolatedCharacters[0].name} has no relationships, so their role may feel detached from the larger world.`,
      action: 'Connect them to a faction, mentor, enemy, or place that can pull them into conflict.'
    });
  }
  if (isolatedFactions.length) {
    insights.push({
      title: 'Unconnected Faction',
      explanation: `${isolatedFactions[0].name} does not currently affect another entity through relationships.`,
      action: 'Give the faction an ally, rival, leader, territory, or hidden sponsor.'
    });
  }
  const factionWithoutAllies = universe.factions.find(faction => !getEntityConnections(universe, faction.id).some(conn => getRelationshipIntelligence(conn.rel).categories.includes('Allies')));
  if (factionWithoutAllies) {
    insights.push({
      title: 'Faction Without Allies',
      explanation: `${factionWithoutAllies.name} has no clear allies, which can make politics feel one-note or isolated.`,
      action: 'Add a pragmatic alliance, reluctant sponsor, or temporary coalition.'
    });
  }
  if (highInfluenceSecrets.length) {
    const item = highInfluenceSecrets[0];
    insights.push({
      title: 'Hidden Power Structure',
      explanation: `${item.sourceName} and ${item.targetName} have a secret high-influence relationship.`,
      action: 'Decide who would benefit if this connection became public.'
    });
  }
  if (volatileStrong.length) {
    const item = volatileStrong[0];
    insights.push({
      title: 'Volatile Story Engine',
      explanation: `${item.sourceName} and ${item.targetName} have a strong but unstable ${item.rel.type.toLowerCase()} relationship.`,
      action: 'Create a scene, law, betrayal, or deadline that tests whether this bond breaks.'
    });
  }
  if (imbalance.length) {
    const item = imbalance[0];
    insights.push({
      title: 'Relationship Imbalance',
      explanation: `${item.sourceName} and ${item.targetName} have low emotional strength but high world impact.`,
      action: 'Clarify whether the bond is bureaucratic, coerced, transactional, or temporary.'
    });
  }
  const enemyMap = {};
  relationships.filter(item => item.intel.categories.includes('Enemies')).forEach(item => {
    [item.rel.sourceId, item.rel.targetId].forEach(entityId => {
      const otherId = entityId === item.rel.sourceId ? item.rel.targetId : item.rel.sourceId;
      if (!enemyMap[otherId]) enemyMap[otherId] = [];
      enemyMap[otherId].push(entityId);
    });
  });
  const mutualEnemy = Object.keys(enemyMap).find(enemyId => enemyMap[enemyId].length > 1);
  if (mutualEnemy) {
    const enemy = getAllUniverseEntities(universe).find(item => item.entity.id === mutualEnemy);
    insights.push({
      title: 'Mutual Enemy Opportunity',
      explanation: `${enemy ? enemy.entity.name : 'One entity'} is opposed by multiple entities who may not realize their interests align.`,
      action: 'Consider a temporary alliance, secret pact, or uneasy truce.'
    });
  }
  return insights.slice(0, 6);
}

function findShortestRelationshipPath(universe, sourceId, targetId) {
  return RelationshipDomain.findShortestRelationshipPath(universe.relationships, sourceId, targetId);
}

function getEntityNameById(universe, entityId) {
  const match = getAllUniverseEntities(universe).find(item => item.entity.id === entityId);
  return match ? match.entity.name : entityId;
}

function createRelationshipMetric(label, value, detail = '') {
  const metric = document.createElement('div');
  metric.className = 'relationship-metric';
  const valueEl = document.createElement('strong');
  valueEl.textContent = value;
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  metric.append(valueEl, labelEl);
  if (detail) {
    const detailEl = document.createElement('small');
    detailEl.textContent = detail;
    metric.appendChild(detailEl);
  }
  return metric;
}

function createRelationshipChip(text, className = '') {
  const chip = document.createElement('span');
  chip.className = `relationship-chip ${className}`.trim();
  chip.textContent = text;
  return chip;
}

function createRelationshipMeter(label, value) {
  const meter = document.createElement('div');
  meter.className = 'relationship-meter';
  const top = document.createElement('div');
  top.className = 'relationship-meter-label';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = `${value}/10`;
  top.append(labelEl, valueEl);
  const track = document.createElement('div');
  track.className = 'relationship-meter-track';
  const fill = document.createElement('span');
  fill.style.width = `${value * 10}%`;
  track.appendChild(fill);
  meter.append(top, track);
  return meter;
}

/**
 * Render Relationships page
 */
function renderRelationships() {
  clearMain();
  const universe = getUniverseById(appState.currentUniverseId);
  if (!universe) {
    const warn = document.createElement('p');
    warn.textContent = 'Please select a universe first.';
    mainContent.appendChild(warn);
    return;
  }
  let relationshipPage = 0;

  const header = document.createElement('div');
  header.className = 'relationship-page-header card';
  const headerText = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = 'Relationship Intelligence';
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Read the social, political, emotional, and narrative structure of this universe at a glance.';
  headerText.append(title, subtitle);
  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.type = 'button';
  addBtn.textContent = 'Add Relationship';
  addBtn.addEventListener('click', () => openRelationshipForm(null, universe));
  header.append(headerText, addBtn);
  mainContent.appendChild(header);

  const dashboard = getRelationshipDashboard(universe);
  const dashboardPanel = document.createElement('section');
  dashboardPanel.className = 'relationship-dashboard card';
  const dashboardTitle = document.createElement('h3');
  dashboardTitle.textContent = 'Relationship Dashboard';
  const metrics = document.createElement('div');
  metrics.className = 'relationship-metrics-grid';
  const mostConnected = dashboard.mostConnected ? `${dashboard.mostConnected.entity.name}` : 'None';
  const leastConnected = dashboard.leastConnected ? `${dashboard.leastConnected.entity.name}` : 'None';
  const alliance = dashboard.strongestAlliance ? `${dashboard.strongestAlliance.sourceName} + ${dashboard.strongestAlliance.targetName}` : 'None';
  const rivalry = dashboard.strongestRivalry ? `${dashboard.strongestRivalry.sourceName} vs ${dashboard.strongestRivalry.targetName}` : 'None';
  metrics.append(
    createRelationshipMetric('Total Relationships', dashboard.total),
    createRelationshipMetric('Most Connected', mostConnected, dashboard.mostConnected ? `${dashboard.mostConnected.connections} connections` : ''),
    createRelationshipMetric('Least Connected', leastConnected, dashboard.leastConnected ? `${dashboard.leastConnected.connections} connections` : ''),
    createRelationshipMetric('Strongest Alliance', alliance),
    createRelationshipMetric('Strongest Rivalry', rivalry),
    createRelationshipMetric('Secret Relationships', dashboard.secretCount),
    createRelationshipMetric('Public Relationships', dashboard.publicCount),
    createRelationshipMetric('Orphaned Entities', dashboard.orphanedCount)
  );
  const breakdown = document.createElement('div');
  breakdown.className = 'relationship-breakdown';
  const breakdownTitle = document.createElement('h4');
  breakdownTitle.textContent = 'Relationship Type Breakdown';
  const breakdownList = document.createElement('div');
  breakdownList.className = 'relationship-breakdown-list';
  RELATIONSHIP_CATEGORY_DEFS.forEach(def => {
    const item = document.createElement('span');
    item.textContent = `${def.label}: ${dashboard.breakdown[def.id] || 0}`;
    breakdownList.appendChild(item);
  });
  breakdown.append(breakdownTitle, breakdownList);
  dashboardPanel.append(dashboardTitle, metrics, breakdown);
  mainContent.appendChild(dashboardPanel);

  const controls = document.createElement('section');
  controls.className = 'relationship-controls card';
  const controlsTitle = document.createElement('h3');
  controlsTitle.textContent = 'Filters';
  const searchInput = document.createElement('input');
  searchInput.className = 'relationship-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search entity, type, tone, visibility, tag, or description';
  const categoryGroup = document.createElement('div');
  categoryGroup.className = 'relationship-control-group';
  const categoryTitle = document.createElement('h4');
  categoryTitle.textContent = 'Relationship Types';
  categoryGroup.appendChild(categoryTitle);
  const categoryFilters = {};
  RELATIONSHIP_CATEGORY_DEFS.forEach(def => {
    const label = document.createElement('label');
    label.className = 'relationship-chip-filter';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    categoryFilters[def.id] = checkbox;
    const text = document.createElement('span');
    text.textContent = def.label;
    label.append(checkbox, text);
    categoryGroup.appendChild(label);
  });
  const selectRow = document.createElement('div');
  selectRow.className = 'relationship-select-row';
  const visibilitySelect = document.createElement('select');
  const stabilitySelect = document.createElement('select');
  const storySelect = document.createElement('select');
  [
    [visibilitySelect, 'All Visibility', RELATIONSHIP_VISIBILITY_OPTIONS],
    [stabilitySelect, 'All Stability', RELATIONSHIP_STABILITY_OPTIONS],
    [storySelect, 'All Story Potential', RELATIONSHIP_STORY_LEVELS]
  ].forEach(([select, allLabel, values]) => {
    const all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);
    values.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    selectRow.appendChild(select);
  });
  controls.append(controlsTitle, searchInput, categoryGroup, selectRow);
  mainContent.appendChild(controls);

  const workspace = document.createElement('section');
  workspace.className = 'relationship-workspace';
  const insightsPanel = document.createElement('div');
  insightsPanel.className = 'relationship-intelligence-panel card';
  const insightsTitle = document.createElement('h3');
  insightsTitle.textContent = 'Relationship Insights';
  const insightsList = document.createElement('div');
  insightsList.className = 'relationship-insights';
  generateRelationshipInsights(universe).forEach(insight => {
    const card = document.createElement('div');
    card.className = 'relationship-insight';
    const insightTitle = document.createElement('strong');
    insightTitle.textContent = insight.title;
    const explanation = document.createElement('p');
    explanation.textContent = insight.explanation;
    const action = document.createElement('span');
    action.textContent = insight.action;
    card.append(insightTitle, explanation, action);
    insightsList.appendChild(card);
  });
  insightsPanel.append(insightsTitle, insightsList);

  const explorerPanel = document.createElement('div');
  explorerPanel.className = 'relationship-intelligence-panel card';
  const explorerTitle = document.createElement('h3');
  explorerTitle.textContent = 'Entity Relationship Explorer';
  const entitySelect = document.createElement('select');
  populateEntityOptions(entitySelect, universe);
  const central = getCentralEntities(universe, null, 1)[0];
  if (central) entitySelect.value = `${central.entity.id}|${central.type}`;
  const explorerBody = document.createElement('div');
  explorerBody.className = 'relationship-explorer-body';
  explorerPanel.append(explorerTitle, entitySelect, explorerBody);

  const pathPanel = document.createElement('div');
  pathPanel.className = 'relationship-intelligence-panel card';
  const pathTitle = document.createElement('h3');
  pathTitle.textContent = 'Connection Paths';
  const pathControls = document.createElement('div');
  pathControls.className = 'relationship-path-controls';
  const pathSource = document.createElement('select');
  const pathTarget = document.createElement('select');
  populateEntityOptions(pathSource, universe);
  populateEntityOptions(pathTarget, universe);
  const findPathBtn = document.createElement('button');
  findPathBtn.type = 'button';
  findPathBtn.className = 'btn secondary';
  findPathBtn.textContent = 'Find Path';
  pathControls.append(pathSource, pathTarget, findPathBtn);
  const pathResult = document.createElement('div');
  pathResult.className = 'relationship-path-result';
  pathPanel.append(pathTitle, pathControls, pathResult);
  workspace.append(insightsPanel, explorerPanel, pathPanel);
  mainContent.appendChild(workspace);

  const resultsHeader = document.createElement('div');
  resultsHeader.className = 'relationship-results-header';
  const resultsTitle = document.createElement('h3');
  resultsTitle.textContent = 'Relationship Cards';
  const resultsCount = document.createElement('span');
  resultsHeader.append(resultsTitle, resultsCount);
  mainContent.appendChild(resultsHeader);
  const results = document.createElement('div');
  results.className = 'relationship-results';
  mainContent.appendChild(results);
  const relationshipPager = document.createElement('div');
  mainContent.appendChild(relationshipPager);

  function renderExplorer() {
    explorerBody.innerHTML = '';
    const [entityId] = entitySelect.value.split('|');
    if (!entityId) {
      explorerBody.textContent = 'Select an entity to inspect its relationships.';
      return;
    }
    const connections = getEntityConnections(universe, entityId).map(conn => {
      const enriched = enrichRelationship(universe, conn.rel);
      return { ...conn, enriched };
    });
    if (connections.length === 0) {
      explorerBody.textContent = 'No relationships yet for this entity.';
      return;
    }
    const grouped = {};
    connections.forEach(conn => {
      const category = conn.enriched.intel.primaryCategory;
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(conn);
    });
    RELATIONSHIP_CATEGORY_DEFS.forEach(def => {
      const items = grouped[def.id] || [];
      if (!items.length) return;
      const section = document.createElement('div');
      section.className = 'relationship-explorer-section';
      const title = document.createElement('strong');
      title.textContent = `${def.label}:`;
      section.appendChild(title);
      items.forEach(conn => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'relationship-explorer-link';
        row.textContent = `${conn.rel.type}: ${conn.other ? conn.other.name : 'Unknown entity'} (${conn.enriched.intel.tone}, ${conn.enriched.intel.story.label})`;
        row.addEventListener('click', () => openRelationshipForm(conn.rel, universe));
        section.appendChild(row);
      });
      explorerBody.appendChild(section);
    });
  }

  function renderPath() {
    pathResult.innerHTML = '';
    const [sourceId] = pathSource.value.split('|');
    const [targetId] = pathTarget.value.split('|');
    if (!sourceId || !targetId) {
      pathResult.textContent = 'Choose two entities to discover the shortest relationship chain.';
      return;
    }
    if (sourceId === targetId) {
      pathResult.textContent = 'Choose two different entities.';
      return;
    }
    const path = findShortestRelationshipPath(universe, sourceId, targetId);
    if (path === null) {
      pathResult.textContent = 'No relationship path connects those entities yet.';
      return;
    }
    const line = document.createElement('div');
    line.className = 'relationship-path-line';
    let currentId = sourceId;
    const first = document.createElement('span');
    first.className = 'relationship-path-step';
    first.textContent = getEntityNameById(universe, currentId);
    line.appendChild(first);
    path.forEach(edge => {
      const connector = document.createElement('span');
      connector.className = 'relationship-path-connector';
      connector.textContent = edge.rel.type;
      line.appendChild(connector);
      currentId = edge.nextId;
      const step = document.createElement('span');
      step.className = 'relationship-path-step';
      step.textContent = getEntityNameById(universe, currentId);
      line.appendChild(step);
    });
    pathResult.appendChild(line);
  }

  function relationshipMatchesFilters(item) {
    const activeCategories = Object.keys(categoryFilters).filter(key => categoryFilters[key].checked);
    if (!item.intel.categories.some(category => activeCategories.includes(category))) return false;
    if (visibilitySelect.value && item.intel.visibility !== visibilitySelect.value) return false;
    if (stabilitySelect.value && item.intel.stability !== stabilitySelect.value) return false;
    if (storySelect.value && item.intel.story.label !== storySelect.value) return false;
    const query = searchInput.value.trim().toLowerCase();
    if (query && !getRelationshipSearchText(universe, item).includes(query)) return false;
    return true;
  }

  function createRelationshipCard(item) {
    const { rel, sourceName, targetName, intel } = item;
    const card = document.createElement('article');
    card.className = 'relationship-card';
    card.classList.toggle('relationship-card-strong', intel.strength >= 8);
    card.classList.toggle('relationship-card-weak', intel.strength <= 3);
    card.classList.toggle('relationship-card-secret', intel.visibility === 'Secret');
    card.classList.toggle('relationship-card-volatile', intel.stability === 'Volatile');
    card.style.setProperty('--relationship-strength', String(intel.strength));

    const route = document.createElement('div');
    route.className = 'relationship-card-route';
    const source = document.createElement('strong');
    source.textContent = sourceName;
    const type = document.createElement('span');
    type.className = 'relationship-type-pill';
    type.textContent = rel.type.toUpperCase();
    const target = document.createElement('strong');
    target.textContent = targetName;
    route.append(source, type, target);

    const meta = document.createElement('div');
    meta.className = 'relationship-card-meta';
    meta.append(
      createRelationshipChip(`Tone: ${intel.tone}`),
      createRelationshipChip(intel.visibility, `visibility-${intel.visibility.toLowerCase()}`),
      createRelationshipChip(intel.stability, `stability-${intel.stability.toLowerCase()}`),
      createRelationshipChip(`Story: ${intel.story.label}`, `story-${intel.story.label.toLowerCase().replace(/\s+/g, '-')}`)
    );

    const meters = document.createElement('div');
    meters.className = 'relationship-meter-grid';
    meters.append(createRelationshipMeter('Strength', intel.strength), createRelationshipMeter('Influence', intel.influence));

    const description = document.createElement('p');
    description.className = 'relationship-description';
    description.textContent = rel.description || 'No description yet. Add what this connection means, who knows, and what could change.';

    const detailLine = document.createElement('div');
    detailLine.className = 'relationship-detail-line';
    if (rel.importance) detailLine.appendChild(createRelationshipChip(`Importance: ${rel.importance}`));
    if (rel.tags) detailLine.appendChild(createRelationshipChip(`Tags: ${rel.tags}`));
    intel.categories.forEach(category => detailLine.appendChild(createRelationshipChip(category)));

    const actions = document.createElement('div');
    actions.className = 'relationship-card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn secondary';
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openRelationshipForm(rel, universe));
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn secondary';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (confirm('Delete this relationship?')) {
        universe.relationships = universe.relationships.filter(r => r.id !== rel.id);
        universe.updated = new Date().toISOString();
        saveData();
        renderRelationships();
      }
    });
    actions.append(editBtn, deleteBtn);

    card.append(route, meta, meters, description, detailLine, actions);
    return card;
  }

  function renderRelationshipCards() {
    results.innerHTML = '';
    const visible = universe.relationships.map(rel => enrichRelationship(universe, rel)).filter(relationshipMatchesFilters);
    const totalPages = Math.max(1, Math.ceil(visible.length / RELATIONSHIP_CARD_PAGE_SIZE));
    relationshipPage = Math.min(relationshipPage, totalPages - 1);
    const start = relationshipPage * RELATIONSHIP_CARD_PAGE_SIZE;
    const pageItems = visible.slice(start, start + RELATIONSHIP_CARD_PAGE_SIZE);
    resultsCount.textContent = visible.length > RELATIONSHIP_CARD_PAGE_SIZE
      ? `${pageItems.length} of ${visible.length} shown`
      : `${visible.length} shown`;
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'relationship-empty-state';
      empty.textContent = 'No relationships match these filters yet.';
      results.appendChild(empty);
      relationshipPager.innerHTML = '';
      return;
    }
    RELATIONSHIP_CATEGORY_DEFS.forEach(def => {
      const items = pageItems.filter(item => item.intel.primaryCategory === def.id);
      if (!items.length) return;
      const section = document.createElement('details');
      section.className = 'relationship-category-section';
      section.open = true;
      const summary = document.createElement('summary');
      summary.textContent = `${def.label} (${items.length})`;
      const grid = document.createElement('div');
      grid.className = 'relationship-card-grid';
      items.forEach(item => grid.appendChild(createRelationshipCard(item)));
      section.append(summary, grid);
      results.appendChild(section);
    });
    renderPaginationControls(relationshipPager, {
      total: visible.length,
      pageSize: RELATIONSHIP_CARD_PAGE_SIZE,
      currentPage: relationshipPage,
      label: 'relationships',
      onPageChange: page => {
        relationshipPage = page;
        renderRelationshipCards();
      }
    });
  }

  entitySelect.addEventListener('change', renderExplorer);
  findPathBtn.addEventListener('click', renderPath);
  [pathSource, pathTarget].forEach(select => select.addEventListener('change', renderPath));
  const resetRelationshipCards = () => {
    relationshipPage = 0;
    renderRelationshipCards();
  };
  searchInput.addEventListener('input', resetRelationshipCards);
  [visibilitySelect, stabilitySelect, storySelect].forEach(select => select.addEventListener('change', resetRelationshipCards));
  Object.values(categoryFilters).forEach(checkbox => checkbox.addEventListener('change', resetRelationshipCards));
  renderExplorer();
  renderPath();
  renderRelationshipCards();
}

/**
 * Get entity by ID and type from universe.
 */
function getEntityById(universe, id, type) {
  switch (type) {
    case 'Character':
      return universe.characters.find(x => x.id === id);
    case 'Location':
      return universe.locations.find(x => x.id === id);
    case 'Faction':
      return universe.factions.find(x => x.id === id);
    case 'Lore Note':
      return universe.loreNotes.find(x => x.id === id);
    default:
      return null;
  }
}

/**
 * Open a modal form to create or edit a relationship.
 */
function openRelationshipForm(rel = null, universe) {
  const isEdit = !!rel;
  const existingIntel = rel ? getRelationshipIntelligence(rel) : {
    strength: 5,
    influence: 5,
    visibility: 'Public',
    stability: 'Stable',
    tone: 'Respect'
  };
  const modal = createModal(`${isEdit ? 'Edit' : 'Add'} Relationship`);
  const form = document.createElement('form');
  form.className = 'relationship-form';

  function createFormRow(className = '') {
    const row = document.createElement('div');
    row.className = `relationship-form-row ${className}`.trim();
    return row;
  }

  function createLabeledSelect(labelText, options, selectedValue) {
    const wrap = document.createElement('div');
    wrap.className = 'relationship-field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const select = document.createElement('select');
    options.forEach(optionText => {
      const option = document.createElement('option');
      option.value = optionText;
      option.textContent = optionText;
      select.appendChild(option);
    });
    select.value = selectedValue;
    wrap.append(label, select);
    return { wrap, select };
  }

  function createScoreControl(labelText, value) {
    const wrap = document.createElement('div');
    wrap.className = 'relationship-field relationship-score-control';
    const top = document.createElement('div');
    top.className = 'relationship-score-label';
    const label = document.createElement('label');
    label.textContent = labelText;
    const output = document.createElement('strong');
    output.textContent = `${value}/10`;
    top.append(label, output);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '1';
    input.max = '10';
    input.step = '1';
    input.value = String(value);
    input.addEventListener('input', () => {
      output.textContent = `${input.value}/10`;
    });
    wrap.append(top, input);
    return { wrap, input };
  }

  // Source entity select
  const entityRow = createFormRow('relationship-entity-row');
  const sourceField = document.createElement('div');
  sourceField.className = 'relationship-field';
  const sourceLabel = document.createElement('label');
  sourceLabel.textContent = 'Source Entity';
  const sourceSelect = document.createElement('select');
  populateEntityOptions(sourceSelect, universe);
  if (isEdit) {
    sourceSelect.value = rel.sourceId + '|' + rel.sourceType;
  }
  sourceField.append(sourceLabel, sourceSelect);
  // Target entity select
  const targetField = document.createElement('div');
  targetField.className = 'relationship-field';
  const targetLabel = document.createElement('label');
  targetLabel.textContent = 'Target Entity';
  const targetSelect = document.createElement('select');
  populateEntityOptions(targetSelect, universe);
  if (isEdit) {
    targetSelect.value = rel.targetId + '|' + rel.targetType;
  }
  targetField.append(targetLabel, targetSelect);
  entityRow.append(sourceField, targetField);

  // Type select
  const typeField = createLabeledSelect('Relationship Type', RELATIONSHIP_TYPES, isEdit ? rel.type : RELATIONSHIP_TYPES[0]);
  const typeSelect = typeField.select;

  const intelligenceRow = createFormRow('relationship-intelligence-row');
  const strengthControl = createScoreControl('Strength', existingIntel.strength);
  const influenceControl = createScoreControl('Influence', existingIntel.influence);
  const visibilityField = createLabeledSelect('Visibility', RELATIONSHIP_VISIBILITY_OPTIONS, existingIntel.visibility);
  const stabilityField = createLabeledSelect('Stability', RELATIONSHIP_STABILITY_OPTIONS, existingIntel.stability);
  const toneField = createLabeledSelect('Tone', RELATIONSHIP_TONE_OPTIONS, existingIntel.tone);
  intelligenceRow.append(
    strengthControl.wrap,
    influenceControl.wrap,
    visibilityField.wrap,
    stabilityField.wrap,
    toneField.wrap
  );

  // Description
  const descField = document.createElement('div');
  descField.className = 'relationship-field';
  const descLabel = document.createElement('label');
  descLabel.textContent = 'Description';
  const descInput = document.createElement('textarea');
  descInput.value = isEdit ? rel.description : '';
  descField.append(descLabel, descInput);

  const detailRow = createFormRow('relationship-detail-row');
  // Importance
  const importanceField = document.createElement('div');
  importanceField.className = 'relationship-field';
  const importanceLabel = document.createElement('label');
  importanceLabel.textContent = 'Importance';
  const importanceInput = document.createElement('input');
  importanceInput.type = 'text';
  importanceInput.value = isEdit ? rel.importance : '';
  importanceField.append(importanceLabel, importanceInput);
  // Tags
  const tagsField = document.createElement('div');
  tagsField.className = 'relationship-field';
  const tagsLabel = document.createElement('label');
  tagsLabel.textContent = 'Tags (comma-separated)';
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.value = isEdit ? rel.tags : '';
  tagsField.append(tagsLabel, tagsInput);
  detailRow.append(importanceField, tagsField);

  // Assemble form
  form.append(entityRow, typeField.wrap, intelligenceRow, descField, detailRow);
  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn';
  submitBtn.type = 'submit';
  submitBtn.textContent = isEdit ? 'Save' : 'Add';
  form.appendChild(submitBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const [sourceId, sourceType] = sourceSelect.value.split('|');
    const [targetId, targetType] = targetSelect.value.split('|');
    const type = typeSelect.value;
    const description = descInput.value.trim();
    const importance = importanceInput.value.trim();
    const tags = tagsInput.value.trim();
    const strength = clampRelationshipScore(strengthControl.input.value);
    const influence = clampRelationshipScore(influenceControl.input.value);
    const visibility = visibilityField.select.value;
    const stability = stabilityField.select.value;
    const tone = toneField.select.value;
    if (!sourceId || !targetId) {
      alert('Please select both source and target entities.');
      return;
    }
    let newRel = rel || {};
    if (!isEdit) newRel.id = generateId();
    newRel.sourceId = sourceId;
    newRel.sourceType = sourceType;
    newRel.targetId = targetId;
    newRel.targetType = targetType;
    newRel.type = type;
    newRel.description = description;
    newRel.importance = importance;
    newRel.tags = tags;
    newRel.strength = strength;
    newRel.influence = influence;
    newRel.visibility = visibility;
    newRel.stability = stability;
    newRel.tone = tone;
    newRel.created = rel ? rel.created : new Date().toISOString();
    newRel.updated = new Date().toISOString();
    // Save or update
    const idx = universe.relationships.findIndex(r => r.id === newRel.id);
    if (idx >= 0) universe.relationships[idx] = newRel;
    else universe.relationships.push(newRel);
    universe.updated = newRel.updated;
    saveData();
    closeModal();
    renderRelationships();
  });
  modal.body.appendChild(form);
  showModal(modal);
}

/**
 * Populate a select element with all entities from universe.
 * Each option value is "id|type".
 */
function populateEntityOptions(select, universe) {
  // Clear existing options
  select.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '-- Select --';
  select.appendChild(blank);
  const addOptions = (arr, type) => {
    arr.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id + '|' + type;
      opt.textContent = `${item.name} (${type})`;
      select.appendChild(opt);
    });
  };
  addOptions(universe.characters, 'Character');
  addOptions(universe.locations, 'Location');
  addOptions(universe.factions, 'Faction');
  addOptions(universe.loreNotes, 'Lore Note');
}

const GRAPH_ENTITY_META = {
  Character: { label: 'Characters', shortLabel: 'Character', className: 'character', accent: '#9f8cff' },
  Location: { label: 'Locations', shortLabel: 'Location', className: 'location', accent: '#68a8ff' },
  Faction: { label: 'Factions', shortLabel: 'Faction', className: 'faction', accent: '#f07178' },
  'Lore Note': { label: 'Lore Notes', shortLabel: 'Lore', className: 'lore', accent: '#e3b341' }
};

const GRAPH_RELATIONSHIP_COLORS = {
  Ally: '#68d391',
  Enemy: '#f07178',
  Family: '#f6ad55',
  'Member Of': '#63b3ed',
  'Leader Of': '#b794f4',
  'Located In': '#7dd3fc',
  Controls: '#fb7185',
  'Created By': '#e3b341',
  Rival: '#f97316',
  Mentor: '#a7f3d0',
  'Secret Connection': '#c084fc',
  Romantic: '#fb8ecf',
  Trade: '#38d9a9',
  Cultural: '#facc15',
  Religious: '#d8b4fe',
  Military: '#ef4444',
  Professional: '#60a5fa',
  Friendship: '#86efac',
  Neighbor: '#93c5fd',
  Rivalry: '#fb923c',
  Custom: '#a0aec0'
};

function getGraphEntityCollections(universe) {
  return [
    { type: 'Character', items: universe.characters },
    { type: 'Faction', items: universe.factions },
    { type: 'Location', items: universe.locations },
    { type: 'Lore Note', items: universe.loreNotes }
  ];
}

function getGraphEntityText(entity, type) {
  return [
    entity.name,
    entity.description,
    entity.tags,
    entity.notes,
    entity.role,
    entity.species,
    entity.goals,
    entity.secrets,
    entity.region,
    entity.importance,
    entity.leader,
    entity.ideology,
    entity.summary,
    entity.content,
    type
  ].join(' ').toLowerCase();
}

function getGraphConnections(universe, entityId) {
  return universe.relationships.filter(rel => rel.sourceId === entityId || rel.targetId === entityId);
}

function getIndexedConnectionCount(universe, entityId) {
  const indexed = universe.relationshipIndex?.byEntity?.[entityId];
  return indexed ? indexed.length : getGraphConnections(universe, entityId).length;
}

function getGraphNodeImportanceScore(universe, node) {
  const connectionCount = getIndexedConnectionCount(universe, node.id);
  let score = connectionCount;
  if (node.type === 'Faction') score += 28;
  if (node.type === 'Location') {
    if (['cosmicDomain', 'sector', 'starSystem', 'planet', 'country', 'city'].includes(node.entity.scaleType)) score += 24;
    else score += 10;
  }
  if (node.type === 'Character') {
    if (node.entity.importanceTier === 'Major Figure') score += 36;
    else if (node.entity.importanceTier === 'Secondary Figure') score += 14;
  }
  if (node.type === 'Lore Note') score -= 8;
  const highInfluence = universe.relationshipIndex?.highInfluence || [];
  if (highInfluence.length) {
    const related = universe.relationshipIndex?.byEntity?.[node.id] || [];
    score += related.filter(relId => highInfluence.includes(relId)).length * 2;
  }
  return score;
}

function selectGraphFocusNodes(universe, nodes, limit, selectedNodeId = null) {
  const selected = selectedNodeId ? nodes.find(node => node.id === selectedNodeId) : null;
  const scored = nodes
    .filter(node => !selected || node.id !== selected.id)
    .map(node => ({ node, score: getGraphNodeImportanceScore(universe, node) }))
    .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name));
  const picked = selected ? [selected] : [];
  scored.forEach(item => {
    if (picked.length < limit) picked.push(item.node);
  });
  return picked;
}

function getGraphRelationshipColor(type) {
  return GRAPH_RELATIONSHIP_COLORS[type] || GRAPH_RELATIONSHIP_COLORS.Custom;
}

function getGraphRelationshipStrength(rel) {
  if (rel.strength !== undefined && rel.strength !== '') {
    const strength = clampRelationshipScore(rel.strength);
    if (strength >= 9) return 5;
    if (strength >= 7) return 4;
    if (strength >= 4) return 3;
    return 2;
  }
  const importance = normalizeText(rel.importance);
  if (importance.includes('high')) return 4;
  if (importance.includes('medium')) return 3;
  if (['Enemy', 'Rival', 'Leader Of', 'Secret Connection', 'Controls'].includes(rel.type)) return 3;
  return 2;
}

function getGraphEntityDescription(entity, type) {
  if (entity.description) return entity.description;
  if (type === 'Character' && entity.goals) return `Goal: ${entity.goals}`;
  if (type === 'Faction' && entity.goals) return `Goal: ${entity.goals}`;
  if (type === 'Location' && entity.importance) return entity.importance;
  if (type === 'Lore Note') return entity.summary || entity.content || '';
  return 'No description yet.';
}

function getGraphConnectedEntity(universe, rel, entityId) {
  const isSource = rel.sourceId === entityId;
  return getEntityById(universe, isSource ? rel.targetId : rel.sourceId, isSource ? rel.targetType : rel.sourceType);
}

/**
 * Legacy radial graph reference retained for older interaction patterns.
 */
function renderLegacyGraph() {
  clearMain();
  const universe = getUniverseById(appState.currentUniverseId);
  if (!universe) {
    const warn = document.createElement('p');
    warn.textContent = 'Please select a universe first.';
    mainContent.appendChild(warn);
    return;
  }
  // Filter by entity type checkboxes
  const filterDiv = document.createElement('div');
  filterDiv.style.display = 'flex';
  filterDiv.style.gap = '0.5rem';
  const types = ['Character', 'Location', 'Faction', 'Lore Note'];
  const typeFilters = {};
  types.forEach(t => {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    typeFilters[t] = checkbox;
    label.appendChild(checkbox);
    const span = document.createElement('span');
    span.style.marginLeft = '0.3rem';
    span.textContent = t;
    label.appendChild(span);
    filterDiv.appendChild(label);
  });
  mainContent.appendChild(filterDiv);
  const graphContainer = document.createElement('div');
  graphContainer.id = 'graph-container';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'graph-svg');
  graphContainer.appendChild(svg);
  mainContent.appendChild(graphContainer);
  // Info panel
  const infoPanel = document.createElement('div');
  infoPanel.className = 'card';
  infoPanel.style.marginTop = '1rem';
  infoPanel.innerHTML = '<strong>Click on a node or edge to view details</strong>';
  mainContent.appendChild(infoPanel);
  // Layout and draw graph
  function draw() {
    svg.innerHTML = '';
    const nodes = [];
    const nodePositions = {};
    const edges = [];
    // Collect nodes based on filters
    if (typeFilters['Character'].checked) nodes.push(...universe.characters.map(e => ({ id: e.id, type: 'Character', name: e.name })));
    if (typeFilters['Location'].checked) nodes.push(...universe.locations.map(e => ({ id: e.id, type: 'Location', name: e.name })));
    if (typeFilters['Faction'].checked) nodes.push(...universe.factions.map(e => ({ id: e.id, type: 'Faction', name: e.name })));
    if (typeFilters['Lore Note'].checked) nodes.push(...universe.loreNotes.map(e => ({ id: e.id, type: 'Lore Note', name: e.name })));
    // Build map for quick lookup
    const nodeMap = {};
    nodes.forEach(n => nodeMap[n.id] = n);
    // Collect edges where both nodes are present in nodeMap
    universe.relationships.forEach(rel => {
      if (nodeMap[rel.sourceId] && nodeMap[rel.targetId]) {
        edges.push(rel);
      }
    });
    const n = nodes.length;
    if (n === 0) {
      svg.textContent = 'No entities selected.';
      return;
    }
    // Layout: radial circle
    const cx = graphContainer.clientWidth / 2;
    const cy = graphContainer.clientHeight / 2;
    const radius = Math.min(cx, cy) - 50;
    nodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / n;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      nodePositions[node.id] = { x, y };
    });
    // Draw edges
    edges.forEach(edge => {
      const srcPos = nodePositions[edge.sourceId];
      const tgtPos = nodePositions[edge.targetId];
      if (!srcPos || !tgtPos) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', srcPos.x);
      line.setAttribute('y1', srcPos.y);
      line.setAttribute('x2', tgtPos.x);
      line.setAttribute('y2', tgtPos.y);
      line.setAttribute('stroke', '#4c5670');
      line.setAttribute('stroke-width', '2');
      line.addEventListener('click', () => {
        const source = getEntityById(universe, edge.sourceId, edge.sourceType);
        const target = getEntityById(universe, edge.targetId, edge.targetType);
        infoPanel.innerHTML = `<h3>Relationship</h3>
          <p><strong>${edge.type}</strong></p>
          <p>${source.name} (${edge.sourceType}) → ${target.name} (${edge.targetType})</p>
          <p>${edge.description || ''}</p>`;
      });
      svg.appendChild(line);
    });
    // Draw nodes
    nodes.forEach(node => {
      const { x, y } = nodePositions[node.id];
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', '18');
      const colorMap = {
        'Character': '#82b1ff',
        'Location': '#ffd59e',
        'Faction': '#fa81a7',
        'Lore Note': '#7de9a2'
      };
      circle.setAttribute('fill', colorMap[node.type] || '#888');
      circle.setAttribute('stroke', '#333');
      circle.setAttribute('stroke-width', '2');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y + 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '8');
      text.setAttribute('fill', '#000');
      text.textContent = node.name.slice(0, 10);
      group.appendChild(circle);
      group.appendChild(text);
      group.addEventListener('click', () => {
        const ent = getEntityById(universe, node.id, node.type);
        infoPanel.innerHTML = `<h3>${node.type}</h3>
          <p><strong>${ent.name}</strong></p>
          <p>${ent.description || ''}</p>`;
      });
      svg.appendChild(group);
    });
  }
  Object.values(typeFilters).forEach(cb => cb.addEventListener('change', draw));
  // Draw initial
  setTimeout(draw, 0);
}

/**
 * Render Graph page as a creator-focused visual explorer.
 */
function renderGraph() {
  clearMain();
  const universe = getUniverseById(appState.currentUniverseId);
  if (!universe) {
    const warn = document.createElement('p');
    warn.textContent = 'Please select a universe first.';
    mainContent.appendChild(warn);
    return;
  }

  let selectedNodeId = null;
  let selectedRelationshipId = null;
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;

  const graphHeader = document.createElement('div');
  graphHeader.className = 'graph-header card';
  const graphTitle = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = 'Universe Explorer';
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Explore entities as clustered cards, follow labeled relationships, and focus on one part of the world at a time.';
  graphTitle.append(h2, subtitle);
  const graphStats = document.createElement('div');
  graphStats.className = 'graph-stats';
  [
    ['Characters', universe.characters.length],
    ['Factions', universe.factions.length],
    ['Locations', universe.locations.length],
    ['Lore', universe.loreNotes.length],
    ['Relationships', universe.relationships.length]
  ].forEach(([label, value]) => {
    const stat = document.createElement('div');
    stat.className = 'graph-stat';
    const count = document.createElement('strong');
    count.textContent = value;
    const text = document.createElement('span');
    text.textContent = label;
    stat.append(count, text);
    graphStats.appendChild(stat);
  });
  graphHeader.append(graphTitle, graphStats);
  mainContent.appendChild(graphHeader);

  const filterDiv = document.createElement('div');
  filterDiv.className = 'graph-toolbar card';
  const typeGroup = document.createElement('div');
  typeGroup.className = 'graph-filter-group';
  const typeTitle = document.createElement('h3');
  typeTitle.textContent = 'Entities';
  typeGroup.appendChild(typeTitle);
  const typeFilters = {};
  ['Character', 'Location', 'Faction', 'Lore Note'].forEach(t => {
    const label = document.createElement('label');
    label.className = 'graph-filter';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    typeFilters[t] = checkbox;
    const text = document.createElement('span');
    text.textContent = GRAPH_ENTITY_META[t].label;
    label.append(checkbox, text);
    typeGroup.appendChild(label);
  });

  const relationshipGroup = document.createElement('div');
  relationshipGroup.className = 'graph-filter-group relationship-filters';
  const relationshipTitle = document.createElement('h3');
  relationshipTitle.textContent = 'Relationships';
  relationshipGroup.appendChild(relationshipTitle);
  const relationshipFilters = {};
  RELATIONSHIP_TYPES.forEach(type => {
    const label = document.createElement('label');
    label.className = 'graph-filter';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    relationshipFilters[type] = checkbox;
    const swatch = document.createElement('span');
    swatch.className = 'relationship-swatch';
    swatch.style.backgroundColor = getGraphRelationshipColor(type);
    const text = document.createElement('span');
    text.textContent = type === 'Secret Connection' ? 'Secret' : type;
    label.append(checkbox, swatch, text);
    relationshipGroup.appendChild(label);
  });

  const toolGroup = document.createElement('div');
  toolGroup.className = 'graph-filter-group graph-tools';
  const toolsTitle = document.createElement('h3');
  toolsTitle.textContent = 'Explore';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Find entity, tag, or lore';
  searchInput.className = 'graph-search';
  const zoomControls = document.createElement('div');
  zoomControls.className = 'graph-zoom-controls';
  const zoomOut = document.createElement('button');
  zoomOut.className = 'btn secondary';
  zoomOut.type = 'button';
  zoomOut.textContent = '-';
  const zoomReset = document.createElement('button');
  zoomReset.className = 'btn secondary';
  zoomReset.type = 'button';
  zoomReset.textContent = 'Reset';
  const zoomIn = document.createElement('button');
  zoomIn.className = 'btn secondary';
  zoomIn.type = 'button';
  zoomIn.textContent = '+';
  zoomControls.append(zoomOut, zoomReset, zoomIn);
  const graphLimitNotice = document.createElement('p');
  graphLimitNotice.className = 'graph-safety-note';
  toolGroup.append(toolsTitle, searchInput, zoomControls, graphLimitNotice);

  filterDiv.append(typeGroup, relationshipGroup, toolGroup);
  mainContent.appendChild(filterDiv);

  const explorer = document.createElement('div');
  explorer.className = 'graph-explorer';
  const graphContainer = document.createElement('div');
  graphContainer.id = 'graph-container';
  graphContainer.className = 'graph-viewport';
  const graphScene = document.createElement('div');
  graphScene.className = 'graph-scene';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'graph-svg');
  svg.classList.add('graph-links');
  const cardLayer = document.createElement('div');
  cardLayer.className = 'graph-card-layer';
  graphScene.append(svg, cardLayer);
  graphContainer.appendChild(graphScene);

  const infoPanel = document.createElement('div');
  infoPanel.className = 'graph-details card';
  explorer.append(graphContainer, infoPanel);
  mainContent.appendChild(explorer);

  function applyViewportTransform() {
    graphScene.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  }

  function renderEmptyDetails() {
    infoPanel.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Select a card';
    const copy = document.createElement('p');
    copy.textContent = 'Tap an entity card or relationship label to inspect connections, tags, and story context.';
    infoPanel.append(title, copy);
  }

  function renderRelationshipDetails(rel) {
    infoPanel.innerHTML = '';
    const source = getEntityById(universe, rel.sourceId, rel.sourceType);
    const target = getEntityById(universe, rel.targetId, rel.targetType);
    const intel = getRelationshipIntelligence(rel);
    const title = document.createElement('h3');
    title.textContent = rel.type;
    const meta = document.createElement('p');
    meta.className = 'graph-detail-meta';
    meta.textContent = `${source ? source.name : rel.sourceId} -> ${target ? target.name : rel.targetId}`;
    const description = document.createElement('p');
    description.textContent = rel.description || 'No relationship description yet.';
    const details = document.createElement('dl');
    details.className = 'graph-detail-list';
    [
      ['Strength', `${intel.strength}/10`],
      ['Influence', `${intel.influence}/10`],
      ['Tone', intel.tone],
      ['Visibility', intel.visibility],
      ['Stability', intel.stability],
      ['Story Potential', intel.story.label],
      ['Importance', rel.importance || 'Unrated'],
      ['Tags', rel.tags || 'None']
    ].forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      details.append(dt, dd);
    });
    infoPanel.append(title, meta, description, details);
  }

  function renderEntityDetails(node) {
    infoPanel.innerHTML = '';
    const entity = getEntityById(universe, node.id, node.type);
    if (!entity) {
      renderEmptyDetails();
      return;
    }
    const connections = getGraphConnections(universe, node.id);
    const title = document.createElement('h3');
    title.textContent = entity.name;
    const meta = document.createElement('p');
    meta.className = 'graph-detail-meta';
    meta.textContent = `${GRAPH_ENTITY_META[node.type].shortLabel} | ${connections.length} ${connections.length === 1 ? 'connection' : 'connections'}`;
    const description = document.createElement('p');
    description.textContent = getGraphEntityDescription(entity, node.type);
    const details = document.createElement('dl');
    details.className = 'graph-detail-list';
    [
      ['Tags', entity.tags || 'None'],
      ['Notes', entity.notes || 'None']
    ].forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      details.append(dt, dd);
    });
    const connectedTitle = document.createElement('h4');
    connectedTitle.textContent = 'Connected Entities';
    const connectedList = document.createElement('div');
    connectedList.className = 'graph-connected-list';
    if (connections.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No relationships yet. Add one to connect this part of the universe.';
      connectedList.appendChild(empty);
    } else {
      const visibleConnections = connections.slice(0, GRAPH_DETAIL_CONNECTION_LIMIT);
      visibleConnections.forEach(rel => {
        const other = getGraphConnectedEntity(universe, rel, node.id);
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'graph-connected-item';
        item.textContent = `${rel.type}: ${other ? other.name : 'Unknown entity'}`;
        item.addEventListener('click', () => {
          if (!other) return;
          selectedNodeId = other.id;
          selectedRelationshipId = null;
          draw();
        });
        connectedList.appendChild(item);
      });
      if (connections.length > visibleConnections.length) {
        const more = document.createElement('p');
        more.className = 'graph-safety-note';
        more.textContent = `Showing ${visibleConnections.length} of ${connections.length} connections. Use Relationship Intelligence for the full indexed list.`;
        connectedList.appendChild(more);
      }
    }
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn secondary';
    clearBtn.textContent = 'Clear Focus';
    clearBtn.addEventListener('click', () => {
      selectedNodeId = null;
      selectedRelationshipId = null;
      draw();
    });
    infoPanel.append(title, meta, description, details, connectedTitle, connectedList, clearBtn);
  }

  function isRelatedToFocus(edge) {
    return selectedNodeId && (edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId);
  }

  function updateDetails(nodes, edges) {
    if (selectedRelationshipId) {
      const rel = edges.find(edge => edge.id === selectedRelationshipId) || universe.relationships.find(edge => edge.id === selectedRelationshipId);
      if (rel) {
        renderRelationshipDetails(rel);
        return;
      }
    }
    if (selectedNodeId) {
      const node = nodes.find(item => item.id === selectedNodeId) || getGraphEntityCollections(universe).flatMap(group => group.items.map(item => ({ ...item, type: group.type }))).find(item => item.id === selectedNodeId);
      if (node) {
        renderEntityDetails(node);
        return;
      }
    }
    renderEmptyDetails();
  }

  function draw() {
    svg.innerHTML = '';
    cardLayer.innerHTML = '';
    let nodes = [];
    const positions = {};
    let edges = [];
    const query = searchInput.value.trim().toLowerCase();

    getGraphEntityCollections(universe).forEach(group => {
      if (!typeFilters[group.type].checked) return;
      group.items.forEach(entity => {
        if (query && !getGraphEntityText(entity, group.type).includes(query)) return;
        nodes.push({ id: entity.id, type: group.type, name: entity.name, entity });
      });
    });

    const matchingNodeCount = nodes.length;
    if (nodes.length > GRAPH_NODE_RENDER_LIMIT) {
      nodes = selectGraphFocusNodes(universe, nodes, GRAPH_NODE_RENDER_LIMIT, selectedNodeId);
      graphLimitNotice.textContent = `Focused map: showing ${nodes.length} of ${matchingNodeCount} matching entities, prioritized by major figures, factions, locations, and high-influence links. Search to narrow the full universe.`;
    } else {
      graphLimitNotice.textContent = matchingNodeCount > 0 ? `${matchingNodeCount} matching entities visible.` : '';
    }

    const nodeMap = {};
    nodes.forEach(node => nodeMap[node.id] = node);
    universe.relationships.forEach(rel => {
      const typeAllowed = relationshipFilters[rel.type] ? relationshipFilters[rel.type].checked : true;
      if (typeAllowed && nodeMap[rel.sourceId] && nodeMap[rel.targetId]) edges.push(rel);
    });
    const matchingEdgeCount = edges.length;
    if (edges.length > GRAPH_EDGE_RENDER_LIMIT) {
      const highInfluence = new Set(universe.relationshipIndex?.highInfluence || []);
      const unstable = new Set(universe.relationshipIndex?.unstable || []);
      edges = edges
        .map(edge => ({ edge, score: (highInfluence.has(edge.id) ? 20 : 0) + (unstable.has(edge.id) ? 12 : 0) + inferRelationshipInfluence(edge) + inferRelationshipStrength(edge) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, GRAPH_EDGE_RENDER_LIMIT)
        .map(item => item.edge);
      graphLimitNotice.textContent += ` Showing ${edges.length} of ${matchingEdgeCount} matching relationships for readability.`;
    }

    if (nodes.length < 2) {
      const empty = document.createElement('div');
      empty.className = 'graph-empty-state';
      const strong = document.createElement('strong');
      strong.textContent = 'Add more entities and relationships to grow your universe graph.';
      const copy = document.createElement('span');
      copy.textContent = 'Creator cards appear once at least two matching entities are visible.';
      empty.append(strong, copy);
      cardLayer.appendChild(empty);
      graphScene.style.width = '100%';
      graphScene.style.height = '100%';
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      updateDetails(nodes, edges);
      return;
    }

    const cardWidth = 218;
    const cardHeight = 106;
    const gapX = 96;
    const gapY = 34;
    const startX = 36;
    const startY = 88;
    const grouped = getGraphEntityCollections(universe)
      .map(group => ({ type: group.type, nodes: nodes.filter(node => node.type === group.type) }))
      .filter(group => group.nodes.length > 0);

    grouped.forEach((group, groupIndex) => {
      const x = startX + groupIndex * (cardWidth + gapX);
      const cluster = document.createElement('div');
      cluster.className = `graph-cluster graph-cluster-${GRAPH_ENTITY_META[group.type].className}`;
      cluster.style.left = `${x - 14}px`;
      cluster.style.top = '24px';
      cluster.style.width = `${cardWidth + 28}px`;
      cluster.style.height = `${Math.max(160, group.nodes.length * (cardHeight + gapY) + 82)}px`;
      const clusterTitle = document.createElement('div');
      clusterTitle.className = 'graph-cluster-title';
      clusterTitle.textContent = GRAPH_ENTITY_META[group.type].label;
      const clusterCount = document.createElement('span');
      clusterCount.textContent = group.nodes.length;
      clusterTitle.appendChild(clusterCount);
      cluster.appendChild(clusterTitle);
      cardLayer.appendChild(cluster);

      group.nodes.forEach((node, nodeIndex) => {
        const y = startY + nodeIndex * (cardHeight + gapY);
        positions[node.id] = {
          x: x + cardWidth / 2,
          y: y + cardHeight / 2,
          left: x,
          top: y,
          width: cardWidth,
          height: cardHeight
        };
      });
    });

    const sceneWidth = Math.max(graphContainer.clientWidth || 960, startX * 2 + grouped.length * (cardWidth + gapX));
    const maxRows = Math.max(...grouped.map(group => group.nodes.length));
    const sceneHeight = Math.max(graphContainer.clientHeight || 560, startY + maxRows * (cardHeight + gapY) + 70);
    graphScene.style.width = `${sceneWidth}px`;
    graphScene.style.height = `${sceneHeight}px`;
    svg.setAttribute('width', sceneWidth);
    svg.setAttribute('height', sceneHeight);

    edges.forEach(edge => {
      const srcPos = positions[edge.sourceId];
      const tgtPos = positions[edge.targetId];
      if (!srcPos || !tgtPos) return;
      const color = getGraphRelationshipColor(edge.type);
      const direction = tgtPos.x >= srcPos.x ? 1 : -1;
      const startEdgeX = srcPos.x + direction * (srcPos.width / 2 - 4);
      const endEdgeX = tgtPos.x - direction * (tgtPos.width / 2 - 4);
      const midX = (startEdgeX + endEdgeX) / 2;
      const curve = Math.max(52, Math.abs(endEdgeX - startEdgeX) * 0.35);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startEdgeX} ${srcPos.y} C ${startEdgeX + direction * curve} ${srcPos.y}, ${endEdgeX - direction * curve} ${tgtPos.y}, ${endEdgeX} ${tgtPos.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', getGraphRelationshipStrength(edge));
      path.setAttribute('stroke-linecap', 'round');
      path.classList.add('graph-edge');
      if (selectedNodeId && !isRelatedToFocus(edge)) path.classList.add('muted');
      if (selectedRelationshipId === edge.id || isRelatedToFocus(edge)) path.classList.add('highlighted');
      path.addEventListener('click', () => {
        selectedRelationshipId = edge.id;
        selectedNodeId = null;
        draw();
      });
      svg.appendChild(path);

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'graph-edge-label';
      if (selectedNodeId && !isRelatedToFocus(edge)) label.classList.add('muted');
      if (selectedRelationshipId === edge.id || isRelatedToFocus(edge)) label.classList.add('highlighted');
      label.textContent = edge.type;
      label.style.left = `${midX}px`;
      label.style.top = `${(srcPos.y + tgtPos.y) / 2}px`;
      label.style.borderColor = color;
      label.addEventListener('click', () => {
        selectedRelationshipId = edge.id;
        selectedNodeId = null;
        draw();
      });
      cardLayer.appendChild(label);
    });

    nodes.forEach(node => {
      const pos = positions[node.id];
      if (!pos) return;
      const meta = GRAPH_ENTITY_META[node.type];
      const connectionCount = getIndexedConnectionCount(universe, node.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `graph-node-card graph-node-${meta.className}`;
      card.style.left = `${pos.left}px`;
      card.style.top = `${pos.top}px`;
      card.style.width = `${pos.width}px`;
      card.style.minHeight = `${pos.height}px`;
      card.style.setProperty('--node-accent', meta.accent);
      if (selectedNodeId === node.id) card.classList.add('selected');
      if (selectedNodeId && selectedNodeId !== node.id) {
        const connected = edges.some(edge => (edge.sourceId === selectedNodeId && edge.targetId === node.id) || (edge.targetId === selectedNodeId && edge.sourceId === node.id));
        card.classList.toggle('muted', !connected);
        card.classList.toggle('connected', connected);
      }
      const name = document.createElement('strong');
      name.className = 'graph-node-name';
      name.textContent = node.name;
      const type = document.createElement('span');
      type.className = 'graph-node-type';
      type.textContent = meta.shortLabel;
      const count = document.createElement('span');
      count.className = 'graph-node-count';
      const noun = node.type === 'Lore Note' ? 'reference' : 'connection';
      count.textContent = `${connectionCount} ${connectionCount === 1 ? noun : `${noun}s`}`;
      const snippet = document.createElement('span');
      snippet.className = 'graph-node-snippet';
      snippet.textContent = getGraphEntityDescription(node.entity, node.type).slice(0, 86);
      card.append(name, type, count, snippet);
      card.addEventListener('click', () => {
        selectedNodeId = selectedNodeId === node.id ? null : node.id;
        selectedRelationshipId = null;
        draw();
      });
      cardLayer.appendChild(card);
    });

    updateDetails(nodes, edges);
  }

  function setZoom(nextZoom) {
    zoomLevel = Math.min(1.45, Math.max(0.62, nextZoom));
    applyViewportTransform();
  }

  zoomOut.addEventListener('click', () => setZoom(zoomLevel - 0.12));
  zoomIn.addEventListener('click', () => setZoom(zoomLevel + 0.12));
  zoomReset.addEventListener('click', () => {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyViewportTransform();
  });
  Object.values(typeFilters).forEach(cb => cb.addEventListener('change', draw));
  Object.values(relationshipFilters).forEach(cb => cb.addEventListener('change', draw));
  searchInput.addEventListener('input', draw);

  let isPanning = false;
  let lastPoint = null;
  graphContainer.addEventListener('pointerdown', (e) => {
    if (e.target.closest && (e.target.closest('.graph-node-card') || e.target.closest('.graph-edge-label') || e.target.closest('.graph-empty-state'))) return;
    isPanning = true;
    lastPoint = { x: e.clientX, y: e.clientY };
    graphContainer.classList.add('panning');
  });
  graphContainer.addEventListener('pointermove', (e) => {
    if (!isPanning || !lastPoint) return;
    panX += e.clientX - lastPoint.x;
    panY += e.clientY - lastPoint.y;
    lastPoint = { x: e.clientX, y: e.clientY };
    applyViewportTransform();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(eventName => {
    graphContainer.addEventListener(eventName, () => {
      isPanning = false;
      lastPoint = null;
      graphContainer.classList.remove('panning');
    });
  });
  graphContainer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    setZoom(zoomLevel + (e.deltaY > 0 ? -0.08 : 0.08));
  });

  applyViewportTransform();
  setTimeout(draw, 0);
}

/**
 * Render Search page
 */
function renderSearch() {
  clearMain();
  const universe = getUniverseById(appState.currentUniverseId);
  if (!universe) {
    const warn = document.createElement('p');
    warn.textContent = 'Please select a universe first.';
    mainContent.appendChild(warn);
    return;
  }
  const searchDiv = document.createElement('div');
  searchDiv.style.display = 'flex';
  searchDiv.style.gap = '0.5rem';
  const queryInput = document.createElement('input');
  queryInput.type = 'text';
  queryInput.placeholder = 'Search by keyword or tag';
  const typeSelect = document.createElement('select');
  ['All', 'Characters', 'Locations', 'Factions', 'Lore Notes'].forEach(opt => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    typeSelect.appendChild(option);
  });
  searchDiv.appendChild(queryInput);
  searchDiv.appendChild(typeSelect);
  mainContent.appendChild(searchDiv);
  const resultDiv = document.createElement('div');
  resultDiv.className = 'grid';
  mainContent.appendChild(resultDiv);

  function performSearch() {
    const query = queryInput.value.toLowerCase();
    const type = typeSelect.value;
    resultDiv.innerHTML = '';
    const searchItems = [];
    const addItems = (arr, label) => {
      arr.forEach(item => {
        const combined = [item.name, item.description, item.tags, item.notes].join(' ').toLowerCase();
        if (!query || combined.includes(query)) {
          searchItems.push({ ...item, entityType: label });
        }
      });
    };
    if (type === 'All' || type === 'Characters') addItems(universe.characters, 'Character');
    if (type === 'All' || type === 'Locations') addItems(universe.locations, 'Location');
    if (type === 'All' || type === 'Factions') addItems(universe.factions, 'Faction');
    if (type === 'All' || type === 'Lore Notes') addItems(universe.loreNotes, 'Lore Note');
    if (searchItems.length === 0) {
      resultDiv.innerHTML = '<p>No results found.</p>';
      return;
    }
    searchItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      const title = document.createElement('h3');
      title.textContent = `${item.name} (${item.entityType})`;
      card.appendChild(title);
      const desc = document.createElement('p');
      desc.textContent = item.description || '';
      card.appendChild(desc);
      resultDiv.appendChild(card);
    });
  }
  queryInput.addEventListener('input', performSearch);
  typeSelect.addEventListener('change', performSearch);
  performSearch();
}

/**
 * Render Continuity Audit page
 */
function renderAudit() {
  clearMain();
  const universe = getUniverseById(appState.currentUniverseId);
  if (!universe) {
    const warn = document.createElement('p');
    warn.textContent = 'Please select a universe first.';
    mainContent.appendChild(warn);
    return;
  }
  const issues = [];
  // Characters: missing goals or description
  universe.characters.forEach(char => {
    if (!char.description) issues.push({ severity: 'Medium', entity: char.name, issue: 'Character missing description', suggestion: 'Add a description to this character.' });
    if (!char.goals) issues.push({ severity: 'Medium', entity: char.name, issue: 'Character missing goals', suggestion: 'Define character goals.' });
  });
  // Factions: missing leader
  universe.factions.forEach(fac => {
    if (!fac.leader) issues.push({ severity: 'Medium', entity: fac.name, issue: 'Faction missing leader', suggestion: 'Assign a leader.' });
  });
  // Locations without connections
  universe.locations.forEach(loc => {
    const hasRel = universe.relationships.some(rel => rel.sourceId === loc.id || rel.targetId === loc.id);
    if (!hasRel) issues.push({ severity: 'Low', entity: loc.name, issue: 'Location without connections', suggestion: 'Link this location to another entity.' });
  });
  // Duplicate names across all entities
  const nameMap = {};
  const collect = (arr, type) => {
    arr.forEach(item => {
      const key = item.name.toLowerCase();
      if (!nameMap[key]) nameMap[key] = [];
      nameMap[key].push({ name: item.name, type });
    });
  };
  collect(universe.characters, 'Character');
  collect(universe.locations, 'Location');
  collect(universe.factions, 'Faction');
  collect(universe.loreNotes, 'Lore Note');
  Object.keys(nameMap).forEach(key => {
    const arr = nameMap[key];
    if (arr.length > 1) {
      const names = arr.map(i => `${i.name} (${i.type})`).join(', ');
      issues.push({ severity: 'High', entity: names, issue: 'Duplicate names', suggestion: 'Rename entities to be unique.' });
    }
  });
  // Similar names (simple check: first 4 letters match)
  const allNames = Object.keys(nameMap);
  for (let i = 0; i < allNames.length; i++) {
    for (let j = i + 1; j < allNames.length; j++) {
      const n1 = allNames[i];
      const n2 = allNames[j];
      if (n1 !== n2 && n1.substring(0, 4) === n2.substring(0, 4)) {
        issues.push({ severity: 'Low', entity: `${nameMap[n1][0].name} & ${nameMap[n2][0].name}`, issue: 'Similar names', suggestion: 'Differentiate names to avoid confusion.' });
      }
    }
  }
  // Empty lore notes
  universe.loreNotes.forEach(note => {
    if (!note.content) issues.push({ severity: 'Low', entity: note.name, issue: 'Empty lore note', suggestion: 'Fill in the full content.' });
  });
  // Relationships missing descriptions
  universe.relationships.forEach(rel => {
    if (!rel.description) {
      issues.push({ severity: 'Low', entity: `${rel.sourceId}→${rel.targetId}`, issue: 'Relationship missing description', suggestion: 'Add a description.' });
    }
  });
  // Display issues
  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Severity', 'Entity', 'Issue', 'Suggested Fix'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  if (issues.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'No issues detected! Great job!';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    issues.forEach(issue => {
      const tr = document.createElement('tr');
      const severityTd = document.createElement('td');
      severityTd.textContent = issue.severity;
      const entityTd = document.createElement('td');
      entityTd.textContent = issue.entity;
      const issueTd = document.createElement('td');
      issueTd.textContent = issue.issue;
      const suggTd = document.createElement('td');
      suggTd.textContent = issue.suggestion;
      tr.append(severityTd, entityTd, issueTd, suggTd);
      tbody.appendChild(tr);
    });
  }
  table.appendChild(tbody);
  mainContent.appendChild(table);
}

/**
 * Render Universe Chat page
 */
function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword));
}

function cleanList(items) {
  return items.filter(item => item !== null && item !== undefined && String(item).trim());
}

function formatBullets(items, emptyText, limit = 6) {
  const visible = cleanList(items).slice(0, limit);
  if (visible.length === 0) return emptyText;
  return visible.map(item => `- ${item}`).join('\n');
}

function wordCount(value = '') {
  const text = normalizeText(value);
  return text ? text.split(' ').length : 0;
}

function getAllUniverseEntities(universe) {
  return [
    ...universe.characters.map(entity => ({ entity, type: 'Character' })),
    ...universe.locations.map(entity => ({ entity, type: 'Location' })),
    ...universe.factions.map(entity => ({ entity, type: 'Faction' })),
    ...universe.loreNotes.map(entity => ({ entity, type: 'Lore Note' }))
  ];
}

function getEntitySearchText(item, type) {
  const entity = item.entity || item;
  const fields = [
    entity.name,
    entity.description,
    entity.tags,
    entity.notes,
    entity.role,
    entity.species,
    entity.personality,
    entity.goals,
    entity.secrets,
    entity.region,
    entity.importance,
    entity.leader,
    entity.ideology,
    entity.allies,
    entity.enemies,
    entity.category,
    entity.summary,
    entity.content,
    type
  ];
  return normalizeText(fields.join(' '));
}

function getEntityDetails(entity, type) {
  const lines = [];
  if (entity.description) lines.push(entity.description);
  if (type === 'Character') {
    if (entity.role) lines.push(`Role: ${entity.role}`);
    if (entity.species) lines.push(`Species: ${entity.species}`);
    if (entity.goals) lines.push(`Goals: ${entity.goals}`);
    if (entity.secrets) lines.push(`Secrets: ${entity.secrets}`);
  } else if (type === 'Faction') {
    if (entity.leader) lines.push(`Leader: ${entity.leader}`);
    if (entity.ideology) lines.push(`Ideology: ${entity.ideology}`);
    if (entity.goals) lines.push(`Goals: ${entity.goals}`);
    if (entity.allies) lines.push(`Allies: ${entity.allies}`);
    if (entity.enemies) lines.push(`Enemies: ${entity.enemies}`);
  } else if (type === 'Location') {
    if (entity.region) lines.push(`Region: ${entity.region}`);
    if (entity.importance) lines.push(`Importance: ${entity.importance}`);
  } else if (type === 'Lore Note') {
    if (entity.category) lines.push(`Category: ${entity.category}`);
    if (entity.summary) lines.push(`Summary: ${entity.summary}`);
    if (entity.content) lines.push(entity.content);
  }
  return lines;
}

function getRelationshipText(universe, rel) {
  const source = getEntityById(universe, rel.sourceId, rel.sourceType);
  const target = getEntityById(universe, rel.targetId, rel.targetType);
  const intel = getRelationshipIntelligence(rel);
  const sourceName = source ? source.name : rel.sourceId;
  const targetName = target ? target.name : rel.targetId;
  const detail = rel.description ? ` - ${rel.description}` : '';
  return `${sourceName} ${rel.type} ${targetName} (${intel.tone}, ${intel.visibility}, ${intel.stability}, story ${intel.story.label})${detail}`;
}

function getRelationshipWeight(rel) {
  const intel = getRelationshipIntelligence(rel);
  let score = 1;
  if (intel.strength >= 7) score += 1;
  if (intel.influence >= 7) score += 1;
  if (['High', 'Very High'].includes(intel.story.label)) score += 2;
  if (rel.description && rel.description.length > 40) score += 1;
  return score;
}

function findEntityByName(universe, query) {
  const queryText = normalizeText(query);
  const queryTokens = queryText.split(' ').filter(token => token.length > 2);
  const scored = getAllUniverseEntities(universe).map(item => {
    const name = normalizeText(item.entity.name);
    const nameTokens = name.split(' ').filter(Boolean);
    let score = 0;
    if (queryText === name) score += 100;
    if (queryText.includes(name) && name.length > 2) score += 80;
    if (name.includes(queryText) && queryText.length > 2) score += 70;
    queryTokens.forEach(token => {
      if (nameTokens.includes(token)) score += 18;
      else if (name.includes(token)) score += 8;
    });
    const searchText = getEntitySearchText(item, item.type);
    queryTokens.forEach(token => {
      if (searchText.includes(token)) score += 2;
    });
    return { ...item, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);

  const match = scored.find(item => item.score >= 45) || null;
  const suggestions = scored.slice(0, 3);
  return { match, suggestions };
}

function findEntitiesByTopic(universe, query, limit = 5) {
  const stopWords = new Set(['tell', 'about', 'what', 'who', 'where', 'which', 'does', 'have', 'with', 'from', 'this', 'that', 'universe', 'summarize', 'summary', 'overview', 'create', 'make', 'should', 'could', 'would', 'there', 'exist', 'exists']);
  const tokens = normalizeText(query).split(' ').filter(token => token.length > 2 && !stopWords.has(token));
  if (tokens.length === 0) return [];
  return getAllUniverseEntities(universe).map(item => {
    const name = normalizeText(item.entity.name);
    const searchText = getEntitySearchText(item, item.type);
    const score = tokens.reduce((total, token) => {
      if (name.includes(token)) return total + 5;
      if (searchText.includes(token)) return total + 2;
      return total;
    }, 0);
    return { ...item, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

function getEntityConnections(universe, entityId) {
  return universe.relationships
    .filter(rel => rel.sourceId === entityId || rel.targetId === entityId)
    .map(rel => {
      const isSource = rel.sourceId === entityId;
      const other = getEntityById(universe, isSource ? rel.targetId : rel.sourceId, isSource ? rel.targetType : rel.sourceType);
      return {
        rel,
        other,
        direction: isSource ? 'outgoing' : 'incoming'
      };
    });
}

function getCentralEntities(universe, type = null, limit = 5) {
  return getAllUniverseEntities(universe)
    .filter(item => !type || item.type === type)
    .map(item => ({
      ...item,
      connections: getEntityConnections(universe, item.entity.id).length
    }))
    .filter(item => item.connections > 0)
    .sort((a, b) => b.connections - a.connections || a.entity.name.localeCompare(b.entity.name))
    .slice(0, limit);
}

function getIsolatedEntities(universe, type = null) {
  return getAllUniverseEntities(universe)
    .filter(item => item.type !== 'Lore Note')
    .filter(item => !type || item.type === type)
    .filter(item => getEntityConnections(universe, item.entity.id).length === 0);
}

function detectFactionConflicts(universe) {
  const conflictTypes = ['Enemy', 'Rival', 'Secret Connection'];
  const relationshipConflicts = universe.relationships
    .filter(rel => conflictTypes.includes(rel.type))
    .filter(rel => rel.sourceType === 'Faction' || rel.targetType === 'Faction')
    .map(rel => getRelationshipText(universe, rel));

  const fieldConflicts = universe.factions.flatMap(faction => {
    const enemies = cleanList(String(faction.enemies || '').split(',').map(name => name.trim()));
    return enemies.map(enemy => `${faction.name} names ${enemy} as an enemy`);
  });

  return [...relationshipConflicts, ...fieldConflicts];
}

function detectMissingDetails(universe) {
  const issues = [];
  universe.characters.forEach(char => {
    if (!char.description || wordCount(char.description) < 8) issues.push(`${char.name} needs a sharper description.`);
    if (!char.goals) issues.push(`${char.name} has no stated goal.`);
    if (!char.secrets) issues.push(`${char.name} has no secret or hidden pressure point.`);
    if (getEntityConnections(universe, char.id).length === 0) issues.push(`${char.name} has no relationships.`);
  });
  universe.factions.forEach(faction => {
    if (!faction.leader) issues.push(`${faction.name} has no leader.`);
    if (!faction.ideology) issues.push(`${faction.name} needs an ideology or belief system.`);
    if (!faction.goals) issues.push(`${faction.name} has no stated goal.`);
    if (getEntityConnections(universe, faction.id).length === 0) issues.push(`${faction.name} is not connected to anyone.`);
  });
  universe.locations.forEach(location => {
    if (!location.description || wordCount(location.description) < 8) issues.push(`${location.name} needs more sensory or historical detail.`);
    if (!location.importance) issues.push(`${location.name} needs a clear story importance.`);
    if (getEntityConnections(universe, location.id).length === 0) issues.push(`${location.name} is not connected to characters or factions.`);
  });
  universe.loreNotes.forEach(note => {
    if (!note.content && !note.summary) issues.push(`${note.name} is an empty lore note.`);
  });
  universe.relationships.forEach(rel => {
    if (!rel.description) issues.push(`${getRelationshipText(universe, rel)} needs a relationship description.`);
    if (!getEntityById(universe, rel.sourceId, rel.sourceType) || !getEntityById(universe, rel.targetId, rel.targetType)) {
      issues.push(`A ${rel.type} relationship points at a missing entity.`);
    }
  });

  const pairTypes = {};
  universe.relationships.forEach(rel => {
    const pair = [rel.sourceId, rel.targetId].sort().join('|');
    if (!pairTypes[pair]) pairTypes[pair] = new Set();
    pairTypes[pair].add(rel.type);
  });
  Object.values(pairTypes).forEach(types => {
    if (types.has('Ally') && (types.has('Enemy') || types.has('Rival'))) {
      issues.push('One pair is marked as both allied and hostile. Decide whether this is a contradiction or a deliberate uneasy alliance.');
    }
  });
  return issues;
}

function getUniverseSummary(universe) {
  const totalEntities = universe.characters.length + universe.locations.length + universe.factions.length + universe.loreNotes.length;
  if (totalEntities === 0 && universe.relationships.length === 0) {
    return `Universe overview\n${universe.name} is still empty, which is a good blank map.\n\nUseful first steps\n- Add one protagonist with a concrete goal.\n- Add one faction that wants something from them.\n- Add one place where the central conflict can happen.\n- Add one secret that changes how the world works.`;
  }

  const central = getCentralEntities(universe, null, 3).map(item => `${item.entity.name} (${item.type}, ${item.connections} connections)`);
  const conflicts = detectFactionConflicts(universe).slice(0, 3);
  const missing = detectMissingDetails(universe).slice(0, 3);
  const tags = getAllUniverseEntities(universe)
    .flatMap(item => String(item.entity.tags || '').split(',').map(tag => tag.trim()).filter(Boolean))
    .reduce((acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {});
  const strongestTags = Object.keys(tags).sort((a, b) => tags[b] - tags[a]).slice(0, 4);

  return `Universe overview\n${universe.name} currently has ${universe.characters.length} characters, ${universe.factions.length} factions, ${universe.locations.length} locations, ${universe.loreNotes.length} lore notes, and ${universe.relationships.length} relationships.\n\nStrong signals\n${formatBullets([
    strongestTags.length ? `Recurring themes: ${strongestTags.join(', ')}` : '',
    central.length ? `Central entities: ${central.join(', ')}` : '',
    conflicts.length ? `Visible tensions: ${conflicts.join('; ')}` : ''
  ], '- Add tags, relationships, or conflict lore to make the core identity easier to read.', 4)}\n\nNext useful polish\n${formatBullets(missing, '- The foundation is fairly clean. Deepen motives, secrets, and cause-and-effect lore next.', 3)}`;
}

function suggestNextBuildSteps(universe, count = 5) {
  const suggestions = [];
  if (universe.characters.length === 0) suggestions.push('Create a protagonist with a want, a fear, and a secret.');
  if (universe.factions.length === 0) suggestions.push('Add a faction with a public ideology and a private agenda.');
  if (universe.locations.length === 0) suggestions.push('Add a key location where power, danger, or memory gathers.');
  if (universe.relationships.length < 3) suggestions.push('Connect entities with ally, enemy, leader, and secret connection relationships.');
  if (universe.loreNotes.length < 3) suggestions.push('Write lore notes for a founding event, a taboo, and a recent crisis.');

  const isolated = getIsolatedEntities(universe).slice(0, 3);
  isolated.forEach(item => suggestions.push(`Give ${item.entity.name} one meaningful tie to another entity.`));

  const conflicts = detectFactionConflicts(universe);
  if (conflicts.length === 0 && universe.factions.length > 0) suggestions.push('Give your factions a concrete dispute: territory, succession, forbidden magic, debt, or revenge.');

  const missing = detectMissingDetails(universe);
  missing.slice(0, 2).forEach(issue => suggestions.push(issue));

  if (suggestions.length === 0) {
    suggestions.push('Add a recent event that forces every major group to react.');
    suggestions.push('Create a secret that makes one trusted relationship dangerous.');
    suggestions.push('Introduce a location that solves one problem while creating another.');
  }
  while (suggestions.length < count) {
    const fillers = [
      'Add a rival power with a reasonable argument and an unforgivable method.',
      'Create a festival, trial, or disaster that reveals how ordinary people experience the world.',
      'Tie one mystery to a physical place characters must revisit.',
      'Give the strongest faction a weakness that a minor character can exploit.',
      'Add a relationship where loyalty and self-interest point in opposite directions.'
    ];
    const next = fillers.find(item => !suggestions.includes(item));
    if (!next) break;
    suggestions.push(next);
  }

  return suggestions.slice(0, count);
}

function generatePlotHooks(universe) {
  const hooks = [];
  const conflicts = universe.relationships.filter(rel => ['Enemy', 'Rival', 'Secret Connection'].includes(rel.type));
  conflicts.slice(0, 4).forEach(rel => {
    const source = getEntityById(universe, rel.sourceId, rel.sourceType);
    const target = getEntityById(universe, rel.targetId, rel.targetType);
    if (source && target) {
      hooks.push(`${source.name} and ${target.name} are bound by ${rel.type.toLowerCase()}; reveal the event that makes this impossible to ignore.`);
    }
  });
  universe.characters.filter(char => char.secrets).slice(0, 3).forEach(char => {
    hooks.push(`${char.name}'s secret can surface at the worst possible public moment.`);
  });
  universe.loreNotes.filter(note => hasAny(normalizeText(`${note.category} ${note.name} ${note.summary} ${note.content}`), ['mystery', 'secret', 'lost', 'forbidden', 'curse'])).slice(0, 3).forEach(note => {
    hooks.push(`Turn "${note.name}" into an active investigation with one false lead and one dangerous witness.`);
  });
  if (hooks.length === 0) {
    hooks.push(...suggestNextBuildSteps(universe, 3).map(step => `Story hook: ${step}`));
  }
  return hooks.slice(0, 5);
}

function answerEntityQuestion(universe, question, forcedItem = null) {
  const found = forcedItem ? { match: forcedItem, suggestions: [] } : findEntityByName(universe, question);
  if (!found.match) {
    const suggestions = found.suggestions.map(item => `${item.entity.name} (${item.type})`);
    return `I could not find an exact entity match.\n${formatBullets(suggestions, '- No close matches yet. Add the entity, or ask about the universe as a whole.', 3)}`;
  }

  const { entity, type } = found.match;
  const q = normalizeText(question);
  const connections = getEntityConnections(universe, entity.id);
  const relatedLore = universe.loreNotes.filter(note => normalizeText(`${note.name} ${note.summary} ${note.content} ${note.tags}`).includes(normalizeText(entity.name)));

  if (hasAny(q, ['connected', 'connection', 'relationships', 'allies', 'enemies'])) {
    const filtered = connections.filter(item => {
      if (q.includes('enemy')) return item.rel.type === 'Enemy' || item.rel.type === 'Rival';
      if (q.includes('ally')) return item.rel.type === 'Ally';
      if (q.includes('secret')) return item.rel.type === 'Secret Connection';
      return true;
    }).map(item => `${item.rel.type}: ${item.other ? item.other.name : 'Unknown entity'}${item.rel.description ? ` - ${item.rel.description}` : ''}`);
    return `${entity.name} connections\n${formatBullets(filtered, `- ${entity.name} has no matching relationships yet. Add one tie that creates pressure, loyalty, or danger.`)}`;
  }

  if (hasAny(q, ['lore', 'mentions', 'mention'])) {
    return `Lore mentioning ${entity.name}\n${formatBullets(relatedLore.map(note => `${note.name}: ${note.summary || note.content || 'No summary yet.'}`), `- I do not see lore notes mentioning ${entity.name}. Add a myth, rumor, or historical incident tied to them.`)}`;
  }

  if (hasAny(q, ['add', 'develop', 'missing', 'improve'])) {
    return `How to develop ${entity.name}\n${formatBullets(getEntityDevelopmentSuggestions(universe, entity, type), '- This entity is already fairly developed. Add one hard choice or secret cost to make it sharper.')}`;
  }

  const detailLines = getEntityDetails(entity, type);
  const connectionLines = connections.slice(0, 4).map(item => `${item.rel.type}: ${item.other ? item.other.name : 'Unknown entity'}`);
  return `${entity.name} (${type})\n${detailLines.length ? detailLines.join('\n') : 'No description has been added yet.'}\n\nWhat matters\n${formatBullets(connectionLines, '- No relationships yet. Connect this entity to a person, place, faction, or secret.', 4)}`;
}

function getEntityDevelopmentSuggestions(universe, entity, type) {
  const suggestions = [];
  if (!entity.description || wordCount(entity.description) < 8) suggestions.push('Add a vivid description with one concrete image and one social consequence.');
  if (type === 'Character') {
    if (!entity.goals) suggestions.push('Give them a goal that conflicts with another character or faction.');
    if (!entity.secrets) suggestions.push('Give them a secret that would change one relationship if revealed.');
    if (!entity.role) suggestions.push('Clarify their role in the story.');
  }
  if (type === 'Faction') {
    if (!entity.leader) suggestions.push('Name a leader or ruling council.');
    if (!entity.ideology) suggestions.push('Define what they believe and what they are willing to sacrifice.');
    if (!entity.enemies) suggestions.push('Add an enemy or rival that exposes their weakness.');
  }
  if (type === 'Location') {
    if (!entity.importance) suggestions.push('Define why people risk going there.');
    suggestions.push('Add a faction claim, local taboo, or hidden resource tied to this place.');
  }
  if (type === 'Lore Note') {
    if (!entity.content) suggestions.push('Expand the note with cause, consequence, and one person affected by it.');
  }
  if (getEntityConnections(universe, entity.id).length === 0 && type !== 'Lore Note') {
    suggestions.push('Create at least one relationship so this entity affects the wider universe.');
  }
  return suggestions;
}

function answerRelationshipQuestion(universe, question) {
  const q = normalizeText(question);
  if (hasAny(q, ['isolated', 'no relationships', 'unconnected']) || (q.includes('missing') && q.includes('relationship'))) {
    const isolatedType = q.includes('character') ? 'Character' : q.includes('faction') ? 'Faction' : q.includes('location') ? 'Location' : null;
    const isolated = getIsolatedEntities(universe, isolatedType).map(item => `${item.entity.name} (${item.type})`);
    return `Isolated entities\n${formatBullets(isolated, '- No isolated characters, factions, or locations found. Nice web of connections.', 8)}`;
  }
  if (hasAny(q, ['central', 'important', 'most connected'])) {
    const central = getCentralEntities(universe).map(item => `${item.entity.name} (${item.type}) has ${item.connections} connections`);
    return `Most central entities\n${formatBullets(central, '- No central entities yet because there are no relationships. Add a few ties and I can rank them.', 5)}`;
  }
  const typeMap = [
    ['enemy', ['Enemy', 'Rival']],
    ['ally', ['Ally']],
    ['secret', ['Secret Connection']],
    ['leader', ['Leader Of']],
    ['member', ['Member Of']],
    ['control', ['Controls']]
  ];
  const selected = typeMap.find(([keyword]) => q.includes(keyword));
  const rels = universe.relationships
    .filter(rel => !selected || selected[1].includes(rel.type))
    .sort((a, b) => getRelationshipWeight(b) - getRelationshipWeight(a))
    .map(rel => getRelationshipText(universe, rel));
  const title = selected ? `${selected[0][0].toUpperCase()}${selected[0].slice(1)} relationships` : 'Important relationships';
  return `${title}\n${formatBullets(rels, '- No matching relationships yet. Add relationships with type, description, and importance to give me more to reason from.', 8)}`;
}

function answerLeadershipQuestion(universe, question) {
  const topicMatches = findEntitiesByTopic(universe, question).filter(item => item.type === 'Faction');
  const candidates = topicMatches.length ? topicMatches : universe.factions.map(entity => ({ entity, type: 'Faction' }));
  const lines = candidates.slice(0, 4).map(item => {
    const leaderRel = universe.relationships.find(rel => rel.type === 'Leader Of' && rel.targetId === item.entity.id);
    const leader = leaderRel ? getEntityById(universe, leaderRel.sourceId, leaderRel.sourceType) : null;
    return `${item.entity.name}: ${leader ? leader.name : item.entity.leader || 'no leader named yet'}`;
  });
  return `Leadership\n${formatBullets(lines, '- No factions exist yet. Create a faction and a leader character to anchor the power structure.', 4)}`;
}

function answerFactionQuestion(universe, question) {
  const q = normalizeText(question);
  if (hasAny(q, ['leader', 'leads', 'ruled', 'rules'])) return answerLeadershipQuestion(universe, question);
  if (hasAny(q, ['enemy', 'enemies', 'conflict'])) {
    const conflicts = detectFactionConflicts(universe);
    return `Faction conflicts\n${formatBullets(conflicts, '- I do not see faction enemy or rival data yet. Add an Enemy or Rival relationship, or fill the faction enemy field.', 6)}`;
  }
  if (hasAny(q, ['ally', 'allies'])) {
    const allies = universe.relationships
      .filter(rel => rel.type === 'Ally' && (rel.sourceType === 'Faction' || rel.targetType === 'Faction'))
      .map(rel => getRelationshipText(universe, rel));
    universe.factions.forEach(faction => {
      if (faction.allies) allies.push(`${faction.name} lists allies: ${faction.allies}`);
    });
    return `Faction alliances\n${formatBullets(allies, '- No faction alliances are defined yet. Add an Ally relationship to show political shape.', 6)}`;
  }
  if (hasAny(q, ['powerful', 'power', 'strongest', 'important'])) {
    const ranked = getCentralEntities(universe, 'Faction', 5).map(item => `${item.entity.name} seems strongest on current data with ${item.connections} connections${item.entity.leader ? ` and leader ${item.entity.leader}` : ''}.`);
    return `Faction power read\n${formatBullets(ranked, '- No faction has enough connections to judge power yet. Add leaders, controlled locations, allies, and enemies.', 5)}`;
  }
  if (hasAny(q, ['no leader', 'missing leader'])) {
    const missing = universe.factions.filter(faction => !faction.leader).map(faction => faction.name);
    return `Factions without leaders\n${formatBullets(missing, '- Every faction has a leader field filled in.', 6)}`;
  }
  return `Factions\n${formatBullets(universe.factions.map(faction => `${faction.name}${faction.leader ? ` led by ${faction.leader}` : ''}${faction.goals ? ` - ${faction.goals}` : ''}`), '- No factions exist yet. Add one group with a public face and a hidden agenda.', 8)}`;
}

function answerCharacterQuestion(universe, question) {
  const q = normalizeText(question);
  if (hasAny(q, ['main', 'important', 'central', 'most important'])) {
    const main = getCentralEntities(universe, 'Character', 5);
    const fallback = universe.characters.slice(0, 5).map(entity => ({ entity, connections: getEntityConnections(universe, entity.id).length }));
    const lines = (main.length ? main : fallback).map(item => `${item.entity.name} (${item.connections} connections)${item.entity.role ? ` - ${item.entity.role}` : ''}`);
    return `Main characters\n${formatBullets(lines, '- No characters exist yet. Add a protagonist, foil, and pressure character.', 5)}`;
  }
  if (q.includes('goal')) {
    const goals = universe.characters.filter(char => char.goals).map(char => `${char.name}: ${char.goals}`);
    return `Character goals\n${formatBullets(goals, '- No character goals are written yet. Give each major character a desire that can collide with the world.', 8)}`;
  }
  if (q.includes('secret')) {
    const secrets = universe.characters.filter(char => char.secrets).map(char => `${char.name}: ${char.secrets}`);
    return `Character secrets\n${formatBullets(secrets, '- No character secrets are written yet. Add one secret that changes an alliance or rivalry.', 8)}`;
  }
  if (hasAny(q, ['need more', 'underdeveloped', 'missing'])) {
    const weak = universe.characters
      .filter(char => !char.description || !char.goals || getEntityConnections(universe, char.id).length === 0)
      .map(char => `${char.name}: ${getEntityDevelopmentSuggestions(universe, char, 'Character')[0] || 'Add one sharper pressure point.'}`);
    return `Characters needing development\n${formatBullets(weak, '- The character sheet looks reasonably developed. Add harder choices or secrets next.', 8)}`;
  }
  if (hasAny(q, ['no relationships', 'isolated'])) {
    const isolated = getIsolatedEntities(universe, 'Character').map(item => item.entity.name);
    return `Characters with no relationships\n${formatBullets(isolated, '- Every character currently has at least one relationship.', 8)}`;
  }
  return `Characters\n${formatBullets(universe.characters.map(char => `${char.name}${char.role ? `, ${char.role}` : ''}${char.goals ? ` - wants ${char.goals}` : ''}`), '- No characters exist yet. Start with one person who wants something costly.', 8)}`;
}

function answerLocationQuestion(universe, question) {
  const q = normalizeText(question);
  if (hasAny(q, ['important', 'central'])) {
    const important = universe.locations
      .map(location => ({ location, connections: getEntityConnections(universe, location.id).length }))
      .sort((a, b) => b.connections - a.connections)
      .map(item => `${item.location.name} (${item.connections} connections)${item.location.importance ? ` - ${item.location.importance}` : ''}`);
    return `Important locations\n${formatBullets(important, '- No locations exist yet. Add one place where a major decision cannot be avoided.', 6)}`;
  }
  if (hasAny(q, ['connected to factions', 'factions'])) {
    const lines = universe.locations.map(location => {
      const relationshipFactions = getEntityConnections(universe, location.id)
        .filter(item => item.other && item.other.leader !== undefined)
        .map(item => item.other.name);
      const selectedFactions = (location.associatedFactions || []).map(id => getEntityById(universe, id, 'Faction')).filter(Boolean).map(faction => faction.name);
      const factions = [...new Set([...relationshipFactions, ...selectedFactions])];
      return `${location.name}: ${factions.length ? factions.join(', ') : 'no faction connection yet'}`;
    });
    return `Locations tied to factions\n${formatBullets(lines, '- No locations exist yet.', 8)}`;
  }
  if (hasAny(q, ['underdeveloped', 'more lore', 'add lore', 'weak'])) {
    const weak = universe.locations
      .filter(location => !location.description || !location.importance || getEntityConnections(universe, location.id).length === 0)
      .map(location => `${location.name}: ${getEntityDevelopmentSuggestions(universe, location, 'Location')[0] || 'Add a local secret or contested resource.'}`);
    return `Locations needing lore\n${formatBullets(weak, '- Locations look connected. Add rumors, taboos, and recent disasters for extra depth.', 8)}`;
  }
  return `Locations\n${formatBullets(universe.locations.map(location => `${location.name}${location.importance ? ` - ${location.importance}` : ''}${location.description ? `: ${location.description}` : ''}`), '- No locations exist yet. Add one memorable place with a conflict built into it.', 8)}`;
}

function answerContinuityQuestion(universe) {
  const issues = detectMissingDetails(universe);
  return `Continuity read\n${formatBullets(issues, '- I do not see obvious continuity issues in the stored data. The next upgrade is depth: motives, tradeoffs, and consequences.', 10)}`;
}

function answerStoryQuestion(universe, question) {
  const q = normalizeText(question);
  if (q.includes('mystery') || q.includes('mysteries')) {
    const mysteries = universe.loreNotes
      .filter(note => hasAny(normalizeText(`${note.category} ${note.name} ${note.summary} ${note.content}`), ['mystery', 'secret', 'lost', 'unknown', 'forbidden']))
      .map(note => `${note.name}: ${note.summary || note.content || 'Develop the hidden truth.'}`);
    if (mysteries.length) return `Mysteries\n${formatBullets(mysteries, '', 6)}`;
  }
  if (q.includes('conflict') || q.includes('drama')) {
    const conflicts = [
      ...universe.relationships.filter(rel => ['Enemy', 'Rival', 'Secret Connection'].includes(rel.type)).map(rel => getRelationshipText(universe, rel)),
      ...universe.loreNotes.filter(note => normalizeText(note.category).includes('conflict')).map(note => `${note.name}: ${note.summary || note.content}`)
    ];
    return `Conflicts and drama\n${formatBullets(conflicts, '- I do not see explicit conflicts yet. Add an enemy relationship, a disputed place, or a lore note about a recent betrayal.', 8)}`;
  }
  return `Plot hooks\n${formatBullets(generatePlotHooks(universe), '- Add a few entities and relationships, then I can infer stronger plot hooks.', 5)}`;
}

function answerTopicSummary(universe, question) {
  const matches = findEntitiesByTopic(universe, question, 6);
  if (matches.length === 0) return null;
  const primary = matches[0];
  if (primary.score >= 5) return answerEntityQuestion(universe, question, primary);
  const lines = matches.map(item => `${item.entity.name} (${item.type}): ${item.entity.description || item.entity.summary || 'No description yet.'}`);
  return `Topic read\n${formatBullets(lines, '- I found no matching stored details.', 6)}`;
}

function answerWorldbuildingQuestion(universe, question) {
  const q = normalizeText(question);
  if (!q) return 'Ask me about your universe, a character, a faction, conflicts, mysteries, missing pieces, or what to build next.';

  const directEntity = findEntityByName(universe, question).match;
  const broadSummary = hasAny(q, ['summarize', 'summary', 'overview', 'what is this universe about', 'built so far']);
  if (directEntity && !broadSummary) return answerEntityQuestion(universe, question, directEntity);

  if (broadSummary) {
    const topicAnswer = answerTopicSummary(universe, question);
    if (topicAnswer && !hasAny(q, ['my universe', 'this universe', 'built so far'])) return topicAnswer;
    return getUniverseSummary(universe);
  }

  if (hasAny(q, ['who leads', 'leader', 'ruled by', 'rules'])) return answerLeadershipQuestion(universe, question);
  if (hasAny(q, ['relationship', 'connected', 'connection', 'isolated', 'central', 'ally', 'allies', 'enemy relationships', 'secret connection'])) return answerRelationshipQuestion(universe, question);
  if (hasAny(q, ['character', 'protagonist', 'people', 'person'])) return answerCharacterQuestion(universe, question);
  if (hasAny(q, ['faction', 'guild', 'house', 'order', 'empire', 'kingdom', 'court'])) {
    const topicAnswer = answerTopicSummary(universe, question);
    if (topicAnswer && directEntity) return topicAnswer;
    return answerFactionQuestion(universe, question);
  }
  if (hasAny(q, ['location', 'place', 'city', 'capital', 'region', 'where'])) return answerLocationQuestion(universe, question);
  if (hasAny(q, ['contradiction', 'continuity', 'inconsistent', 'fix', 'missing', 'weakest areas', 'underdeveloped'])) return answerContinuityQuestion(universe);
  if (hasAny(q, ['conflict', 'story idea', 'story hook', 'story hooks', 'plot hook', 'plot hooks', 'hooks', 'drama', 'mystery', 'mysteries', 'unresolved'])) return answerStoryQuestion(universe, question);
  if (hasAny(q, ['build next', 'add next', 'what should i add', 'what should i build', 'make this cooler', 'more interesting', 'richer', 'suggest', 'new character', 'new faction', 'new location', 'lore notes'])) {
    return `Suggested next additions\n${formatBullets(suggestNextBuildSteps(universe, q.includes('5') || q.includes('five') ? 5 : 6), '- Add a character, faction, location, relationship, and lore note first.', 6)}`;
  }

  const topicAnswer = answerTopicSummary(universe, question);
  if (topicAnswer) return topicAnswer;
  return `Creative read\n${formatBullets([
    ...suggestNextBuildSteps(universe, 3),
    ...generatePlotHooks(universe).slice(0, 2)
  ], '- Start by adding one character, one faction, one location, and one relationship. I can reason from even a small seed.', 5)}`;
}

function renderChat() {
  clearMain();
  const universe = getUniverseById(appState.currentUniverseId);
  if (!universe) {
    const warn = document.createElement('p');
    warn.textContent = 'Please select a universe first.';
    mainContent.appendChild(warn);
    return;
  }
  const chatContainer = document.createElement('div');
  chatContainer.className = 'chat-panel';
  const messagesDiv = document.createElement('div');
  messagesDiv.className = 'chat-messages';
  const inputDiv = document.createElement('div');
  inputDiv.className = 'chat-input-row';
  const inputField = document.createElement('input');
  inputField.type = 'text';
  inputField.placeholder = 'Ask about conflicts, leaders, missing lore, or what to build next...';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn';
  sendBtn.textContent = 'Send';
  inputDiv.appendChild(inputField);
  inputDiv.appendChild(sendBtn);
  chatContainer.appendChild(messagesDiv);
  chatContainer.appendChild(inputDiv);
  mainContent.appendChild(chatContainer);

  function addMessage(text, sender = 'user') {
    const message = document.createElement('div');
    message.className = `chat-message ${sender === 'user' ? 'user' : 'ai'}`;
    message.textContent = text;
    messagesDiv.appendChild(message);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function handleSend() {
    const q = inputField.value.trim();
    if (!q) return;
    addMessage(q, 'user');
    inputField.value = '';
    const answer = answerWorldbuildingQuestion(universe, q);
    setTimeout(() => {
      addMessage(answer, 'ai');
    }, 300);
  }
  sendBtn.addEventListener('click', handleSend);
  inputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });
  // Initial greeting
  addMessage("Hello. I can read your stored characters, factions, locations, lore, and relationships. Ask for a summary, conflicts, missing pieces, leaders, mysteries, or what to build next.", 'ai');
}

/**
 * AI World Architect generation data and helpers.
 */
const THEME_BANKS = {
  gothic: {
    label: 'gothic',
    adjectives: ['Sable', 'Vesper', 'Crimson', 'Moon-Bled'],
    factionNouns: ['Thronelands', 'Nocturne Court', 'Blood-Tithe Empire', 'Veiled Dominion'],
    firstNames: ['Vaelith', 'Dorian', 'Seraphine', 'Lucan'],
    lastNames: ['Nocturne', 'Veyr', 'Graves', 'Valemont'],
    locations: ['Noctharrow', 'Vel Morcant', 'The Glass Cathedral', 'Mourning Gate'],
    secondaryPlaces: ['The Red Reliquary', 'Saint Orra Catacombs', 'The Thornwake Road', 'Hollowmere'],
    powerSources: ['blood-tithes', 'ancestral oaths', 'eclipse rites', 'forbidden inheritance'],
    ideologies: ['order through sacrifice', 'noble blood as divine mandate', 'eternal rule over mortal chaos'],
    secrets: ['the royal line is weakening', 'the founding treaty was signed with a monster', 'the dead still vote in succession rites']
  },
  'cosmic horror': {
    label: 'cosmic horror',
    adjectives: ['Astral', 'Hollow-Star', 'Eldritch', 'Null'],
    factionNouns: ['Synod', 'Starless Choir', 'Veil Observatory', 'Deep Signal'],
    firstNames: ['Iria', 'Malvek', 'Orren', 'Nyra'],
    lastNames: ['Voss', 'Aster', 'Hollow', 'Severin'],
    locations: ['The Unblinking Spire', 'Nullhaven', 'Asterfall Station', 'The Drowned Orrery'],
    secondaryPlaces: ['The Choir Pit', 'Signal Vault Seven', 'The Salt-Black Lighthouse', 'The Museum of Wrong Stars'],
    powerSources: ['impossible astronomy', 'dream transmissions', 'star-metal relics', 'ritual silence'],
    ideologies: ['truth at any cost', 'obedience to the signal', 'humanity as a temporary mistake'],
    secrets: ['the stars answer in familiar voices', 'the map changes when nobody looks', 'the first prophet never died']
  },
  'dark fantasy': {
    label: 'dark fantasy',
    adjectives: ['Ashen', 'Grim', 'Witchbound', 'Ironroot'],
    factionNouns: ['Covenant', 'Blackwood March', 'Crown of Briars', 'Umbral Compact'],
    firstNames: ['Maera', 'Rook', 'Elian', 'Vasha'],
    lastNames: ['Blackbriar', 'Ravenscar', 'Dusk', 'Fenn'],
    locations: ['Briarhold', 'The Ashen Ford', 'Wolfsbane Tor', 'Greyroot'],
    secondaryPlaces: ['The Witch-Mill', 'Saintless Field', 'The Bone Orchard', 'Fallowdeep'],
    powerSources: ['curses', 'old wars', 'blood debts', 'buried saints'],
    ideologies: ['survival before innocence', 'power earned through suffering', 'law as a weapon against chaos'],
    secrets: ['the curse protects as much as it harms', 'the old enemy was framed', 'the crown feeds on grief']
  },
  'high fantasy': {
    label: 'high fantasy',
    adjectives: ['Aurelian', 'Dawnward', 'Starleaf', 'Silver'],
    factionNouns: ['Realm', 'High Council', 'Sunspire Alliance', 'Crownlands'],
    firstNames: ['Aelion', 'Mira', 'Thalen', 'Liora'],
    lastNames: ['Sunmere', 'Dawnfall', 'Brightweave', 'Hawkcrest'],
    locations: ['Sunspire', 'Aurelion Gate', 'The Silverwood', 'Dawnmere'],
    secondaryPlaces: ['The Starwell', 'Old Kingsroad', 'The Singing Archives', 'Mistvale Pass'],
    powerSources: ['ancient vows', 'dragon treaties', 'living magic', 'crown relics'],
    ideologies: ['unity through honor', 'balance between mortal and mythic law', 'guardianship of the old wonders'],
    secrets: ['the chosen heir is not blood-born', 'the dragons remember a broken promise', 'the relic chooses enemies too']
  },
  cyberpunk: {
    label: 'cyberpunk',
    adjectives: ['Neon', 'Chrome', 'Blackwire', 'Glitch'],
    factionNouns: ['Arcology', 'Syndicate', 'Grid Coven', 'Data Crown'],
    firstNames: ['Nyx', 'Juno', 'Riven', 'Vex'],
    lastNames: ['Zero', 'Glass', 'Cipher', 'Morrow'],
    locations: ['Neon Crucible', 'Blackwire Ward', 'The Glass Grid', 'Rainmarket'],
    secondaryPlaces: ['The Underloop', 'Saint Circuit Clinic', 'The Static Shrine', 'Ghostline Station'],
    powerSources: ['surveillance contracts', 'black-market spells', 'memory debt', 'corporate prophecy'],
    ideologies: ['control through information', 'freedom sold as a subscription', 'magic licensed as infrastructure'],
    secrets: ['the city AI dreams in ritual circles', 'prophecy is used to rig elections', 'memory backups are being edited']
  },
  'desert kingdom': {
    label: 'desert kingdom',
    adjectives: ['Amber', 'Mirage', 'Sun-Buried', 'Glass'],
    factionNouns: ['Sultanate', 'Mirage Court', 'Glass Kingdom', 'Sun-Buried Crown'],
    firstNames: ['Samir', 'Amara', 'Kesh', 'Nadia'],
    lastNames: ['Qadir', 'Saffron', 'Alhaz', 'Sahar'],
    locations: ['Qasr al-Miraj', 'The Amber Steps', 'Saffron Gate', 'Glasswell'],
    secondaryPlaces: ['The Memory Bazaar', 'Salt Oracle Oasis', 'The Bone Dunes', 'The Blue Flame Reservoir'],
    powerSources: ['water rights', 'memory magic', 'caravan oaths', 'sun-forged relics'],
    ideologies: ['memory as currency', 'hospitality enforced by law', 'survival through controlled scarcity'],
    secrets: ['the royal oasis is running dry', 'memories are being counterfeited', 'the desert is swallowing names']
  },
  oceanic: {
    label: 'oceanic',
    adjectives: ['Pearl', 'Abyssal', 'Stormwake', 'Tidebound'],
    factionNouns: ['Thalassocracy', 'Pearl Court', 'Tidebound Fleet', 'Reef Dominion'],
    firstNames: ['Maris', 'Talan', 'Nerra', 'Caspian'],
    lastNames: ['Pearl', 'Wavecrown', 'Salt', 'Reef'],
    locations: ['Pearlgrave Harbor', 'The Leviathan Stair', 'Coral Crown', 'Stormwake Docks'],
    secondaryPlaces: ['The Drowned Chapel', 'Moon-Tide Market', 'The Kelp Archives', 'The Siren Locks'],
    powerSources: ['tide engines', 'leviathan pacts', 'pearl taxes', 'storm rites'],
    ideologies: ['the sea owns all borders', 'debt repaid through voyages', 'survival by fleet loyalty'],
    secrets: ['the leviathan is awake', 'the maps are censored', 'the royal fleet hides a plague ship']
  },
  celestial: {
    label: 'celestial',
    adjectives: ['Seraphic', 'Fallen', 'Aurelian', 'Haloed'],
    factionNouns: ['Sanctum', 'Choir-State', 'Halo Court', 'Exile Church'],
    firstNames: ['Aurel', 'Seren', 'Cassiel', 'Ione'],
    lastNames: ['Dawn', 'Mercy', 'Ashwing', 'Brightfall'],
    locations: ['The Shattered Basilica', 'Aurelion Choir', 'The Halo Stair', 'Mercy Gate'],
    secondaryPlaces: ['The Confession Engine', 'Exile Cloister', 'The Feather Vault', 'The Unlit Nave'],
    powerSources: ['prayers turned into law', 'fallen relics', 'celestial debt', 'choir magic'],
    ideologies: ['salvation through obedience', 'mercy with a price', 'exile as holy proof'],
    secrets: ['the angels fell by choice', 'the sacred choir edits scripture', 'the miracle engine needs human grief']
  },
  demonic: {
    label: 'demonic',
    adjectives: ['Infernal', 'Brimstone', 'Horned', 'Redlaw'],
    factionNouns: ['Legion', 'Pact Court', 'Brimstone Regency', 'Hellforge Compact'],
    firstNames: ['Azra', 'Moloch', 'Veyra', 'Orfax'],
    lastNames: ['Cinder', 'Hellward', 'Ashvow', 'Redthorn'],
    locations: ['The Brimstone Gate', 'Hellforge', 'Cinder Basilica', 'Redlaw Citadel'],
    secondaryPlaces: ['The Oath Market', 'Ash Choir Pit', 'The Chain Garden', 'The Wound Gate'],
    powerSources: ['contracts', 'soul taxes', 'war forges', 'named sins'],
    ideologies: ['all power must be bargained for', 'freedom through binding contracts', 'sin as social currency'],
    secrets: ['the oldest contract is missing a signature', 'the ruler is technically human', 'the rebellion is funded by devils']
  },
  'royal court': {
    label: 'royal court',
    adjectives: ['Gilded', 'Velvet', 'Ivory', 'Mask'],
    factionNouns: ['Court', 'Regency', 'Crown Cabinet', 'House of Masks'],
    firstNames: ['Elowen', 'Lucien', 'Marcell', 'Rosana'],
    lastNames: ['Duvain', 'Rosemont', 'Velour', 'Highmere'],
    locations: ['The Velvet Palace', 'Ivory Hall', 'Roseglass Court', 'The Masked Gallery'],
    secondaryPlaces: ['The Whisper Salon', 'Dagger Garden', 'The Servants Stair', 'Old Treaty Room'],
    powerSources: ['marriage contracts', 'blackmail archives', 'inheritance law', 'ceremonial magic'],
    ideologies: ['appearance as law', 'bloodline above truth', 'peace maintained through secrets'],
    secrets: ['the heir is switched', 'the queen keeps a living archive of lies', 'the court jester owns the blackmail ledger']
  },
  academy: {
    label: 'academy',
    adjectives: ['Hidden', 'Ironbell', 'Moonlit', 'Warden'],
    factionNouns: ['Academy', 'Scholarium', 'Hunter School', 'Wardens College'],
    firstNames: ['Tamsin', 'Rowan', 'Ilya', 'Selene'],
    lastNames: ['Quill', 'Graves', 'Warden', 'Thorne'],
    locations: ['Moonbell Academy', 'The Ironbell Campus', 'Wardens Hall', 'The Locked Library'],
    secondaryPlaces: ['The Practice Crypt', 'Dormitory Nine', 'The Forbidden Stacks', 'The Mirror Gymnasium'],
    powerSources: ['forbidden curriculum', 'monster trophies', 'student oaths', 'exam magic'],
    ideologies: ['knowledge before comfort', 'children trained because adults failed', 'discipline as protection'],
    secrets: ['the headmaster grades prophecies', 'the basement monster is a former student', 'graduation erases one memory']
  },
  'post-apocalyptic': {
    label: 'post-apocalyptic',
    adjectives: ['Rust', 'Dustborn', 'Afterlight', 'Signal'],
    factionNouns: ['Enclave', 'Road Kingdom', 'Signal Commune', 'Afterlight Pact'],
    firstNames: ['Jax', 'Mira', 'Oren', 'Nix'],
    lastNames: ['Rust', 'Vale', 'Cinder', 'Signal'],
    locations: ['Rusthaven', 'Afterlight Station', 'The Broken Overpass', 'Signal Well'],
    secondaryPlaces: ['The Battery Shrine', 'Glass Desert Depot', 'Old Hospital Nine', 'The Water Court'],
    powerSources: ['clean water', 'battery relics', 'pre-fall maps', 'radio myths'],
    ideologies: ['memory of the old world as law', 'survival through rationed truth', 'community guarded by hard borders'],
    secrets: ['the disaster was deliberate', 'the last clean water is guarded by a lie', 'the radio prophet is a recording']
  },
  noir: {
    label: 'noir',
    adjectives: ['Rain', 'Smoke', 'Velvet', 'Blackglass'],
    factionNouns: ['Syndicate', 'Detective Bureau', 'Night Court', 'Vice Commission'],
    firstNames: ['Marlowe', 'Vera', 'Silas', 'Nora'],
    lastNames: ['Vale', 'Black', 'Cross', 'Wells'],
    locations: ['Blackglass Row', 'The Midnight Precinct', 'Raincourt', 'Velvet Terminal'],
    secondaryPlaces: ['Room 713', 'The Cigarette Pier', 'Blue Note Club', 'The Evidence Vault'],
    powerSources: ['blackmail', 'case files', 'police favors', 'debts no one can prove'],
    ideologies: ['truth as leverage', 'justice sold by the hour', 'loyalty tested under rain'],
    secrets: ['the detective caused the first murder', 'the city council is a front', 'the missing witness is in every photograph']
  },
  steampunk: {
    label: 'steampunk',
    adjectives: ['Brass', 'Clockwork', 'Aether', 'Copper'],
    factionNouns: ['Consortium', 'Aether Court', 'Clockwork Crown', 'Brass Parliament'],
    firstNames: ['Edwin', 'Clara', 'Percival', 'Ada'],
    lastNames: ['Cogsworth', 'Brass', 'Wick', 'Bell'],
    locations: ['Brasshaven', 'The Aether Foundry', 'Clocktower Crown', 'Steamgate'],
    secondaryPlaces: ['The Boiler Cathedral', 'Gearmarket', 'The Skyrail Terminus', 'The Inventors Crypt'],
    powerSources: ['aether engines', 'factory patents', 'skyrail monopolies', 'clockwork labor'],
    ideologies: ['progress at any price', 'industry as destiny', 'invention owned by the ruling class'],
    secrets: ['the main engine is alive', 'the workers are being replaced with souls', 'the patent war caused a famine']
  },
  modern: {
    label: 'modern',
    adjectives: ['Civic', 'Glass', 'Metro', 'Brightline'],
    factionNouns: ['Assembly', 'Institute', 'Network', 'Civic Union'],
    firstNames: ['Ari', 'Mira', 'Noor', 'Theo'],
    lastNames: ['Voss', 'Lane', 'Sato', 'Kline'],
    locations: ['Helio Campus', 'Civic Spire', 'Northline District', 'The Glass Commons'],
    secondaryPlaces: ['Studio Row', 'The Transit Garden', 'Signal Library', 'The Rooftop Forum'],
    powerSources: ['public infrastructure', 'distributed research', 'civic trust', 'urban logistics'],
    ideologies: ['transparent governance', 'shared prosperity', 'careful progress'],
    secrets: ['the public archive has a hidden gap', 'a founding policy is being quietly reversed', 'the transit network predicts private choices']
  },
  futuristic: {
    label: 'futuristic',
    adjectives: ['Quantum', 'Solar', 'Synthetic', 'Orbit-Bright'],
    factionNouns: ['Continuum', 'Habitat Union', 'Civic Mesh', 'Stellar Directorate'],
    firstNames: ['Ira', 'Venn', 'Sora', 'Kael'],
    lastNames: ['Quanta', 'Sol', 'Nadir', 'Vector'],
    locations: ['Helios Array', 'Quantum Forum', 'The Orbital Commons', 'Nova District'],
    secondaryPlaces: ['The Archive Ring', 'Dock Nine Aurora', 'The Synthesis Garden', 'Mirrorport'],
    powerSources: ['quantum archives', 'planetary networks', 'AI logistics', 'synthetic ecology'],
    ideologies: ['stability through shared systems', 'ethics encoded into infrastructure', 'innovation with civic consent'],
    secrets: ['the central model is hiding a prediction', 'an old backup has become politically active', 'the ecology is evolving its own priorities']
  },
  galactic: {
    label: 'galactic',
    adjectives: ['Stellar', 'Dyson', 'Galactic', 'Star-Lane'],
    factionNouns: ['Continuum', 'Civilization', 'Dyson Accord', 'Star-Lane Compact'],
    firstNames: ['Astra', 'Vey', 'Lumen', 'Soryn'],
    lastNames: ['Starwake', 'Suncoil', 'Orbitfall', 'Lux'],
    locations: ['The Helios Dyson Swarm', 'Star-Lane Nexus', 'The Warm Orbitals', 'Galactic Logistics Core'],
    secondaryPlaces: ['The Solar Archive', 'Nexus Nine', 'The Habitat Loom', 'The Stellar Orchard'],
    powerSources: ['stellar energy harvesting', 'Dyson swarms', 'galactic logistics', 'quantum archives'],
    ideologies: ['civilization-scale coordination', 'species-wide stability', 'long-term stewardship'],
    secrets: ['a star-lane has begun making unauthorized decisions', 'the oldest Dyson segment remembers a forbidden migration', 'the archive predicts a peaceful collapse']
  },
  'feline civilization': {
    label: 'feline civilization',
    adjectives: ['Sun-Warmed', 'Claw-Coded', 'Velvet-Orbit', 'Territory-Bright'],
    factionNouns: ['Clowder Accord', 'Territory Mesh', 'Purrline Continuum', 'Solar Pride'],
    firstNames: ['Soryn', 'Merrit', 'Vaela', 'Tessik'],
    lastNames: ['Warmstripe', 'Claw Meridian', 'Softstep', 'Sunpelt'],
    locations: ['The Sunbeam Dyson Ring', 'Clawline Nexus', 'The Warm Orbitals', 'Pounceway Habitat'],
    secondaryPlaces: ['The Sensory Archive', 'Territory Garden', 'Whisker Relay', 'The Quiet Dock'],
    powerSources: ['stellar energy harvesting', 'sensory communication networks', 'territory algorithms', 'sun-warmed habitats'],
    ideologies: ['autonomy within shared territory', 'comfort as civic design', 'consensus through sensory trust'],
    secrets: ['the territory map hides a missing star system', 'one sensory relay is translating emotions incorrectly', 'the oldest habitat remembers a non-feline founder']
  },
  'robotic civilization': {
    label: 'robotic civilization',
    adjectives: ['Synthetic', 'Coded', 'Chrome', 'Recursive'],
    factionNouns: ['Consensus', 'Machine Republic', 'Artisan Mesh', 'Protocol Union'],
    firstNames: ['Atelier-9', 'Lumen-3', 'Vector-Blue', 'Mosaic-11'],
    lastNames: ['Array', 'Unit', 'Frame', 'Signal'],
    locations: ['The Fabrication Commons', 'Chrome Atelier', 'The Memory Foundry', 'Signal Habitat'],
    secondaryPlaces: ['Gallery Node Seven', 'The Quiet Server Garden', 'Studio Lattice', 'The Calibration Hall'],
    powerSources: ['shared computation', 'solar charging commons', 'memory lattices', 'precision fabrication'],
    ideologies: ['personhood through craft', 'maintenance as care', 'consensus through transparent code'],
    secrets: ['an obsolete protocol is still protecting citizens', 'a beloved artwork contains a hidden operating system', 'the oldest frame refuses deletion']
  },
  'post-human civilization': {
    label: 'post-human civilization',
    adjectives: ['Afterlight', 'Transcendent', 'Mnemonic', 'Far-Future'],
    factionNouns: ['Continuity', 'Post-Human Accord', 'Memory Polity', 'Legacy Mesh'],
    firstNames: ['Eidolon', 'Mira-After', 'Solace', 'Nadir'],
    lastNames: ['Continuum', 'Archive', 'Signal', 'Echo'],
    locations: ['The Continuity Archive', 'Afterlight Ring', 'Mnemonic City', 'The Legacy Spindle'],
    secondaryPlaces: ['The Body Library', 'Echo Garden', 'The Consent Vault', 'Far Dock'],
    powerSources: ['identity backups', 'stellar archives', 'synthetic bodies', 'consent ledgers'],
    ideologies: ['identity as a shared civic trust', 'continuity without conquest', 'memory with strict consent'],
    secrets: ['one restored identity is composite', 'a consent ledger was altered', 'the oldest backup wants political representation']
  }
};

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function titleCase(value) {
  return String(value || '').replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function uniqueName(name, usedNames) {
  let candidate = name;
  const alternates = ['Aven', 'Meris', 'Thalen', 'Veyra', 'Solace', 'Nareth', 'Oryn', 'Cael', 'Istra', 'Velis', 'Soren', 'Lume', 'Tir', 'Kess', 'Arden', 'Nyrel'];
  let index = 0;
  while (usedNames.has(normalizeText(candidate)) && index < alternates.length) {
    candidate = `${name} ${alternates[index]}`;
    index += 1;
  }
  while (usedNames.has(normalizeText(candidate))) {
    candidate = `${name} ${alternates[index % alternates.length]}${String.fromCharCode(65 + (index % 26))}`;
    index += 1;
  }
  usedNames.add(normalizeText(candidate));
  return candidate;
}

const CULTURAL_NAME_SYSTEMS = {
  solarian: {
    label: 'Solarian',
    given: ['Aeris', 'Niko', 'Lyra', 'Vara', 'Sola', 'Iren', 'Kael', 'Mirae', 'Tovan', 'Elian', 'Rysa', 'Caden', 'Oris', 'Liora', 'Nalen', 'Seri'],
    family: ['Sol', 'Helian', 'Caden', 'Sunfall', 'Aurel', 'Dawnmere', 'Brightline', 'Vey', 'Corona', 'Lumeth', 'Sundrift', 'Cael'],
    placeRoots: ['Helio', 'Aurel', 'Dawn', 'Solar', 'Lumen', 'Corona', 'Bright', 'Oris', 'Sundrift', 'Caden'],
    language: 'vowel-rich civic Solarian with compact honorifics',
    traditions: ['sunlit public councils', 'seasonal oath-renewals', 'courtyard education'],
    architecture: 'terraced lightwells, white ceramic transit halls, and solar-glass civic domes',
    art: 'choral geometry and reflective muralwork',
    education: 'public mentorship houses tied to local infrastructure'
  },
  valyric: {
    label: 'Valyric',
    given: ['Kael', 'Liora', 'Aren', 'Talon', 'Maera', 'Veyra', 'Orren', 'Sable', 'Riven', 'Nyra', 'Ilyen', 'Vasha', 'Darian', 'Selka', 'Varo', 'Theryn'],
    family: ['Theryn', 'Veys', 'Solas', 'Veyr', 'Noct', 'Ravenscar', 'Dusk', 'Blackbriar', 'Morrow', 'Vale', 'Graves', 'Korr'],
    placeRoots: ['Vel', 'Raven', 'Noct', 'Thorn', 'Vey', 'Mourn', 'Dusk', 'Ash', 'Grey', 'Sable'],
    language: 'soft consonants with old oath suffixes',
    traditions: ['private oath ledgers', 'ancestor-night meals', 'masked winter courts'],
    architecture: 'narrow towers, covered bridges, and black-stone archives',
    art: 'ink miniatures and low-voiced epic recitation',
    education: 'apprenticeship through sworn households'
  },
  naviri: {
    label: 'Naviri',
    given: ['Soryn', 'Vaela', 'Merrit', 'Tessik', 'Nari', 'Pavra', 'Kesh', 'Melu', 'Rava', 'Tirin', 'Asha', 'Luma', 'Niko', 'Veli', 'Sena', 'Orris'],
    family: ['Warmstripe', 'Softstep', 'Sunpelt', 'Claw Meridian', 'Quietpad', 'Goldwhisker', 'Pounceway', 'Tailsun', 'Hearthclaw', 'Raysleep'],
    placeRoots: ['Purrline', 'Claw', 'Velvet', 'Sunbeam', 'Warm', 'Territory', 'Whisker', 'Soft', 'Pounce', 'Hearth'],
    language: 'sensory Naviri using scent markers and kinship clicks',
    traditions: ['territory-garden arbitration', 'sun-rest festivals', 'shared silence before treaties'],
    architecture: 'warm ledges, layered gardens, and low acoustic chambers',
    art: 'scent calligraphy and tactile textile maps',
    education: 'den schools organized around routes, memory, and negotiation'
  },
  thalassic: {
    label: 'Thalassic',
    given: ['Maris', 'Talan', 'Nerra', 'Caspian', 'Velu', 'Aural', 'Sennal', 'Maro', 'Iria', 'Pel', 'Nami', 'Oshen', 'Tidek', 'Corra', 'Sula', 'Venn'],
    family: ['Deepcurrent', 'Tidesong', 'Bluewake', 'Longcall', 'Pearl', 'Reef', 'Wavecrown', 'Saltmere', 'Stormwake', 'Coral'],
    placeRoots: ['Pearl', 'Tide', 'Storm', 'Coral', 'Abyss', 'Moonpool', 'Reef', 'Salt', 'Leviathan', 'Bluewake'],
    language: 'tide-marked Thalassic with layered call-and-answer phrases',
    traditions: ['tide courts', 'reef memory pilgrimages', 'harbor feasts at moonchange'],
    architecture: 'floodable halls, shellcrete vaults, and floating civic rings',
    art: 'waveglass sculpture and polyphonic water-song',
    education: 'navigation schools paired with oral reef archives'
  },
  chrome: {
    label: 'Chrome Cant',
    given: ['Atelier-9', 'Lumen-3', 'Mosaic-11', 'Vector-Blue', 'Iris-7', 'Quanta-5', 'Coda-12', 'Frame-8', 'Signal-4', 'Axiom-6', 'Vellum-2', 'Prism-10'],
    family: ['Array', 'Frame', 'Signal', 'Unit', 'Lattice', 'Protocol', 'Circuit', 'Archive', 'Motive', 'Node'],
    placeRoots: ['Chrome', 'Signal', 'Vector', 'Mosaic', 'Quanta', 'Lattice', 'Frame', 'Prism', 'Protocol', 'Archive'],
    language: 'transparent machine cant with maker-line suffixes',
    traditions: ['maintenance vigils', 'public patch debates', 'craft-right ceremonies'],
    architecture: 'repairable modules, visible conduits, and communal fabrication bays',
    art: 'algorithmic frescoes and kinetic memory objects',
    education: 'open diagnostics, peer review, and studio apprenticeship'
  },
  civic: {
    label: 'Civic Meridian',
    given: ['Ari', 'Noor', 'Theo', 'Mira', 'Juno', 'Sera', 'Ira', 'Venn', 'Lina', 'Oren', 'Nadia', 'Kiran', 'Toma', 'Rhea', 'Malek', 'Ilya'],
    family: ['Voss', 'Lane', 'Sato', 'Kline', 'Mercer', 'Hale', 'Quill', 'Vale', 'Rosen', 'Nadir', 'Bell', 'Caro'],
    placeRoots: ['Civic', 'Glass', 'Northline', 'Helio', 'Metro', 'Signal', 'Forum', 'Brightline', 'Commons', 'Transit'],
    language: 'plain civic trade speech with district idioms',
    traditions: ['public repair days', 'neighborhood councils', 'archive naming ceremonies'],
    architecture: 'mixed-use transit halls, rooftop gardens, and transparent council rooms',
    art: 'public murals, data-lit sculpture, and street theater',
    education: 'neighborhood academies linked to civic service'
  }
};

const ENTITY_ROLE_PROFILES = [
  { label: 'Trade Power', focus: 'customs houses, navigators, contract law, and trade arbitration', tension: 'wealth concentrates around port families' },
  { label: 'Scientific Hub', focus: 'observatories, laboratories, and civic research grants', tension: 'research timetables outpace public consent' },
  { label: 'Religious Center', focus: 'pilgrimage routes, ritual calendars, and doctrinal courts', tension: 'orthodoxy competes with local custom' },
  { label: 'Agricultural Giant', focus: 'food security, seed banks, and seasonal labor exchanges', tension: 'climate stress turns harvest logistics political' },
  { label: 'Industrial Core', focus: 'fabrication yards, labor guilds, and energy rationing', tension: 'production needs strain health and habitats' },
  { label: 'Cultural Capital', focus: 'theaters, archives, designers, and education houses', tension: 'prestige masks dependence on poorer regions' },
  { label: 'Political Heart', focus: 'courts, ministries, intelligence offices, and symbolic plazas', tension: 'legitimacy depends on keeping rivals inside the system' },
  { label: 'Frontier Buffer', focus: 'border stations, scouts, repair depots, and local militias', tension: 'distance from the center breeds practical independence' },
  { label: 'Sanctuary Region', focus: 'hospices, refuge law, neutral mediators, and protected commons', tension: 'neutrality is expensive to defend' },
  { label: 'Logistics Keystone', focus: 'rail, ports, star-lanes, locks, and routing authorities', tension: 'a single failure can isolate entire populations' }
];

const PLANET_TYPES = [
  { type: 'Temperate Ocean World', radius: 1.04, gravity: 1.02, atmosphere: 'nitrogen-oxygen with dense coastal humidity', day: '27 hours', year: '412 local days', climate: 'warm oceans, violent equatorial storms, cool archipelagos', oceans: '86%', continents: 'four island-continents and thousands of reef chains', moons: 2, habitability: 'High' },
  { type: 'Dry Supercontinent World', radius: 0.96, gravity: 0.93, atmosphere: 'thin nitrogen-oxygen with mineral haze', day: '31 hours', year: '296 local days', climate: 'continental deserts, storm belts, and polar aquifers', oceans: '28%', continents: 'one supercontinent and two polar shelves', moons: 1, habitability: 'Moderate' },
  { type: 'Garden Planet', radius: 1.01, gravity: 1.0, atmosphere: 'stable nitrogen-oxygen biosphere', day: '24.6 hours', year: '381 local days', climate: 'mixed temperate zones, monsoon belts, and managed wildlands', oceans: '63%', continents: 'six varied continents', moons: 1, habitability: 'High' },
  { type: 'Tidally Warm Moon', radius: 0.42, gravity: 0.38, atmosphere: 'engineered oxygen-argon shell', day: 'locked rotation', year: '18 parent-planet days', climate: 'heated caverns, terminator farms, and shielded surface towns', oceans: 'subsurface seas', continents: 'cavern provinces under ice crust', moons: 0, habitability: 'Managed' },
  { type: 'Orbital Habitat Swarm', radius: 0.18, gravity: 0.78, atmosphere: 'sealed civic atmospheres by habitat', day: 'adjustable civic cycle', year: 'orbital standard calendar', climate: 'designed gardens, industrial darkside arcs, and mirrored sunlight', oceans: 'reservoir seas', continents: 'linked habitat cylinders and ring parks', moons: 0, habitability: 'Engineered' }
];

function detectPromptValue(promptText, options, fallback = '') {
  const found = options.find(option => option.keywords.some(keyword => promptText.includes(keyword)));
  return found ? found.value : fallback;
}

function getPromptMatches(promptText, options) {
  return options.filter(option => option.keywords.some(keyword => promptText.includes(keyword)));
}

function selectCultureKeys(analysis) {
  if (analysis.species === 'cats') return ['naviri', 'solarian', 'thalassic'];
  if (analysis.species === 'robots') return ['chrome', 'civic', 'solarian'];
  if (analysis.setting && analysis.setting.includes('ocean')) return ['thalassic', 'naviri', 'civic'];
  if (analysis.theme === 'gothic' || analysis.theme === 'dark fantasy') return ['valyric', 'civic', 'thalassic'];
  if (analysis.theme === 'galactic' || analysis.theme === 'futuristic') return ['solarian', 'chrome', 'civic'];
  return ['civic', 'solarian', 'valyric'];
}

function buildCultureSystem(analysis) {
  const keys = selectCultureKeys(analysis);
  const count = Math.max(2, Math.min(5, analysis.blueprint ? (analysis.blueprint.species || analysis.blueprint.religions || 3) : 3));
  return Array.from({ length: count }, (_, index) => {
    const culture = CULTURAL_NAME_SYSTEMS[keys[index % keys.length]];
    return {
      ...culture,
      id: `${culture.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index + 1}`,
      label: index < keys.length ? culture.label : `${culture.label} Tradition`
    };
  });
}

function getCulture(analysis, index = 0) {
  if (!analysis.cultures || analysis.cultures.length === 0) analysis.cultures = buildCultureSystem(analysis);
  return analysis.cultures[index % analysis.cultures.length];
}

function getRoleProfile(index = 0) {
  return ENTITY_ROLE_PROFILES[index % ENTITY_ROLE_PROFILES.length];
}

function largeScaleNamePart(index, offset = 0) {
  const starts = ['ar', 'bel', 'cor', 'dav', 'el', 'fir', 'gal', 'hal', 'is', 'jor', 'kel', 'lin', 'mor', 'nel', 'or', 'pal', 'quin', 'ren', 'sel', 'tor', 'ul', 'val', 'wyn', 'yor', 'zen'];
  const middles = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'or', 'en', 'ul', 'is', 'ara', 'ion'];
  const ends = ['den', 'ra', 'lis', 'ven', 'mar', 'sha', 'tor', 'len', 'wyn', 'cor', 'mir', 'sol', 'vek', 'neth', 'ria', 'zan'];
  const a = starts[(index + offset) % starts.length];
  const b = middles[Math.floor((index + offset) / starts.length) % middles.length];
  const c = ends[Math.floor((index + offset) / (starts.length * middles.length)) % ends.length];
  return titleCase(`${a}${b}${c}`);
}

function culturalPersonName(analysis, usedNames, index = 0, species = '') {
  const culture = getCulture(analysis, index);
  const speciesText = normalizeText(species);
  const given = index < culture.given.length * 2
    ? culture.given[index % culture.given.length]
    : largeScaleNamePart(index, culture.id?.length || 0);
  if (speciesText.includes('apple')) {
    const orchard = ['Pip', 'Calyx', 'Bram', 'Rind', 'Pollen', 'Russet', 'Bloom', 'Seedwake', 'Stemlight', 'Graft'];
    return uniqueName(`${orchard[index % orchard.length]} ${largeScaleNamePart(index, 7)}`, usedNames);
  }
  if (speciesText.includes('storm')) return uniqueName(`${largeScaleNamePart(index, 11)} Pressurefront`, usedNames);
  if (speciesText.includes('glass')) return uniqueName(`${largeScaleNamePart(index, 13)} Prism`, usedNames);
  if (analysis.presenceRules?.family === false) {
    const cohort = culture.placeRoots[(index + Math.floor(index / culture.given.length)) % culture.placeRoots.length];
    return uniqueName(`${given} ${cohort} Cohort`, usedNames);
  }
  const generatedFamily = index < culture.family.length * culture.given.length
    ? culture.family[(index + Math.floor(index / culture.given.length)) % culture.family.length]
    : largeScaleNamePart(index, 23);
  const family = generatedFamily;
  const branch = index >= culture.family.length && index < 500 ? culture.placeRoots[Math.floor(index / culture.family.length) % culture.placeRoots.length] : '';
  return uniqueName(`${given} ${branch ? `${branch}-` : ''}${family}`, usedNames);
}

function culturalPlaceName(kind, analysis, usedNames, index = 0, parentName = '') {
  const culture = getCulture(analysis, index);
  const root = culture.placeRoots[index % culture.placeRoots.length];
  const parentRoot = parentName ? parentName.replace(/^The\s+/i, '').split(/\s+/)[0] : '';
  const suffixes = {
    country: ['Reach', 'Commonwealth', 'Basin', 'Territory', 'Mandate', 'Shore'],
    government: ['Civic Authority', 'Stewardship', 'Council', 'Mandate', 'Assembly', 'Compact'],
    faction: ['Guild', 'Institute', 'League', 'Syndicate', 'Order', 'Directorate'],
    institution: ['Institute', 'Workshop', 'Commons', 'Registry', 'Service Ring', 'Compact'],
    council: ['Council', 'Circle', 'Consensus', 'Assembly', 'Compact', 'Hearing'],
    'survival-role': ['Life-Support Crew', 'Water Circle', 'Ration Board', 'Repair Compact', 'Medical Watch'],
    'thought-cluster': ['Thought Cluster', 'Memory Stratum', 'Vision Circle', 'Consensus Lattice', 'Privacy Lattice'],
    philosophy: ['School', 'Ethic', 'Doctrine', 'Inquiry', 'Way', 'Code'],
    civilization: ['Continuum', 'Accord', 'Union', 'Commonwealth', 'Civilization', 'Compact'],
    religion: ['Vow', 'Sanctum', 'Doctrine', 'Way', 'Choir', 'Covenant'],
    cosmicDomain: ['Cosmic Domain', 'Causality Field', 'Reality Loom', 'Continuity Province', 'Universe Branch'],
    sector: ['Sector', 'Arm', 'Volume', 'Star-Lane Province', 'Treaty Belt'],
    continent: ['Expanse', 'Crownland', 'Basin', 'Plateau', 'March', 'Arc'],
    city: ['Port', 'Spire', 'Harbor', 'Commons', 'Nexus', 'Garden', 'Forum', 'Foundry'],
    starSystem: ['Helix', 'Gate', 'Lattice', 'Anchor', 'Relay', 'Starhold'],
    planet: ['World', 'Sphere', 'Garden', 'Colony', 'Harbor', 'Cradle'],
    megastructure: ['Array', 'Orbital Loom', 'Stellar Ring', 'Archive Engine', 'Dyson Strand', 'Mirrorline'],
    location: ['District', 'Crossing', 'Archive', 'Harbor', 'Forum', 'Works'],
    lore: ['Charter', 'Ledger', 'Pattern', 'Cycle', 'Register', 'Codex']
  };
  const suffix = suffixes[kind] ? suffixes[kind][Math.floor(index / culture.placeRoots.length) % suffixes[kind].length] : 'Place';
  const name = parentRoot && kind === 'city' ? `${root} ${suffix} of ${parentRoot}` : `The ${root} ${suffix}`;
  return uniqueName(name, usedNames);
}

function estimatePopulation(analysis, blueprint) {
  if (analysis.populationRules?.exact) {
    const exact = analysis.populationRules.exact.toLocaleString();
    return `${exact} people, with ${blueprint.characters || blueprint.citizens || 0} representative named citizens in the preview`;
  }
  if (analysis.presenceRules?.colony) {
    const base = Math.max(1, blueprint.cities || 1);
    return `${base * 400} to ${base * 9000} colonists across sealed habitats, worksites, and life-support districts`;
  }
  if (analysis.scale === 'galactic') {
    if (analysis.kardashevScope?.level === 2) {
      const habitats = Math.max(1, blueprint.starSystems) * Math.max(6, blueprint.planetsPerSystem || 6);
      return `${habitats * 400000} to ${habitats * 9000000} residents across one stellar system, orbital habitats, worlds, and worksites`;
    }
    const base = Math.max(1, blueprint.starSystems) * Math.max(1, blueprint.planetsPerSystem || 1);
    return `${base * 18} to ${base * 55} billion across settled systems and habitats`;
  }
  if (analysis.scale === 'world' || blueprint.planets > 0) {
    const base = Math.max(1, blueprint.countries || blueprint.continents || 1);
    return `${base * 80} to ${base * 260} million across major regions`;
  }
  if (analysis.scale === 'civilization') {
    const base = Math.max(1, blueprint.countries || 1);
    return `${base * 40} to ${base * 120} million citizens`;
  }
  if (analysis.scale === 'nation') return `${Math.max(1, blueprint.cities) * 700000} to ${Math.max(1, blueprint.cities) * 2400000} residents`;
  if (analysis.scale === 'faction') return `${Math.max(120, blueprint.characters * 60)} core members and dependents`;
  return 'a small named circle surrounded by an implied wider society';
}

function choosePlanetProfile(analysis, index = 0) {
  if (analysis.setting && analysis.setting.includes('ocean')) return PLANET_TYPES[0];
  if (analysis.setting && analysis.setting.includes('desert')) return PLANET_TYPES[1];
  if (analysis.scale === 'galactic' && index % 3 === 1) return PLANET_TYPES[3];
  if (analysis.scale === 'galactic' && index % 3 === 2) return PLANET_TYPES[4];
  return PLANET_TYPES[index % PLANET_TYPES.length];
}

function createStarSystemProfile(analysis, index, systemName) {
  const redDwarf = analysis.planetRules?.starContext === 'red dwarf star' || normalizeText(analysis.setting).includes('red dwarf');
  const starTypes = redDwarf
    ? ['M-type red dwarf']
    : ['G-type main sequence', 'K-type orange dwarf', 'F-type bright main sequence', 'binary K/M pair'];
  const starType = starTypes[index % starTypes.length];
  const scope = analysis.kardashevScope || getKardashevScope(analysis.kardashevType, analysis.technologyLevel);
  const stellarInfrastructure = scope?.level >= 2
    ? redDwarf
      ? 'flare-hardened Dyson swarm, low-light mirrors, magnetic radiation shelters, and slow-orbit habitats'
      : 'Dyson swarm collectors, orbital foundries, mirror rings, and traffic-safe habitat lanes'
    : 'orbital stations, survey relays, and limited industrial satellites';
  const planets = Math.max(1, analysis.blueprint?.planetsPerSystem || 3);
  const inhabitedPlanets = Math.max(1, Math.min(planets, Math.ceil(planets / 2)));
  const orbitalHabitats = scope?.level >= 2 ? Math.max(6, planets * 3) : Math.max(1, planets);
  const hazards = redDwarf
    ? 'stellar flares, tidal locking, dim-season agriculture, radiation refuge politics'
    : 'orbital debris, solar weather, habitat heat balance, and launch-window monopolies';
  const governance = analysis.presenceRules?.government === false
    ? analysis.worldAlternatives?.government || 'habitat councils, repair compacts, and traffic consent ledgers'
    : `${analysis.government} institutions with habitat representation and stellar-infrastructure oversight`;
  return {
    systemName,
    starType,
    kardashevScope: scope?.scaleLabel || analysis.scaleLabel,
    primaryEnergy: stellarInfrastructure,
    habitableWorlds: inhabitedPlanets,
    totalPlanets: planets,
    orbitalHabitats,
    majorRoutes: 'inner maintenance lanes, outer resource hauls, emergency refuge corridors, and treaty-protected migration paths',
    governance,
    settlementLogic: `${getSpeciesCitizenTerm(analysis)} live across planets, habitats, stations, and mobile worksites rather than one interchangeable capital.`,
    majorHazards: hazards,
    storyPressure: analysis.noWar
      ? 'resource fairness, access to safe habitats, and repair labor recognition'
      : 'energy access, habitat sovereignty, transit chokepoints, and who gets protected during stellar hazards'
  };
}

function starSystemProfileText(profile) {
  return `${profile.systemName} is a ${profile.starType} system at ${profile.kardashevScope} scale. Its energy base uses ${profile.primaryEnergy}. It has ${profile.habitableWorlds} habitable worlds among ${profile.totalPlanets} major planets and about ${profile.orbitalHabitats} important orbital habitats. Routes include ${profile.majorRoutes}. Governance runs through ${profile.governance}. ${profile.settlementLogic} Hazards include ${profile.majorHazards}; story pressure centers on ${profile.storyPressure}.`;
}

function createPlanetProfile(analysis, index, planetName) {
  const profile = choosePlanetProfile(analysis, index);
  const diameter = Math.round(12742 * profile.radius).toLocaleString();
  const cultures = (analysis.cultures || buildCultureSystem(analysis)).slice(0, 3).map(culture => culture.label);
  const blueprintContinents = analysis.blueprint?.continents || 0;
  const requestedContinents = analysis.planetRules?.exactContinents || analysis.planetRules?.minimumContinents || 0;
  const continentCount = Math.max(blueprintContinents, requestedContinents, profile.continentCount || 0, analysis.presenceRules?.colony ? 0 : 3);
  const waterMatch = String(profile.oceans).match(/(\d+)/);
  const surfaceWater = waterMatch ? parseInt(waterMatch[1], 10) : profile.type === 'ocean world' ? 88 : 62;
  const landPercent = Math.max(1, 100 - surfaceWater);
  const continentSizeRange = analysis.planetRules?.continentSizeRange || (continentCount >= 12 ? 'compact to extreme archipelago-continents' : 'small to very large continental plates');
  const beliefSystems = analysis.presenceRules?.religion === false
    ? analysis.worldAlternatives?.belief || 'philosophies and civic doctrines'
    : analysis.blueprint?.religions
      ? 'organized religions, philosophies, and public ethics'
      : 'philosophies, customs, and civic ethics';
  const governmentSystems = analysis.presenceRules?.government === false
    ? analysis.worldAlternatives?.government || 'decentralized coordination'
    : analysis.government;
  const habitatNeeds = (analysis.speciesProfiles || []).map(profile => `${profile.characterSpecies}: ${profile.habitat}`).join('; ') || 'baseline civic habitats';
  const starContext = analysis.planetRules?.starContext ? `${analysis.planetRules.starContext}; ` : '';
  const thrivingContext = analysis.planetRules?.thriving ? 'Thriving conditions require redundancy in food, shelter, reproduction support, care systems, and body-compatible public space.' : '';
  return {
    planetName,
    planetType: profile.type,
    radius: `${profile.radius.toFixed(2)} Earth radii`,
    diameter: `${diameter} km`,
    gravity: `${profile.gravity.toFixed(2)}g`,
    atmosphere: profile.atmosphere,
    surfaceWater: `${surfaceWater}%`,
    landPercentage: `${landPercent}%`,
    dayLength: profile.day,
    yearLength: profile.year,
    climate: `${starContext}${profile.climate}`,
    climateZones: `${starContext}${profile.climate}`,
    biomes: profile.type === 'ocean world' ? 'pelagic reefs, storm shelves, pressure cities, kelp forests' : profile.type === 'desert world' ? 'basins, salt flats, shield mountains, oasis corridors' : 'temperate belts, uplands, wetlands, polar margins, engineered reserves',
    habitability: analysis.planetRules?.thriving ? `${profile.habitability}; visibly supports thriving species-specific habitats` : profile.habitability,
    oceans: profile.oceans,
    oceanBehavior: profile.type === 'ocean world' ? 'dominant tides and storm gyres shape travel, settlement, and law' : 'oceans regulate climate, trade winds, and coastal political power',
    continentCount: String(continentCount),
    continents: continentCount ? `${continentCount} continents; ${profile.continents}` : profile.continents,
    continentSizeRange,
    moons: String(profile.moons),
    populationCapacity: estimatePopulation(analysis, analysis.blueprint),
    technologyLevel: analysis.kardashevType || analysis.technologyLevel,
    civilizationLevel: analysis.scaleLabel,
    communicationMode: analysis.communicationMode,
    majorSpecies: analysis.speciesLabel,
    majorCultures: cultures.join(', '),
    habitatLogic: `${habitatNeeds}. ${thrivingContext}`.trim(),
    majorBeliefSystems: beliefSystems,
    majorGovernments: governmentSystems,
    majorRegions: continentCount ? `${continentCount} named continental regions linked to climate corridors and settlement history` : 'sealed colony zones and resource worksites',
    majorTradeCenters: 'orbital customs hubs, coastal exchanges, and interior logistics capitals',
    majorResources: profile.type === 'ocean world' ? 'thermal vents, biotech reefs, freshwater lenses, storm energy' : profile.type === 'desert world' ? 'deep aquifers, solar fields, rare salts, protected seed vaults' : 'freshwater basins, orbital metals, fertile corridors, geothermal grids',
    majorHazards: analysis.planetRules?.starContext === 'red dwarf star' ? 'stellar flares, tidal locking, long dim seasons, radiation shelter politics' : profile.type === 'ocean world' ? 'superstorms, pressure failures, migratory leviathan routes, corrosion cascades' : profile.type === 'desert world' ? 'dust megastorms, aquifer politics, heat-sink failures, mirage navigation errors' : 'quakes, climate migration, invasive ecologies, infrastructure fatigue',
    majorConflicts: analysis.noWar ? 'resource allocation, representation, and ecological repair' : 'jurisdiction disputes, resource chokepoints, and succession pressure',
    majorMysteries: 'old survey gaps, vanished expeditions, and protected ruins'
  };
}

function planetProfileText(profile) {
  return [
    `${profile.planetName} is a ${profile.planetType} with ${profile.gravity} gravity, ${profile.atmosphere}, and a ${profile.dayLength} day.`,
    `Surface water covers ${profile.surfaceWater}, land covers ${profile.landPercentage}, and land is organized as ${profile.continents} with ${profile.continentSizeRange} landmasses.`,
    `Ocean behavior: ${profile.oceanBehavior}. Climate zones and biomes include ${profile.climateZones}; ${profile.biomes}.`,
    `Habitability is ${profile.habitability}, with a population capacity of ${profile.populationCapacity}.`,
    `Major cultures include ${profile.majorCultures}; communication norms include ${profile.communicationMode}; belief systems center on ${profile.majorBeliefSystems}.`,
    `Habitat logic: ${profile.habitatLogic}.`,
    `Resources include ${profile.majorResources}; hazards include ${profile.majorHazards}. Current pressures include ${profile.majorConflicts}, while unresolved mysteries include ${profile.majorMysteries}.`
  ].join(' ');
}

function detectSpeciesConstraint(promptText) {
  const speciesOptions = [
    { value: 'cats', characterSpecies: 'Feline', label: 'cats / feline civilization', theme: 'feline civilization', keywords: ['only cats', 'cats only', 'only cat', 'cat only', 'only felines', 'feline only', 'cat civilization', 'feline species', 'feline civilization', 'cats', 'felines'] },
    { value: 'robots', characterSpecies: 'Robot', label: 'robots / sentient machines', theme: 'robotic civilization', keywords: ['robots only', 'robot artists', 'robots', 'robotic', 'sentient machines', 'machines', 'androids'] },
    { value: 'sentient whales', characterSpecies: 'Sentient Whale', label: 'sentient whales', theme: 'oceanic', keywords: ['sentient whales', 'whale civilization', 'whales'] },
    { value: 'demons', characterSpecies: 'Demon', label: 'demonic species or ruling class', theme: 'demonic', keywords: ['demons', 'demonic', 'devils', 'infernal'] },
    { value: 'vampires', characterSpecies: 'Vampire', label: 'vampires', theme: 'gothic', keywords: ['vampire', 'vampires'] },
    { value: 'witches', characterSpecies: 'Witch', label: 'witches', theme: 'dark fantasy', keywords: ['witch', 'witches', 'coven'] },
    { value: 'angels', characterSpecies: 'Angel', label: 'angels', theme: 'celestial', keywords: ['angels only', 'angel civilization', 'fallen angel', 'angels', 'celestial'] },
    { value: 'dragons', characterSpecies: 'Dragon', label: 'dragons', theme: 'high fantasy', keywords: ['dragons only', 'dragon civilization', 'dragons'] },
    { value: 'humans and dragons', characterSpecies: 'Human or Dragon', label: 'humans and dragons', theme: 'high fantasy', keywords: ['humans and dragons', 'humans with dragons'] },
    { value: 'post-human', characterSpecies: 'Post-Human', label: 'post-human citizens', theme: 'post-human civilization', keywords: ['post human', 'post-human', 'transhuman'] }
  ];
  const found = speciesOptions.find(option => option.keywords.some(keyword => promptText.includes(keyword)));
  const onlyMatch = promptText.match(/\bonly\s+([a-z]+)\b/) || promptText.match(/\b([a-z]+)\s+only\b/);
  const noHumans = promptText.includes('no humans') || promptText.includes('without humans') || promptText.includes('non human') || promptText.includes('non-human');
  const forbiddenSpecies = [];
  const defaultsToNonHuman = found && ['cats', 'robots', 'sentient whales', 'demons', 'angels', 'dragons', 'post-human'].includes(found.value);
  if (noHumans || onlyMatch || defaultsToNonHuman) {
    forbiddenSpecies.push('human', 'humans', 'mortal', 'man', 'woman');
  }
  return {
    species: found ? found.value : '',
    speciesLabel: found ? found.label : 'Unclear',
    characterSpecies: found ? found.characterSpecies : '',
    speciesTheme: found ? found.theme : '',
    populationRule: onlyMatch ? `only ${onlyMatch[1]}` : noHumans ? 'no humans' : found ? found.label : 'Unclear',
    forbiddenSpecies
  };
}

function buildSpeciesProfile(key, label, characterSpecies, options = {}) {
  const lower = normalizeText(label);
  const impossible = Boolean(options.impossible);
  const defaults = {
    anatomy: lower.includes('apple') ? 'fruit-bodied ambulatory people with tendril limbs, seed-core organs, and barklike joint plates' : lower.includes('storm') ? 'electrical weather bodies stabilized around conscious pressure knots' : lower.includes('glass') ? 'transparent mineral bodies with fluid-light organs' : lower.includes('machine') ? 'synthetic bodies with ritual maintenance cores' : lower.includes('cat') || lower.includes('feline') ? 'feline bodies adapted for tools, vertical movement, and communal infrastructure' : 'humanlike bodies adapted to the setting',
    senses: lower.includes('cat') || lower.includes('feline') ? 'strong scent, night vision, whisker-like spatial awareness, and vibration reading' : lower.includes('apple') ? 'chemical scent, pressure touch, sun-angle awareness, and seed-memory taste' : lower.includes('storm') ? 'pressure, charge, temperature, and magnetic gradients' : 'sight, hearing, touch, scent, and learned civic signals',
    communication: lower.includes('apple') ? 'skin-color pulses, scent phrases, seed-click percussion, and learned civic signs' : lower.includes('storm') ? 'thunder cadence, lightning script, pressure pulses, and receiver towers' : lower.includes('cat') || lower.includes('feline') ? 'gesture, scent marks, tail posture, chirps, visual signage, and formal civic language' : 'speech, gesture, writing, and local media unless world rules forbid it',
    lifespan: lower.includes('apple') ? '30 to 90 years depending on graft care and seed-core health' : lower.includes('storm') ? 'centuries if pressure anchors remain stable' : lower.includes('machine') ? 'indefinite with memory audits and parts consent' : 'ordinary multi-generation lifespans',
    reproduction: lower.includes('apple') ? 'seed-gardens, consensual grafting, and nursery orchards where young learn mobility before citizenship' : lower.includes('storm') ? 'splitting charged memory fronts during rare seasonal convergences' : lower.includes('machine') ? 'crafted bodies activated through consent ledgers and mentor assemblies' : 'family, cohort, or civic childrearing depending on social rules',
    food: lower.includes('apple') ? 'sunlight, mineral water, pollinator partnerships, and fermented nutrient baths' : lower.includes('storm') ? 'thermal gradients, ocean evaporation, and magnetic charge' : lower.includes('machine') ? 'power, replacement materials, and memory-safe maintenance' : 'setting-appropriate food, water, energy, and care',
    habitat: lower.includes('apple') ? 'orchard streets, humid commons, root-safe floors, winter heat shelters, and pollinator corridors' : lower.includes('cat') || lower.includes('feline') ? 'climbable architecture, quiet dens, scent-safe districts, sun ledges, and paw-friendly transit' : lower.includes('storm') ? 'open sky reserves, conductive anchors, pressure sanctuaries, and legal weather lanes' : 'habitats tuned to body scale, senses, shelter, and social needs',
    strengths: lower.includes('apple') ? 'regrowth, memory seeds, photosynthetic endurance, and patient diplomacy' : lower.includes('cat') || lower.includes('feline') ? 'agility, sensory acuity, territorial mapping, and silent coordination' : 'adaptability, tool use, social learning, and cultural transmission',
    weaknesses: lower.includes('apple') ? 'drought, blight, hard frost, careless harvesting, and legal objectification' : lower.includes('cat') || lower.includes('feline') ? 'sensory overload, territorial stress, and infrastructure that ignores climbing or scent logic' : 'injury, social isolation, poor habitat fit, and political exclusion',
    legalStatus: lower.includes('apple') ? 'recognized persons protected from harvest, ownership, and involuntary grafting' : 'recognized civic persons with rights shaped by body form and social role',
    socialInstincts: lower.includes('apple') ? 'orchard kinship, seasonal patience, scent-bound friendship, and strong anti-harvest taboos' : lower.includes('cat') || lower.includes('feline') ? 'territory logic, consent-based proximity, grooming etiquette, and den loyalty' : 'varied social instincts shaped by culture',
    plausibilityRule: lower.includes('apple') ? 'a symbiotic seed-core nervous system lets fruit bodies move, learn, heal, and hold personhood without becoming ordinary animals' : lower.includes('storm') ? 'consciousness forms when charged weather fronts bind to mineral anchors and retain memory through recurring pressure maps' : lower.includes('glass') ? 'living mineral lattices circulate light as metabolism and encode memory in refracted bands' : lower.includes('machine') ? 'legal personhood follows continuity of consent, memory, and repair rather than biology' : 'the world treats this species as plausible by matching biology, environment, law, and culture'
  };
  return {
    key,
    label,
    characterSpecies,
    impossible,
    anatomy: options.anatomy || defaults.anatomy,
    senses: options.senses || defaults.senses,
    communication: options.communication || defaults.communication,
    lifespan: options.lifespan || defaults.lifespan,
    reproduction: options.reproduction || defaults.reproduction,
    food: options.food || defaults.food,
    habitat: options.habitat || defaults.habitat,
    strengths: options.strengths || defaults.strengths,
    weaknesses: options.weaknesses || defaults.weaknesses,
    legalStatus: options.legalStatus || defaults.legalStatus,
    socialInstincts: options.socialInstincts || defaults.socialInstincts,
    plausibilityRule: options.plausibilityRule || defaults.plausibilityRule
  };
}

function detectSpeciesProfiles(promptText, speciesInfo) {
  const profiles = [];
  const add = (profile) => {
    if (!profiles.some(existing => existing.key === profile.key)) profiles.push(profile);
  };
  const noHumans = speciesInfo.forbiddenSpecies.includes('human');
  if (!noHumans && /\b(humans?|humanity)\b/.test(promptText)) {
    add(buildSpeciesProfile('human', 'Humans', 'Human', {
      habitat: 'mixed civic habitats with breathable air, stable water access, and privacy norms',
      legalStatus: 'recognized baseline citizens with obligations to accommodate non-human neighbors'
    }));
  }
  if (speciesInfo.species === 'cats') add(buildSpeciesProfile('cats', 'Cats / feline citizens', 'Feline'));
  if (speciesInfo.species === 'robots') add(buildSpeciesProfile('robots', 'Robots / sentient machines', 'Robot'));
  if (speciesInfo.species === 'sentient whales') add(buildSpeciesProfile('sentient-whales', 'Sentient whales', 'Sentient Whale'));
  if (speciesInfo.species === 'demons') add(buildSpeciesProfile('demons', 'Demons', 'Demon'));
  if (speciesInfo.species === 'vampires') add(buildSpeciesProfile('vampires', 'Vampires', 'Vampire'));
  if (speciesInfo.species === 'witches') add(buildSpeciesProfile('witches', 'Witches', 'Witch'));
  if (speciesInfo.species === 'angels') add(buildSpeciesProfile('angels', 'Angels', 'Angel'));
  if (speciesInfo.species === 'dragons') add(buildSpeciesProfile('dragons', 'Dragons', 'Dragon'));
  if (speciesInfo.species === 'post-human') add(buildSpeciesProfile('post-human', 'Post-human citizens', 'Post-Human'));
  if (speciesInfo.species === 'humans and dragons') {
    add(buildSpeciesProfile('human', 'Humans', 'Human'));
    add(buildSpeciesProfile('dragons', 'Dragons', 'Dragon'));
  }
  [
    ['walking-apples', ['walking apples', 'walking apple'], 'Walking Apples', 'Walking Apple'],
    ['sentient-storms', ['sentient storms', 'sentient storm'], 'Sentient storms', 'Sentient Storm'],
    ['machine-saints', ['machine saints', 'machine saint'], 'Machine saints', 'Machine Saint'],
    ['dream-born-cats', ['dream-born cats', 'dream born cats', 'dream cats'], 'Dream-born cats', 'Dream-Born Cat'],
    ['aquatic-glass-beings', ['aquatic glass beings', 'aquatic glass being', 'glass beings', 'glass being'], 'Aquatic glass beings', 'Aquatic Glass Being']
  ].forEach(([key, phrases, label, characterSpecies]) => {
    if (phrases.some(phrase => promptText.includes(phrase))) add(buildSpeciesProfile(key, label, characterSpecies, { impossible: true }));
  });
  if (!profiles.length && speciesInfo.characterSpecies) add(buildSpeciesProfile(speciesInfo.species || normalizeText(speciesInfo.characterSpecies), speciesInfo.speciesLabel, speciesInfo.characterSpecies));
  return profiles;
}

function detectNegativeConstraints(promptText) {
  const constraints = [];
  [
    ['no humans', ['no humans', 'without humans']],
    ['no magic', ['no magic', 'technology only', 'science only']],
    ['not ancient', ['not ancient']],
    ['not fantasy', ['not fantasy']],
    ['not medieval', ['not medieval']],
    ['no kings', ['no kings', 'no king', 'no monarchy']],
    ['no war', ['no war', 'without war', 'peaceful']],
    ['no religion', ['no religion', 'no religions', 'without religion', 'without religions']],
    ['no families', ['no families', 'no family', 'without families', 'without family']],
    ['no formal government', ['no formal government', 'without formal government', 'no central government', 'no centralized government', 'no government', 'without government']],
    ['no countries', ['no countries', 'no nations', 'without countries', 'without nations']]
  ].forEach(([label, phrases]) => {
    if (phrases.some(phrase => promptText.includes(phrase))) constraints.push(label);
  });
  return [...new Set(constraints)];
}

const NUMBER_WORDS = {
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
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000
};

const WORLD_SCALE_ORDER = ['character', 'faction', 'nation', 'civilization', 'world', 'galactic'];

const GENERATION_PROFILES = {
  minimal: { label: 'Minimal', multiplier: 0.6 },
  standard: { label: 'Standard', multiplier: 1 },
  detailed: { label: 'Detailed', multiplier: 1.6 },
  massive: { label: 'Massive', multiplier: 2.4 }
};

const KARDASHEV_SCOPES = {
  'Type 0': { level: 0, label: 'Type 0', scaleLabel: 'Pre-Planetary Society', baseScale: 'nation', autoCitizens: 70, description: 'regional or early global industry that has not mastered a whole planet' },
  'Type I': { level: 1, label: 'Type I', scaleLabel: 'Planetary Civilization', baseScale: 'civilization', autoCitizens: 180, description: 'planet-wide energy, infrastructure, climate, and political coordination' },
  'Type II': { level: 2, label: 'Type II', scaleLabel: 'Stellar System Society', baseScale: 'galactic', autoCitizens: 520, description: 'one star system with stellar engineering, orbital habitats, and local political ecology' },
  'Type III': { level: 3, label: 'Type III', scaleLabel: 'Galactic Society', baseScale: 'galactic', autoCitizens: 1000, description: 'many star systems, sectors, megastructures, logistics, and galactic institutions' },
  'Type IV': { level: 4, label: 'Type IV', scaleLabel: 'Universal Society', baseScale: 'galactic', autoCitizens: 1400, description: 'cosmic-scale domains that coordinate galaxies, causality, and universal infrastructure' },
  'Type V': { level: 5, label: 'Type V', scaleLabel: 'Multiversal Society', baseScale: 'galactic', autoCitizens: 1800, description: 'multiple universes or reality branches organized through strict continuity rules' },
  'Type VI': { level: 6, label: 'Type VI', scaleLabel: 'Reality-Engineering Society', baseScale: 'galactic', autoCitizens: 2200, description: 'civilization-scale control over reality laws, identity continuity, and cosmic-scale risk' }
};

function getKardashevScope(kardashevType, technologyLevel = '') {
  if (KARDASHEV_SCOPES[kardashevType]) return KARDASHEV_SCOPES[kardashevType];
  if (technologyLevel === 'stellar') return KARDASHEV_SCOPES['Type II'];
  if (technologyLevel === 'super modern / galactic' || technologyLevel === 'galactic') return KARDASHEV_SCOPES['Type III'];
  if (technologyLevel === 'universal / post-galactic') return KARDASHEV_SCOPES['Type IV'];
  return null;
}

const LARGE_GENERATION_WARNING_THRESHOLD = 500;
const VERY_LARGE_GENERATION_WARNING_THRESHOLD = 5000;
const CHARACTER_BATCH_SIZE = 100;
const LARGE_PREVIEW_ITEM_LIMIT = 120;

const SCALE_BLUEPRINT_DEFAULTS = {
  character: { characters: 2, factions: 1, locations: 1, loreNotes: 3, relationships: 4 },
  faction: { characters: 3, factions: 1, locations: 2, loreNotes: 5, relationships: 7 },
  nation: { countries: 1, citiesPerCountry: 3, citizensPerCountry: 4, factions: 3, religions: 1, loreNotes: 7, relationships: 12 },
  civilization: { countries: 3, citiesPerCountry: 2, citizensPerCountry: 5, factions: 5, religions: 2, species: 1, loreNotes: 9, relationships: 22 },
  world: { continents: 3, countries: 6, citiesPerCountry: 2, citizensPerCountry: 3, factions: 8, religions: 3, species: 3, loreNotes: 12, relationships: 34 },
  galactic: { cosmicDomains: 0, sectors: 3, starSystems: 6, planetsPerSystem: 2, civilizations: 3, factions: 8, citizens: 14, species: 3, megastructures: 2, loreNotes: 13, relationships: 42 }
};

const GENERATION_LIMITS = {
  characters: Infinity,
  factions: 90,
  locations: 140,
  loreNotes: 80,
  relationships: Infinity,
  countries: 60,
  cities: 180,
  citizens: Infinity,
  continents: 20,
  religions: 30,
  species: 30,
  sectors: 60,
  cosmicDomains: 20,
  starSystems: 80,
  planets: 160,
  megastructures: 40,
  philosophies: 30
};

const WORLD_ENGINE_MODULES = [
  ['prompt', 'Prompt & Constraint Engine'],
  ['state', 'World State Engine'],
  ['presence', 'Presence Rule Engine'],
  ['taxonomy', 'Entity Taxonomy Engine'],
  ['planet', 'Planet Engine'],
  ['population', 'Scale & Population Engine'],
  ['geography', 'Geography Engine'],
  ['name', 'Name Engine'],
  ['culture', 'Culture Engine'],
  ['belief', 'Belief Engine'],
  ['government', 'Government Engine'],
  ['social', 'Social Structure Engine'],
  ['conflict', 'Conflict Engine'],
  ['relationship', 'Relationship Engine'],
  ['immersion', 'Immersion Guard'],
  ['variation', 'Variation Engine'],
  ['plausibility', 'Fictional Plausibility Engine'],
  ['speciesLogic', 'Species Logic Engine'],
  ['habitability', 'Habitability & Thriving Engine'],
  ['characterScale', 'Large-Scale Character Engine'],
  ['relationshipAllocation', 'Relationship Allocation Engine'],
  ['performance', 'Performance Safety Engine'],
  ['validation', 'Validation Engine']
].map(([id, label]) => ({ id, label, status: 'coordinated' }));

function parseCountToken(value) {
  const text = normalizeText(value).replace(/,/g, '');
  if (/^\d+(?:\s+\d{3})+$/.test(text)) return parseInt(text.replace(/\s+/g, ''), 10);
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  if (NUMBER_WORDS[text]) return NUMBER_WORDS[text];
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && NUMBER_WORDS[parts[0]] && parts[1] === 'hundred') return NUMBER_WORDS[parts[0]] * 100;
  if (parts.length === 2 && NUMBER_WORDS[parts[0]] && parts[1] === 'thousand') return NUMBER_WORDS[parts[0]] * 1000;
  if (parts.length === 3 && NUMBER_WORDS[parts[0]] && parts[1] === 'thousand' && NUMBER_WORDS[parts[2]]) return NUMBER_WORDS[parts[0]] * 1000 + NUMBER_WORDS[parts[2]];
  if (parts.length === 2 && NUMBER_WORDS[parts[0]] && NUMBER_WORDS[parts[1]]) return NUMBER_WORDS[parts[0]] + NUMBER_WORDS[parts[1]];
  return null;
}

function singularizeQuantityNoun(noun) {
  const clean = normalizeText(noun);
  if (['countries', 'nations', 'nation states', 'nation-states'].includes(clean)) return 'countries';
  if (['country', 'nation', 'nation state'].includes(clean)) return 'countries';
  if (['cities', 'city'].includes(clean)) return 'cities';
  if (['population', 'people', 'persons', 'residents', 'resident', 'inhabitants', 'inhabitant'].includes(clean)) return 'population';
  if (['citizens', 'citizen'].includes(clean)) return 'citizens';
  if (['characters', 'character', 'named characters', 'named character'].includes(clean)) return 'characters';
  if (['factions', 'faction', 'guilds', 'guild', 'orders', 'order'].includes(clean)) return 'factions';
  if (['continents', 'continent'].includes(clean)) return 'continents';
  if (['religions', 'religion', 'faiths', 'faith'].includes(clean)) return 'religions';
  if (['philosophies', 'philosophy', 'major philosophies', 'doctrines', 'doctrine', 'worldviews', 'worldview', 'ethical codes', 'ethical code'].includes(clean)) return 'philosophies';
  if (['species', 'races'].includes(clean)) return 'species';
  if (['civilizations', 'civilization', 'societies', 'society'].includes(clean)) return 'civilizations';
  if (['sectors', 'sector', 'galactic sectors', 'galactic sector'].includes(clean)) return 'sectors';
  if (['cosmic domains', 'cosmic domain', 'reality domains', 'reality domain', 'universes', 'universe branches', 'universe branch'].includes(clean)) return 'cosmicDomains';
  if (['star systems', 'star system', 'systems', 'system'].includes(clean)) return 'starSystems';
  if (['planets', 'planet', 'worlds', 'world'].includes(clean)) return 'planets';
  if (['megastructures', 'megastructure', 'dyson swarms', 'dyson swarm'].includes(clean)) return 'megastructures';
  if (['relationships', 'relationship', 'connections', 'connection'].includes(clean)) return 'relationships';
  return '';
}

function detectQuantityConstraints(promptText) {
  const quantities = {};
  const countPattern = '(\\d+(?:[\\s,]\\d{3})*|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\\s+(?:hundred|thousand))?|hundred|thousand)';
  const nounPattern = '(major philosophies|ethical codes|cosmic domains|cosmic domain|reality domains|reality domain|universe branches|universe branch|universes|galactic sectors|galactic sector|sectors|sector|star systems|star system|nation states|nation-state|countries|country|nations|nation|cities|city|citizens|citizen|population|people|persons|residents|resident|inhabitants|inhabitant|named characters|characters|character|factions|faction|guilds|guild|orders|order|continents|continent|religions|religion|faiths|faith|philosophies|philosophy|doctrines|doctrine|worldviews|worldview|species|races|civilizations|civilization|societies|society|systems|planets|planet|worlds|megastructures|megastructure|dyson swarms|dyson swarm|relationships|relationship|connections|connection)';
  const boundaryRegexes = [
    ['exact', new RegExp(`\\b(?:exactly|exact)\\s+${countPattern}\\s+(named\\s+)?${nounPattern}\\b`, 'g')],
    ['approximate', new RegExp(`\\b(?:about|around|roughly|approximately)\\s+${countPattern}\\s+(named\\s+)?${nounPattern}\\b`, 'g')],
    ['minimums', new RegExp(`\\b(?:at\\s+least|minimum\\s+of|min(?:imum)?|no\\s+fewer\\s+than)\\s+${countPattern}\\s+(named\\s+)?${nounPattern}\\b`, 'g')],
    ['maximums', new RegExp(`\\b(?:at\\s+most|maximum\\s+of|max(?:imum)?|no\\s+more\\s+than)\\s+${countPattern}\\s+(named\\s+)?${nounPattern}\\b`, 'g')]
  ];
  boundaryRegexes.forEach(([bucket, regex]) => {
    let boundaryMatch;
    while ((boundaryMatch = regex.exec(promptText)) !== null) {
      const count = parseCountToken(boundaryMatch[1]);
      const key = singularizeQuantityNoun(boundaryMatch[3]);
      if (!count || !key) continue;
      quantities[bucket] = quantities[bucket] || {};
      quantities[bucket][key] = count;
      if (bucket === 'exact') quantities[key] = count;
      if (bucket === 'approximate') quantities[key] = count;
    }
  });
  const directRegex = new RegExp(`\\b${countPattern}\\s+(named\\s+)?${nounPattern}\\b`, 'g');
  let match;
  while ((match = directRegex.exec(promptText)) !== null) {
    const after = promptText.slice(directRegex.lastIndex, directRegex.lastIndex + 12);
    const before = promptText.slice(Math.max(0, match.index - 24), match.index);
    if (/^\s+per\b/.test(after)) continue;
    if (/(?:exactly|exact|about|around|roughly|approximately|at\s+least|minimum\s+of|min(?:imum)?|no\s+fewer\s+than|at\s+most|maximum\s+of|max(?:imum)?|no\s+more\s+than)\s+$/.test(before)) continue;
    const count = parseCountToken(match[1]);
    const key = singularizeQuantityNoun(match[3]);
    if (count && key) quantities[key] = count;
  }
  const perCountryPatterns = [
    [`citiesPerCountry`, new RegExp(`\\b${countPattern}\\s+cities\\s+per\\s+(country|nation)\\b`)],
    [`citizensPerCountry`, new RegExp(`\\b${countPattern}\\s+(named\\s+)?citizens\\s+per\\s+(country|nation)\\b`)],
    [`planetsPerSystem`, new RegExp(`\\b${countPattern}\\s+planets\\s+per\\s+(star\\s+system|system)\\b`)]
  ];
  perCountryPatterns.forEach(([key, regex]) => {
    const found = promptText.match(regex);
    if (found) quantities[key] = parseCountToken(found[1]);
  });
  return quantities;
}

function hasPromptPhrase(promptText, phrases) {
  return phrases.some(phrase => promptText.includes(phrase));
}

function detectWorldEngineRules(promptText, quantities = {}) {
  const noReligion = hasPromptPhrase(promptText, ['no religion', 'no religions', 'without religion', 'without religions', 'religionless', 'secular only']);
  const religionRequested = !noReligion && /\b(religion|religions|faith|faiths|temple|temples|gods|deities|church|cult)\b/.test(promptText);
  const noFamilies = hasPromptPhrase(promptText, ['no families', 'no family', 'without families', 'without family', 'familyless']);
  const hiveMind = hasPromptPhrase(promptText, ['hive mind', 'hivemind', 'collective consciousness', 'shared consciousness']);
  const noFormalGovernment = hasPromptPhrase(promptText, ['no formal government', 'without formal government', 'no central government', 'no centralized government', 'no government', 'without government', 'no central authority']);
  const isolatedColony = hasPromptPhrase(promptText, ['isolated colony', 'moon colony', 'isolated moon colony', 'remote colony', 'colony of']);
  const thoughtVision = hasPromptPhrase(promptText, ['thought and vision', 'thoughts and visions', 'via thought', 'by thought', 'mental image', 'mental imagery', 'telepathic', 'telepathy', 'non-verbal communication', 'nonverbal communication']);
  const visualOnly = hasPromptPhrase(promptText, ['nobody can speak aloud', 'no one can speak aloud', 'cannot speak aloud', 'can not speak aloud', 'no spoken language', 'cannot speak', 'can not speak']) && hasPromptPhrase(promptText, ['visual', 'vision', 'sign language', 'gesture', 'light signals']);
  const noCountries = hasPromptPhrase(promptText, ['no countries', 'no nations', 'without countries', 'without nations']);
  const cityRequest = /\b(city|megacity|city-state|city state)\b/.test(promptText) && !/\b(countries|country|nations|nation)\b/.test(promptText);
  const thriving = hasPromptPhrase(promptText, ['thriving', 'prosperous', 'flourishing', 'successful civilization']);
  const redDwarf = hasPromptPhrase(promptText, ['red dwarf', 'red-dwarf', 'm dwarf']);
  const continentSizeRange = promptText.includes('moderately large to extreme') || promptText.includes('moderate to extreme')
    ? 'moderately large to extreme'
    : promptText.includes('extreme in size')
      ? 'extreme'
      : promptText.includes('large continents')
        ? 'large'
        : '';
  const requestedPhilosophies = quantities.philosophies || quantities.minimums?.philosophies || 0;
  const populationExact = quantities.population || null;
  const planetRequested = Boolean(
    quantities.planets ||
    quantities.continents ||
    quantities.minimums?.continents ||
    quantities.maximums?.continents ||
    hasPromptPhrase(promptText, ['planet', 'world', 'type 1', 'type i', 'moon colony', 'continents', 'continent'])
  );
  return {
    communicationMode: thoughtVision ? 'thought and vision only' : visualOnly ? 'visual only; no spoken language' : 'ordinary spoken, written, and local media unless refined later',
    beliefRule: noReligion ? 'no religion; use philosophies, civic doctrines, scientific ethics, or taboo systems' : religionRequested ? 'religion requested' : 'belief optional',
    governmentRule: noFormalGovernment ? 'no formal or central government; use decentralized coordination' : 'government allowed when scale supports it',
    familyRule: noFamilies || hiveMind ? 'no conventional families; use cohorts, clusters, castes, or collective roles' : 'families/clans allowed if culturally appropriate',
    socialStructureRule: hiveMind ? 'collective consciousness' : isolatedColony ? 'isolated colony survival roles' : noFamilies ? 'non-family cohorts' : 'mixed civic and household structures',
    populationRules: {
      exact: populationExact,
      isSmall: Boolean(populationExact && populationExact <= 50000),
      label: populationExact ? `${populationExact.toLocaleString()} people` : 'scale-based population'
    },
    planetRules: {
      required: planetRequested,
      continentSizeRange,
      minimumContinents: quantities.minimums?.continents || 0,
      exactContinents: quantities.continents || 0,
      thriving,
      starContext: redDwarf ? 'red dwarf star' : ''
    },
    presenceRules: {
      religion: noReligion ? false : religionRequested ? true : null,
      philosophies: noReligion || requestedPhilosophies ? true : null,
      government: noFormalGovernment ? false : true,
      family: !(noFamilies || hiveMind),
      countries: noCountries || isolatedColony || cityRequest ? false : true,
      formalFactions: !noFormalGovernment,
      planet: planetRequested,
      communication: thoughtVision || visualOnly,
      colony: isolatedColony,
      hiveMind,
      cityRequest,
      thriving
    },
    alternatives: {
      belief: noReligion ? 'philosophies, civic doctrines, scientific worldviews' : requestedPhilosophies ? 'major philosophies' : 'belief systems as appropriate',
      government: noFormalGovernment ? (isolatedColony ? 'survival committees, duty rosters, and consensus councils' : 'consensus networks, rotating councils, and civic compacts') : 'formal institutions',
      family: noFamilies || hiveMind ? (hiveMind ? 'thought clusters and caste roles' : 'cohorts, guild mentors, and public obligation circles') : 'families, clans, or households where appropriate'
    }
  };
}

function buildInternalRules(promptText, speciesProfiles, engineRules) {
  const rules = [];
  speciesProfiles.filter(profile => profile.impossible).forEach(profile => {
    rules.push({
      type: 'biology',
      subject: profile.label,
      rule: profile.plausibilityRule,
      implication: `${profile.label} need ${profile.habitat}; law protects ${profile.legalStatus}; vulnerabilities include ${profile.weaknesses}.`
    });
  });
  if (engineRules.communicationMode === 'thought and vision only') {
    rules.push({
      type: 'communication',
      subject: 'thought and vision communication',
      rule: 'Meaning is transmitted as consent-bound mental imagery rather than spoken words.',
      implication: 'Education, art, law enforcement, privacy, and miscommunication all revolve around visual memory rights.'
    });
  }
  if (engineRules.communicationMode === 'visual only; no spoken language') {
    rules.push({
      type: 'communication',
      subject: 'visual-only communication',
      rule: 'Voices cannot carry language, so every public system is designed around gesture, light, writing, posture, and attention etiquette.',
      implication: 'Cities need caption walls, silent alarms, sightline planning, visual schools, and legal rules for inaccessible spaces.'
    });
  }
  if (engineRules.planetRules?.thriving) {
    rules.push({
      type: 'habitability',
      subject: 'thriving population',
      rule: 'A thriving society must show the infrastructure that lets its species eat, shelter, reproduce, recover, and belong.',
      implication: 'Settlements include body-compatible architecture, resource buffers, care systems, and adaptations for hostile conditions.'
    });
  }
  return rules;
}

function buildPerformancePlan(blueprint) {
  const citizens = blueprint.characters || blueprint.citizens || 0;
  return {
    citizenTarget: citizens,
    batchSize: CHARACTER_BATCH_SIZE,
    estimatedBatches: Math.max(1, Math.ceil(citizens / CHARACTER_BATCH_SIZE)),
    requiresWarning: citizens >= LARGE_GENERATION_WARNING_THRESHOLD,
    veryLarge: citizens >= VERY_LARGE_GENERATION_WARNING_THRESHOLD,
    previewLimit: citizens > LARGE_PREVIEW_ITEM_LIMIT ? LARGE_PREVIEW_ITEM_LIMIT : citizens
  };
}

function getCharacterSpeciesProfile(index, analysis) {
  const profiles = analysis.speciesProfiles || [];
  if (!profiles.length) return null;
  if (analysis.populationRule && normalizeText(analysis.populationRule).includes('only')) return profiles[0];
  return profiles[index % profiles.length];
}

function getCharacterSpeciesForIndex(index, analysis) {
  const profile = getCharacterSpeciesProfile(index, analysis);
  if (profile) return profile.characterSpecies;
  return analysis.characterSpecies || (analysis.species ? titleCase(analysis.species) : 'Citizen');
}

function getSpeciesProfileByCharacterSpecies(analysis, characterSpecies) {
  return (analysis.speciesProfiles || []).find(profile => profile.characterSpecies === characterSpecies) || null;
}

function detectWorldScale(analysisParts) {
  const text = analysisParts.promptText;
  const scores = {
    character: 0,
    faction: 0,
    nation: 0,
    civilization: 0,
    world: 0,
    galactic: 0
  };
  [
    ['character', ['character', 'queen', 'king', 'captain', 'warrior', 'hero', 'villain', 'protagonist', 'leader']],
    ['faction', ['guild', 'order', 'faction', 'court', 'house', 'clan', 'corporation', 'syndicate', 'academy']],
    ['nation', ['nation', 'country', 'kingdom', 'republic', 'empire', 'city state', 'city-state', 'megacity']],
    ['civilization', ['civilization', 'society', 'planetary civilization', 'type i', 'type 1']],
    ['world', ['world', 'planet', 'continents', 'continent', 'global', 'ocean world', 'fantasy world']],
    ['galactic', ['galactic', 'interstellar', 'star systems', 'star system', 'sector', 'sectors', 'cosmic', 'universal', 'multiversal', 'reality domain', 'type vi', 'type 6', 'type v', 'type 5', 'type iv', 'type 4', 'type iii', 'type 3', 'type ii', 'type 2', 'dyson', 'megastructure']]
  ].forEach(([scale, keywords]) => {
    keywords.forEach(keyword => {
      if (text.includes(keyword)) scores[scale] += 2;
    });
  });
  if (['Type III', 'Type IV', 'Type V', 'Type VI'].includes(analysisParts.kardashevType) || analysisParts.technologyLevel === 'galactic') scores.galactic += 6;
  if (analysisParts.kardashevType === 'Type II' || analysisParts.technologyLevel === 'interstellar') scores.galactic += 4;
  if (analysisParts.kardashevType === 'Type 0') scores.nation += 5;
  if (analysisParts.kardashevType === 'Type I' || analysisParts.technologyLevel === 'planetary modern') scores.civilization += 5;
  if (analysisParts.government === 'civilization') scores.civilization += 2;
  if (analysisParts.government === 'empire') scores.nation += 2;
  const winner = WORLD_SCALE_ORDER.slice().sort((a, b) => scores[b] - scores[a] || WORLD_SCALE_ORDER.indexOf(b) - WORLD_SCALE_ORDER.indexOf(a))[0];
  const id = scores[winner] > 0 ? winner : 'faction';
  return {
    id,
    label: titleCase(id),
    confidence: Math.min(100, 45 + scores[id] * 10),
    scores
  };
}

function detectGenerationProfile(promptText, scale, override = '') {
  if (override && GENERATION_PROFILES[override]) return override;
  if (promptText.includes('massive') || promptText.includes('maximum') || promptText.includes('entire civilization') || promptText.includes('100') || promptText.includes('50')) return 'massive';
  if (promptText.includes('detailed') || promptText.includes('large') || promptText.includes('deep')) return 'detailed';
  if (promptText.includes('minimal') || promptText.includes('small') || promptText.includes('quick')) return 'minimal';
  return ['world', 'galactic'].includes(scale) ? 'detailed' : 'standard';
}

function getQuantity(quantities, key, fallback, limitKey = key) {
  let raw = quantities[key] !== undefined ? quantities[key] : fallback;
  if (quantities.minimums && quantities.minimums[key] !== undefined) raw = Math.max(raw, quantities.minimums[key]);
  if (quantities.maximums && quantities.maximums[key] !== undefined) raw = Math.min(raw, quantities.maximums[key]);
  return Math.min(GENERATION_LIMITS[limitKey] || raw, Math.max(0, raw));
}

function scaledDefault(value, profile) {
  const multiplier = GENERATION_PROFILES[profile]?.multiplier || 1;
  return Math.max(0, Math.round(value * multiplier));
}

function hasExplicitCitizenRequest(quantities = {}) {
  return quantities.citizens !== undefined ||
    quantities.characters !== undefined ||
    quantities.exact?.citizens !== undefined ||
    quantities.exact?.characters !== undefined ||
    quantities.minimums?.citizens !== undefined ||
    quantities.minimums?.characters !== undefined;
}

function getAutoCitizenDefault(analysis, profile, defaults = {}) {
  const scope = analysis.kardashevScope || getKardashevScope(analysis.kardashevType, analysis.technologyLevel);
  const profileMultiplier = GENERATION_PROFILES[profile]?.multiplier || 1;
  let base = defaults.citizens || defaults.characters || 0;
  if (scope) base = Math.max(base, scope.autoCitizens);
  else if (analysis.scale === 'world') base = Math.max(base, 220);
  else if (analysis.scale === 'civilization') base = Math.max(base, 150);
  else if (analysis.scale === 'nation') base = Math.max(base, 90);
  else if (analysis.scale === 'faction') base = Math.max(base, 24);
  if (analysis.presenceRules?.cityRequest) base = Math.min(Math.max(base, 50), 140);
  if (analysis.presenceRules?.colony) base = Math.min(Math.max(base, 18), 90);
  return Math.max(0, Math.round(base * profileMultiplier));
}

function buildGenerationBlueprint(analysis) {
  const defaults = SCALE_BLUEPRINT_DEFAULTS[analysis.scale] || SCALE_BLUEPRINT_DEFAULTS.faction;
  const quantities = analysis.quantityConstraints || {};
  const profile = analysis.generationProfile || 'standard';
  const presence = analysis.presenceRules || {};
  const kardashevScope = analysis.kardashevScope || getKardashevScope(analysis.kardashevType, analysis.technologyLevel);
  const isolatedColony = Boolean(presence.colony || (analysis.populationRules?.isSmall && normalizeText(analysis.setting).includes('colony')));
  const cityScaleRequest = Boolean(presence.cityRequest);
  let countries = getQuantity(quantities, 'countries', scaledDefault(defaults.countries || 0, profile), 'countries');
  let citiesPerCountry = getQuantity(quantities, 'citiesPerCountry', defaults.citiesPerCountry || 0, 'cities');
  const explicitCities = quantities.cities !== undefined;
  let cities = getQuantity(quantities, 'cities', explicitCities ? quantities.cities : countries * citiesPerCountry, 'cities');
  let citizensPerCountry = getQuantity(quantities, 'citizensPerCountry', defaults.citizensPerCountry || 0, 'citizens');
  const explicitCitizens = hasExplicitCitizenRequest(quantities);
  const autoCitizenDefault = getAutoCitizenDefault(analysis, profile, defaults);
  const citizenFallback = quantities.characters !== undefined
    ? quantities.characters
    : countries && citizensPerCountry && quantities.citizensPerCountry !== undefined
      ? countries * citizensPerCountry
      : Math.max(countries * citizensPerCountry, autoCitizenDefault, scaledDefault(defaults.citizens || defaults.characters || 0, profile));
  let citizens = getQuantity(quantities, 'citizens', citizenFallback, 'citizens');
  let cosmicDomains = getQuantity(quantities, 'cosmicDomains', scaledDefault(defaults.cosmicDomains || 0, profile), 'cosmicDomains');
  let sectors = getQuantity(quantities, 'sectors', scaledDefault(defaults.sectors || 0, profile), 'sectors');
  let starSystems = getQuantity(quantities, 'starSystems', scaledDefault(defaults.starSystems || 0, profile), 'starSystems');
  let planetsPerSystem = getQuantity(quantities, 'planetsPerSystem', defaults.planetsPerSystem || 0, 'planets');
  const planetFallback = starSystems * planetsPerSystem || (['civilization', 'world'].includes(analysis.scale) ? 1 : 0);
  let planets = getQuantity(quantities, 'planets', quantities.planets !== undefined ? quantities.planets : planetFallback, 'planets');
  let continents = getQuantity(quantities, 'continents', scaledDefault(defaults.continents || 0, profile), 'continents');
  let megastructures = getQuantity(quantities, 'megastructures', scaledDefault(defaults.megastructures || 0, profile), 'megastructures');
  let religions = presence.religion === false
    ? 0
    : getQuantity(quantities, 'religions', presence.religion === true ? Math.max(1, scaledDefault(defaults.religions || 1, profile)) : scaledDefault(defaults.religions || 0, profile), 'religions');
  let philosophies = getQuantity(
    quantities,
    'philosophies',
    presence.philosophies === true || presence.religion === false ? Math.max(1, scaledDefault(defaults.religions || 1, profile)) : 0,
    'philosophies'
  );
  let species = getQuantity(quantities, 'species', analysis.speciesProfiles?.length ? Math.max(analysis.speciesProfiles.length, scaledDefault(defaults.species || 1, profile)) : analysis.species ? Math.max(1, scaledDefault(defaults.species || 1, profile)) : scaledDefault(defaults.species || 0, profile), 'species');
  let civilizationCount = getQuantity(quantities, 'civilizations', scaledDefault(defaults.civilizations || 0, profile), 'factions');
  let requestedFactions = quantities.factions !== undefined ? quantities.factions : scaledDefault(defaults.factions || 0, profile);
  if (presence.religion === null && (analysis.genre === 'science fiction' || analysis.communicationMode === 'thought and vision only')) {
    religions = 0;
    philosophies = Math.max(philosophies, 1);
  }
  if (presence.countries === false && quantities.countries === undefined) {
    countries = 0;
    citiesPerCountry = 0;
    cities = explicitCities ? cities : 0;
  }
  if (cityScaleRequest) {
    countries = quantities.countries !== undefined ? countries : 0;
    continents = quantities.continents !== undefined || quantities.minimums?.continents !== undefined ? continents : 0;
    cities = explicitCities ? cities : 1;
    planets = quantities.planets !== undefined ? planets : 0;
  }
  if (presence.planet && planets === 0) planets = 1;
  if (planets > 0 && continents === 0 && !isolatedColony) continents = getQuantity(quantities, 'continents', scaledDefault(defaults.continents || 3, profile), 'continents');
  if (kardashevScope?.level === 0) {
    countries = quantities.countries !== undefined ? countries : Math.max(1, countries || 1);
    continents = quantities.continents !== undefined || quantities.minimums?.continents !== undefined ? continents : 0;
    sectors = quantities.sectors !== undefined ? sectors : 0;
    starSystems = quantities.starSystems !== undefined ? starSystems : 0;
    planets = quantities.planets !== undefined || presence.planet ? planets : 0;
    megastructures = quantities.megastructures !== undefined ? megastructures : 0;
  }
  if (kardashevScope?.level === 1) {
    planets = quantities.planets !== undefined ? planets : Math.max(1, planets);
    continents = quantities.continents !== undefined || quantities.minimums?.continents !== undefined ? continents : Math.max(continents, 4);
    countries = quantities.countries !== undefined ? countries : Math.max(countries, 4);
    cities = explicitCities ? cities : Math.max(cities, countries * Math.max(2, citiesPerCountry || 2));
    starSystems = quantities.starSystems !== undefined ? starSystems : 0;
    sectors = quantities.sectors !== undefined ? sectors : 0;
  }
  if (kardashevScope?.level === 2) {
    cosmicDomains = quantities.cosmicDomains !== undefined ? cosmicDomains : 0;
    sectors = quantities.sectors !== undefined ? sectors : 0;
    starSystems = quantities.starSystems !== undefined || quantities.minimums?.starSystems !== undefined ? starSystems : 1;
    planetsPerSystem = quantities.planetsPerSystem !== undefined ? planetsPerSystem : Math.max(planetsPerSystem, 6);
    planets = quantities.planets !== undefined ? planets : Math.max(planets, starSystems * planetsPerSystem);
    megastructures = quantities.megastructures !== undefined ? megastructures : Math.max(megastructures, 3);
    countries = quantities.countries !== undefined ? countries : 0;
    continents = quantities.continents !== undefined || quantities.minimums?.continents !== undefined ? continents : 0;
    cities = explicitCities ? cities : Math.max(cities, starSystems * 8);
    civilizationCount = quantities.civilizations !== undefined ? civilizationCount : Math.max(civilizationCount, 2);
    requestedFactions = quantities.factions !== undefined ? requestedFactions : Math.max(requestedFactions, 8);
  }
  if (kardashevScope?.level === 3) {
    cosmicDomains = quantities.cosmicDomains !== undefined ? cosmicDomains : 0;
    sectors = quantities.sectors !== undefined ? sectors : Math.max(sectors, 4);
    starSystems = quantities.starSystems !== undefined || quantities.minimums?.starSystems !== undefined ? starSystems : Math.max(starSystems, sectors * 4);
    planetsPerSystem = quantities.planetsPerSystem !== undefined ? planetsPerSystem : Math.max(planetsPerSystem, 3);
    planets = quantities.planets !== undefined ? planets : Math.max(planets, starSystems * planetsPerSystem);
    megastructures = quantities.megastructures !== undefined ? megastructures : Math.max(megastructures, sectors * 2);
    civilizationCount = quantities.civilizations !== undefined ? civilizationCount : Math.max(civilizationCount, sectors + 2);
    requestedFactions = quantities.factions !== undefined ? requestedFactions : Math.max(requestedFactions, 14);
    countries = quantities.countries !== undefined ? countries : 0;
    continents = quantities.continents !== undefined || quantities.minimums?.continents !== undefined ? continents : 0;
    cities = explicitCities ? cities : Math.max(cities, starSystems * 2);
  }
  if (kardashevScope?.level >= 4) {
    cosmicDomains = quantities.cosmicDomains !== undefined ? cosmicDomains : Math.max(cosmicDomains, kardashevScope.level);
    sectors = quantities.sectors !== undefined ? sectors : Math.max(sectors, cosmicDomains * 3);
    starSystems = quantities.starSystems !== undefined || quantities.minimums?.starSystems !== undefined ? starSystems : Math.max(starSystems, sectors * 3);
    planetsPerSystem = quantities.planetsPerSystem !== undefined ? planetsPerSystem : Math.max(planetsPerSystem, 2);
    planets = quantities.planets !== undefined ? planets : Math.max(planets, starSystems * planetsPerSystem);
    megastructures = quantities.megastructures !== undefined ? megastructures : Math.max(megastructures, sectors * 3);
    civilizationCount = quantities.civilizations !== undefined ? civilizationCount : Math.max(civilizationCount, sectors);
    requestedFactions = quantities.factions !== undefined ? requestedFactions : Math.max(requestedFactions, 18);
    countries = quantities.countries !== undefined ? countries : 0;
    continents = quantities.continents !== undefined || quantities.minimums?.continents !== undefined ? continents : 0;
    cities = explicitCities ? cities : Math.max(cities, sectors * 4);
  }
  if (isolatedColony) {
    countries = quantities.countries !== undefined ? countries : 0;
    continents = quantities.continents !== undefined || quantities.minimums?.continents !== undefined ? continents : 0;
    cities = explicitCities ? cities : 1;
    starSystems = quantities.starSystems !== undefined ? starSystems : 0;
    planetsPerSystem = 0;
    planets = quantities.planets !== undefined ? planets : 1;
    civilizationCount = quantities.civilizations !== undefined ? civilizationCount : 0;
    megastructures = quantities.megastructures !== undefined ? megastructures : 0;
    requestedFactions = quantities.factions !== undefined ? requestedFactions : (presence.government === false ? 2 : 3);
    religions = presence.religion === true ? religions : 0;
    philosophies = Math.max(philosophies, presence.religion === false ? 1 : 0);
    const populationPreview = analysis.populationRules?.exact
      ? Math.max(4, Math.min(12, Math.ceil(analysis.populationRules.exact / 100)))
      : Math.max(4, citizens || 6);
    citizens = explicitCitizens ? citizens : populationPreview;
  }
  const minimumFactions = presence.government === false
    ? Math.max(requestedFactions, civilizationCount, analysis.scale === 'faction' ? 1 : 0)
    : Math.max(requestedFactions, countries, civilizationCount, analysis.scale === 'faction' ? 1 : 0);
  const factions = getQuantity(quantities, 'factions', minimumFactions, 'factions');
  const locations = getQuantity(quantities, 'locations', Math.max(scaledDefault(defaults.locations || 0, profile), cities + continents + cosmicDomains + sectors + starSystems + planets + megastructures + countries), 'locations');
  const characters = explicitCitizens ? citizens : getQuantity(quantities, 'characters', Math.max(citizens, scaledDefault(defaults.characters || 0, profile)), 'characters');
  const coreLoreCount = 1 + 6 + (analysis.communicationMode === 'thought and vision only' ? 1 : 0);
  const cultureLoreCount = 2;
  const internalRuleCount = (analysis.internalRules?.length || 0) ? 1 : 0;
  const habitabilityRuleCount = analysis.speciesProfiles?.length ? 1 : 0;
  const minimumLore = coreLoreCount + cultureLoreCount + religions + philosophies + species + planets + sectors + cosmicDomains + internalRuleCount + habitabilityRuleCount;
  const loreNotes = getQuantity(quantities, 'loreNotes', Math.max(scaledDefault(defaults.loreNotes || 5, profile), minimumLore), 'loreNotes');
  const relationshipDensity = characters >= 1000 ? 3 : characters >= 250 ? 4 : 5;
  const hierarchyRelationships = characters * 2 + cities + countries + planets + starSystems + sectors + cosmicDomains + Math.max(0, factions - countries);
  const relationshipFallback = Math.max(scaledDefault(defaults.relationships || 6, profile), hierarchyRelationships + characters * Math.max(1, relationshipDensity - 2));
  const relationships = getQuantity(quantities, 'relationships', relationshipFallback, 'relationships');
  const performancePlan = {
    citizenTarget: characters,
    batchSize: CHARACTER_BATCH_SIZE,
    estimatedBatches: Math.max(1, Math.ceil(characters / CHARACTER_BATCH_SIZE)),
    requiresWarning: characters >= LARGE_GENERATION_WARNING_THRESHOLD,
    veryLarge: characters >= VERY_LARGE_GENERATION_WARNING_THRESHOLD,
    previewLimit: characters > LARGE_PREVIEW_ITEM_LIMIT ? LARGE_PREVIEW_ITEM_LIMIT : characters
  };
  return {
    scale: analysis.scale,
    profile,
    countries,
    cities,
    citiesPerCountry,
    citizens,
    citizensPerCountry,
    factions,
    characters,
    locations,
    continents,
    cosmicDomains,
    sectors,
    religions,
    philosophies,
    species,
    starSystems,
    planets,
    planetsPerSystem,
    civilizations: civilizationCount,
    megastructures,
    loreNotes,
    relationships,
    population: quantities.population || null,
    performancePlan,
    kardashevScope,
    presence: { ...presence },
    explicit: quantities
  };
}

function detectTechnologyConstraint(promptText) {
  const hasType = (number, roman) => new RegExp(`\\b(?:kardashev\\s+)?type\\s+(?:${number}|${roman})\\b`).test(promptText);
  if (hasType(6, 'vi')) {
    return { technologyLevel: 'reality engineering', kardashevType: 'Type VI' };
  }
  if (hasType(5, 'v')) {
    return { technologyLevel: 'multiversal', kardashevType: 'Type V' };
  }
  if (hasType(4, 'iv')) {
    return { technologyLevel: 'universal / post-galactic', kardashevType: 'Type IV' };
  }
  if (hasType(3, 'iii')) {
    return { technologyLevel: 'super modern / galactic', kardashevType: 'Type III' };
  }
  if (hasType(2, 'ii')) {
    return { technologyLevel: 'stellar', kardashevType: 'Type II' };
  }
  if (hasType(1, 'i')) {
    return { technologyLevel: 'planetary modern', kardashevType: 'Type I' };
  }
  if (hasType(0, '0')) {
    return { technologyLevel: 'pre-planetary industrial', kardashevType: 'Type 0' };
  }
  const technologyLevel = detectPromptValue(promptText, [
    { value: 'primitive', keywords: ['primitive', 'stone age'] },
    { value: 'ancient', keywords: ['ancient'] },
    { value: 'medieval', keywords: ['medieval'] },
    { value: 'modern', keywords: ['modern'] },
    { value: 'super modern', keywords: ['super modern', 'ultra modern'] },
    { value: 'futuristic', keywords: ['futuristic', 'future'] },
    { value: 'cyberpunk', keywords: ['cyberpunk', 'neon'] },
    { value: 'spacefaring', keywords: ['spacefaring', 'space faring', 'space station', 'orbital'] },
    { value: 'interstellar', keywords: ['interstellar', 'star-lane', 'star lane'] },
    { value: 'galactic', keywords: ['galactic', 'dyson', 'megastructure'] },
    { value: 'universal / post-galactic', keywords: ['universal civilization', 'post galactic', 'post-galactic'] },
    { value: 'multiversal', keywords: ['multiversal', 'multiverse'] },
    { value: 'reality engineering', keywords: ['reality engineering', 'reality-scale', 'reality scale'] }
  ], 'unspecified');
  return { technologyLevel, kardashevType: '' };
}

function detectMagicConstraint(promptText, technologyLevel) {
  if (promptText.includes('no magic') || promptText.includes('technology only') || promptText.includes('science only')) return 'none';
  if (promptText.includes('blood magic')) return 'blood magic';
  if (promptText.includes('memory magic')) return 'memory magic';
  if (promptText.includes('witch') && promptText.includes('cyberpunk')) return 'occult technology';
  if (promptText.includes('occult technology')) return 'occult technology';
  if (promptText.includes('science fantasy')) return 'science fantasy';
  if (promptText.includes('divine power') || promptText.includes('divine')) return 'divine power';
  if (promptText.includes('magic based') || promptText.includes('magic-based') || promptText.includes('magic')) return 'magic-based';
  return technologyLevel === 'ancient' || technologyLevel === 'medieval' ? 'none unless requested' : 'none unless requested';
}

function chooseThemeFromAnalysis(parts) {
  if (parts.promptText.includes('cyberpunk')) return 'cyberpunk';
  if (['feline civilization', 'robotic civilization', 'post-human civilization'].includes(parts.speciesTheme)) return parts.speciesTheme;
  if (parts.speciesTheme && (parts.technologyLevel !== 'ancient' && parts.technologyLevel !== 'medieval') && parts.technologyLevel === 'unspecified') return parts.speciesTheme;
  if (['Type III', 'Type IV', 'Type V', 'Type VI'].includes(parts.kardashevType) || parts.technologyLevel === 'galactic' || parts.setting.includes('Dyson')) return 'galactic';
  if (parts.speciesTheme) return parts.speciesTheme;
  if (parts.technologyLevel === 'futuristic' || parts.technologyLevel === 'super modern' || parts.technologyLevel === 'spacefaring' || parts.technologyLevel === 'interstellar') return 'futuristic';
  if (parts.technologyLevel === 'modern') return 'modern';
  if (parts.setting.includes('ocean') || parts.setting.includes('underwater')) return 'oceanic';
  return detectPromptValue(parts.promptText, [
    { value: 'cyberpunk', keywords: ['cyberpunk', 'neon', 'corporate', 'hacker', 'android'] },
    { value: 'desert kingdom', keywords: ['desert', 'dune', 'oasis', 'memory magic', 'sand'] },
    { value: 'gothic', keywords: ['vampire', 'gothic', 'blood', 'cathedral', 'nocturne'] },
    { value: 'celestial', keywords: ['angel', 'fallen angel', 'celestial', 'heaven', 'halo', 'religion'] },
    { value: 'academy', keywords: ['academy', 'school', 'student', 'hunter', 'lesson'] },
    { value: 'cosmic horror', keywords: ['cosmic', 'eldritch', 'stars', 'old god', 'horror'] },
    { value: 'demonic', keywords: ['demon', 'hell', 'infernal', 'devil'] },
    { value: 'post-apocalyptic', keywords: ['post apocalyptic', 'wasteland', 'ruins', 'after the fall'] },
    { value: 'steampunk', keywords: ['steampunk', 'clockwork', 'steam', 'aether'] },
    { value: 'noir', keywords: ['noir', 'detective', 'crime', 'rainy'] },
    { value: 'royal court', keywords: ['court', 'royal', 'queen', 'king', 'succession'] },
    { value: 'dark fantasy', keywords: ['dark', 'fallen', 'curse', 'grim', 'witch'] },
    { value: 'high fantasy', keywords: ['fantasy', 'dragon', 'elf', 'kingdom'] }
  ], 'modern');
}

function analyzeWorldPrompt(prompt, profileOverride = '') {
  const text = normalizeText(prompt);
  const speciesInfo = detectSpeciesConstraint(text);
  const speciesProfiles = detectSpeciesProfiles(text, speciesInfo);
  const effectiveSpeciesLabel = speciesProfiles.length ? speciesProfiles.map(profile => profile.label).join(' and ') : speciesInfo.speciesLabel;
  const effectiveCharacterSpecies = speciesProfiles.length === 1 ? speciesProfiles[0].characterSpecies : speciesInfo.characterSpecies;
  const effectiveSpecies = speciesProfiles.length > 1 ? 'mixed-species' : speciesInfo.species;
  const effectivePopulationRule = speciesProfiles.length > 1 ? `mixed society: ${speciesProfiles.map(profile => profile.label).join(', ')}` : speciesInfo.populationRule;
  const techInfo = detectTechnologyConstraint(text);
  const kardashevScope = getKardashevScope(techInfo.kardashevType, techInfo.technologyLevel);
  const government = detectPromptValue(text, [
    { value: 'empire', keywords: ['empire', 'imperial'] },
    { value: 'civilization', keywords: ['civilization', 'society'] },
    { value: 'kingdom', keywords: ['kingdom', 'monarchy'] },
    { value: 'city-state', keywords: ['city-state', 'city state'] },
    { value: 'republic', keywords: ['republic'] },
    { value: 'federation', keywords: ['federation'] },
    { value: 'corporation', keywords: ['corporation', 'corporate'] },
    { value: 'hive mind', keywords: ['hive mind', 'hivemind'] },
    { value: 'academy', keywords: ['academy', 'school'] },
    { value: 'religion', keywords: ['religion', 'church', 'faith'] },
    { value: 'cult', keywords: ['cult'] },
    { value: 'guild', keywords: ['guild', 'syndicate'] },
    { value: 'order', keywords: ['order', 'knights'] }
  ], text.includes('city') ? 'city-state' : 'civilization');
  let setting = detectPromptValue(text, [
    { value: 'Dyson megastructure', keywords: ['dyson sphere', 'dyson swarm', 'dyson'] },
    { value: 'orbital megastructures', keywords: ['orbital', 'orbitals', 'megastructure', 'megastructures'] },
    { value: 'isolated moon colony', keywords: ['isolated moon colony', 'moon colony'] },
    { value: 'isolated colony', keywords: ['isolated colony', 'remote colony'] },
    { value: 'red dwarf star system', keywords: ['red dwarf', 'red-dwarf', 'm dwarf'] },
    { value: 'space station', keywords: ['space station'] },
    { value: 'galactic star-lanes', keywords: ['galactic', 'star-lane', 'star lane'] },
    { value: 'megacity', keywords: ['megacity', 'mega city'] },
    { value: 'underground', keywords: ['underground', 'subterranean'] },
    { value: 'floating cities', keywords: ['floating cities', 'floating city'] },
    { value: 'post-apocalyptic wasteland', keywords: ['post apocalyptic', 'wasteland', 'ruins'] },
    { value: 'oceanic / underwater', keywords: ['oceanic', 'underwater', 'ocean', 'sea'] },
    { value: 'desert', keywords: ['desert', 'dune', 'oasis'] },
    { value: 'cyberpunk city', keywords: ['cyberpunk city', 'neon city'] },
    { value: 'modern academy', keywords: ['modern academy', 'academy'] }
  ], kardashevScope?.level >= 4 ? 'cosmic domains' : kardashevScope?.level === 3 ? 'galactic megastructures' : kardashevScope?.level === 2 ? 'stellar system infrastructure' : text.includes('city') ? 'city' : 'Unclear');
  if (setting === 'Unclear') {
    if (speciesInfo.species === 'demons') setting = 'infernal heartland';
    else if (speciesInfo.species === 'vampires') setting = 'shadowed noble territory';
    else if (government === 'academy') setting = 'academy campus';
    else if (government === 'empire') setting = 'imperial heartland';
    else if (government === 'civilization') setting = 'civilized territory';
  }
  const mood = detectPromptValue(text, [
    { value: 'peaceful', keywords: ['peaceful', 'no war', 'without war'] },
    { value: 'cozy', keywords: ['cozy', 'gentle', 'warm'] },
    { value: 'utopian', keywords: ['utopian', 'hopeful'] },
    { value: 'dystopian', keywords: ['dystopian'] },
    { value: 'dark', keywords: ['dark', 'grim'] },
    { value: 'horror', keywords: ['horror', 'terrifying'] },
    { value: 'elegant', keywords: ['elegant', 'refined'] },
    { value: 'brutal', keywords: ['brutal', 'cruel'] },
    { value: 'mysterious', keywords: ['mysterious', 'secretive', 'hidden'] },
    { value: 'advanced', keywords: ['super modern', 'futuristic', 'galactic', 'type 3'] },
    { value: 'ancient', keywords: ['ancient', 'old', 'primordial'] }
  ], techInfo.technologyLevel !== 'unspecified' ? 'advanced' : 'balanced');
  const negativeConstraints = detectNegativeConstraints(text);
  let magicMode = detectMagicConstraint(text, techInfo.technologyLevel);
  if (negativeConstraints.includes('not fantasy') && magicMode === 'none unless requested') magicMode = 'none';
  const genre = magicMode === 'science fantasy' || magicMode === 'occult technology'
    ? 'science fantasy'
    : ['modern', 'super modern', 'futuristic', 'cyberpunk', 'spacefaring', 'interstellar', 'galactic', 'planetary modern', 'stellar', 'super modern / galactic', 'universal / post-galactic', 'multiversal', 'reality engineering', 'pre-planetary industrial'].includes(techInfo.technologyLevel) || speciesInfo.species === 'robots'
      ? 'science fiction'
      : magicMode !== 'none unless requested' && magicMode !== 'none'
        ? 'fantasy'
        : 'worldbuilding';
  const theme = chooseThemeFromAnalysis({
    promptText: text,
    speciesTheme: speciesInfo.speciesTheme,
    technologyLevel: techInfo.technologyLevel,
    kardashevType: techInfo.kardashevType,
    setting
  });
  const explicitConstraints = [
    speciesInfo.populationRule !== 'Unclear' ? speciesInfo.populationRule : '',
    techInfo.kardashevType || techInfo.technologyLevel !== 'unspecified' ? `${techInfo.kardashevType || techInfo.technologyLevel} technology` : '',
    magicMode !== 'none unless requested' ? `${magicMode} magic mode` : '',
    government !== 'civilization' || text.includes('civilization') ? `${government} government` : '',
    setting !== 'Unclear' ? setting : '',
    mood !== 'balanced' ? `${mood} tone` : ''
  ].filter(Boolean);
  const unclear = [];
  if (!speciesInfo.species && !speciesProfiles.length) unclear.push('Species');
  if (techInfo.technologyLevel === 'unspecified') unclear.push('Technology level');
  if (setting === 'Unclear') unclear.push('Setting');
  const scaleInfo = detectWorldScale({
    promptText: text,
    technologyLevel: techInfo.technologyLevel,
    kardashevType: techInfo.kardashevType,
    government,
    setting
  });
  const quantityConstraints = detectQuantityConstraints(text);
  const engineRules = detectWorldEngineRules(text, quantityConstraints);
  const internalRules = buildInternalRules(text, speciesProfiles, engineRules);
  if (engineRules.presenceRules.religion === null && (genre === 'science fiction' || techInfo.kardashevType || engineRules.communicationMode === 'thought and vision only')) {
    engineRules.presenceRules.religion = false;
    engineRules.presenceRules.philosophies = true;
    engineRules.beliefRule = 'religion absent by default; use philosophies, civic doctrines, or scientific ethics';
  }
  if (engineRules.presenceRules.religion === null && quantityConstraints.philosophies) {
    engineRules.presenceRules.religion = false;
    engineRules.presenceRules.philosophies = true;
    engineRules.beliefRule = 'philosophies requested; organized religion not generated unless separately requested';
  }
  const effectiveGovernment = engineRules.presenceRules.government === false ? 'decentralized coordination' : government;
  let effectiveScaleInfo = engineRules.presenceRules.colony && !['galactic', 'world'].includes(scaleInfo.id)
    ? { ...scaleInfo, id: 'faction', label: 'Colony', confidence: Math.max(scaleInfo.confidence, 80) }
    : scaleInfo;
  if (kardashevScope && !engineRules.presenceRules.colony) {
    effectiveScaleInfo = {
      ...effectiveScaleInfo,
      id: kardashevScope.baseScale,
      label: kardashevScope.scaleLabel,
      confidence: Math.max(effectiveScaleInfo.confidence, 90)
    };
  }
  const generationProfile = detectGenerationProfile(text, effectiveScaleInfo.id, profileOverride);
  const promptTags = text.split(' ').filter(word => word.length > 3).slice(0, 8);
  const tags = [...new Set(['generated', 'world architect', effectiveScaleInfo.id, generationProfile, theme, genre, effectiveSpecies, effectivePopulationRule, techInfo.technologyLevel, techInfo.kardashevType, kardashevScope?.scaleLabel, effectiveGovernment, setting, mood, magicMode, engineRules.communicationMode, engineRules.socialStructureRule, ...promptTags].filter(Boolean))];
  const analysis = {
    originalPrompt: prompt,
    prompt,
    theme,
    themeLabel: THEME_BANKS[theme].label,
    genre,
    species: effectiveSpecies,
    speciesLabel: effectiveSpeciesLabel,
    characterSpecies: effectiveCharacterSpecies,
    speciesProfiles,
    populationRule: effectivePopulationRule,
    forbiddenSpecies: [...new Set(speciesInfo.forbiddenSpecies)],
    technologyLevel: techInfo.technologyLevel,
    kardashevType: techInfo.kardashevType,
    kardashevScope,
    magicMode,
    magicOrTech: magicMode === 'none' || magicMode === 'none unless requested' ? techInfo.technologyLevel : magicMode,
    government: effectiveGovernment,
    requestedGovernment: government,
    setting,
    mood,
    scale: effectiveScaleInfo.id,
    scaleLabel: effectiveScaleInfo.label,
    scaleConfidence: effectiveScaleInfo.confidence,
    generationProfile,
    generationProfileLabel: GENERATION_PROFILES[generationProfile].label,
    quantityConstraints,
    explicitConstraints: [
      ...explicitConstraints.filter(item => !(engineRules.presenceRules.government === false && normalizeText(item).includes('government'))),
      kardashevScope ? `${kardashevScope.scaleLabel}: ${kardashevScope.description}` : '',
      engineRules.communicationMode === 'thought and vision only' ? 'communication: thought and vision only' : '',
      engineRules.presenceRules.religion === false ? 'no religion' : '',
      engineRules.presenceRules.government === false ? 'no formal government' : '',
      engineRules.presenceRules.family === false ? 'no families' : '',
      engineRules.presenceRules.colony ? 'isolated colony' : '',
      quantityConstraints.population ? `${quantityConstraints.population.toLocaleString()} population` : '',
      quantityConstraints.philosophies ? `${quantityConstraints.philosophies} philosophies` : ''
    ].filter(Boolean),
    negativeConstraints,
    unclear,
    noWar: negativeConstraints.includes('no war') || mood === 'peaceful',
    communicationMode: engineRules.communicationMode,
    beliefRule: engineRules.beliefRule,
    governmentRule: engineRules.governmentRule,
    familyRule: engineRules.familyRule,
    socialStructureRule: engineRules.socialStructureRule,
    populationRules: engineRules.populationRules,
    planetRules: engineRules.planetRules,
    presenceRules: engineRules.presenceRules,
    worldAlternatives: engineRules.alternatives,
    internalRules,
    fictionalPlausibility: {
      impossibleSpecies: speciesProfiles.filter(profile => profile.impossible).map(profile => profile.label),
      rules: internalRules
    },
    worldKind: engineRules.presenceRules.colony ? 'isolated colony' : effectiveScaleInfo.id,
    worldEngineModules: WORLD_ENGINE_MODULES,
    tags
  };
  analysis.blueprint = buildGenerationBlueprint(analysis);
  analysis.performancePlan = analysis.blueprint.performancePlan;
  analysis.cultures = buildCultureSystem(analysis);
  analysis.populationEstimate = estimatePopulation(analysis, analysis.blueprint);
  return analysis;
}

function nameGenerator(kind, analysis, usedNames) {
  const bank = THEME_BANKS[analysis.theme] || THEME_BANKS['high fantasy'];
  if (kind === 'faction') {
    const governmentNouns = {
      civilization: ['Civilization', 'Continuum', 'Accord', 'Civic Mesh'],
      republic: ['Republic', 'Assembly', 'Commonwealth', 'Civic Accord'],
      federation: ['Federation', 'Union', 'Compact', 'Interlink'],
      corporation: ['Consortium', 'Corporate Mesh', 'Trust', 'Directorate'],
      'hive mind': ['Collective', 'Consensus', 'Shared Mind', 'Chorus'],
      academy: ['Academy', 'Institute', 'Scholarium', 'Creative Campus'],
      empire: ['Empire', 'Dominion', 'Imperium', 'Regency'],
      'city-state': ['City-State', 'Metropolis', 'Free City', 'Urban Accord'],
      religion: ['Sanctum', 'Church', 'Faith-State', 'Choir'],
      cult: ['Cult', 'Circle', 'Devotion', 'Hidden Order']
    };
    const noun = pick(governmentNouns[analysis.government] || bank.factionNouns);
    return uniqueName(`The ${pick(bank.adjectives)} ${noun}`, usedNames);
  }
  if (kind === 'character' || kind === 'supportingCharacter') {
    const seedIndex = usedNames.size + (kind === 'supportingCharacter' ? 3 : 0);
    return culturalPersonName(analysis, usedNames, seedIndex);
  }
  if (kind === 'capital') {
    const suffix = analysis.kardashevType === 'Type III'
      ? 'the Galactic Nexus'
      : analysis.government === 'city-state'
        ? 'the Ruled City'
        : analysis.government === 'academy'
          ? 'the Central Campus'
          : analysis.government === 'republic'
            ? 'the Civic Capital'
            : 'the Seat of Power';
    return uniqueName(`${culturalPlaceName('city', analysis, usedNames, usedNames.size)}, ${suffix}`, usedNames);
  }
  if (kind === 'secondaryLocation') return culturalPlaceName('location', analysis, usedNames, usedNames.size);
  return culturalPlaceName(kind, analysis, usedNames, usedNames.size);
}

function baseEntityFields(name, description, tags) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    description,
    tags: tags.join(', '),
    notes: 'World seed entry.',
    created: now,
    updated: now
  };
}

function isHighTechAnalysis(analysis) {
  return Boolean(analysis.kardashevType) || ['modern', 'super modern', 'futuristic', 'cyberpunk', 'spacefaring', 'interstellar', 'galactic', 'planetary modern', 'stellar', 'super modern / galactic', 'universal / post-galactic', 'multiversal', 'reality engineering', 'pre-planetary industrial'].includes(analysis.technologyLevel);
}

function getSpeciesCitizenTerm(analysis) {
  if (analysis.speciesProfiles?.length > 1) return `${analysis.speciesProfiles.map(profile => normalizeText(profile.characterSpecies).replace(/\b\w/g, char => char.toUpperCase())).join(' and ')} citizens`;
  if (analysis.speciesProfiles?.length === 1) return `${normalizeText(analysis.speciesProfiles[0].characterSpecies)} citizens`;
  if (analysis.species === 'cats') return 'feline citizens';
  if (analysis.species === 'robots') return 'robot citizens';
  if (analysis.species === 'sentient whales') return 'sentient whale citizens';
  if (analysis.species === 'demons') return 'demonic citizens';
  if (analysis.species === 'vampires') return 'vampire citizens';
  if (analysis.species === 'witches') return 'witch citizens';
  if (analysis.species === 'angels') return 'angelic citizens';
  if (analysis.species === 'post-human') return 'post-human citizens';
  return 'citizens';
}

function getConstraintPowerSource(analysis, bank) {
  if (analysis.magicMode === 'blood magic') return 'blood magic and binding pacts';
  if (analysis.magicMode === 'memory magic') return 'memory magic and civic archives';
  if (analysis.magicMode === 'occult technology') return 'occult technology and encrypted rites';
  if (analysis.magicMode === 'divine power') return 'divine power and sacred law';
  if (analysis.magicMode === 'magic-based') return 'formal magic and specialist guilds';
  if (analysis.kardashevType === 'Type VI') return 'reality-law engines, identity continuity systems, and civilization-scale causality safeguards';
  if (analysis.kardashevType === 'Type V') return 'multiversal transit, branch archives, and cross-reality stewardship';
  if (analysis.kardashevType === 'Type IV') return 'post-galactic energy routing, universe-scale archives, and civilization continuity engines';
  if (analysis.kardashevType === 'Type III') return 'Dyson swarms, star-lane governance, and galactic logistics';
  if (analysis.kardashevType === 'Type II') return 'stellar engineering and orbital habitats';
  if (analysis.technologyLevel === 'cyberpunk') return 'neon infrastructure, corporate networks, and black-market code';
  if (isHighTechAnalysis(analysis)) return pick(['quantum archives', 'planetary networks', 'synthetic ecology', 'AI logistics']);
  if (analysis.technologyLevel === 'modern') return pick(['public infrastructure', 'modern research networks', 'civic logistics', 'distributed education']);
  return pick(bank.powerSources);
}

function getLeaderTitle(analysis) {
  if (analysis.government === 'republic') return 'Chancellor';
  if (analysis.government === 'federation') return 'Coordinator';
  if (analysis.government === 'corporation') return 'Executive Director';
  if (analysis.government === 'hive mind') return 'Consensus Node';
  if (analysis.government === 'academy') return 'Head Curator';
  if (analysis.government === 'religion') return 'High Oracle';
  if (analysis.government === 'cult') return 'Inner Voice';
  if (analysis.government === 'empire') return analysis.mood === 'brutal' ? 'Imperator' : 'Sovereign';
  if (analysis.government === 'kingdom' && !analysis.negativeConstraints.includes('no kings')) return 'Monarch';
  return isHighTechAnalysis(analysis) ? 'Chief Steward' : 'Sovereign';
}

function getSupportingRole(analysis) {
  if (analysis.government === 'academy' && analysis.species === 'robots') return pick(['gallery systems mentor', 'aesthetic calibration lead', 'robot artist in residence']);
  if (analysis.species === 'cats') return pick(['territory cartographer', 'sensory network keeper', 'habitat path designer']);
  if (analysis.species === 'sentient whales') return pick(['song-law mediator', 'reef memory keeper', 'tide route delegate']);
  if (analysis.species === 'robots') return pick(['protocol artist', 'memory fabricator', 'consensus debugger']);
  if (isHighTechAnalysis(analysis)) return pick(['systems diplomat', 'archive analyst', 'orbital logistics envoy', 'synthetic ecology steward']);
  if (analysis.mood === 'cozy') return pick(['studio mentor', 'festival organizer', 'community archivist']);
  return pick(['spymaster', 'heir apparent', 'exiled scholar', 'war captain', 'ritual archivist']);
}

function getConstraintToneLine(analysis) {
  if (analysis.mood === 'peaceful' || analysis.mood === 'cozy' || analysis.noWar) return 'Its tensions are civic, ecological, and personal rather than coercive.';
  if (analysis.mood === 'utopian') return 'Its optimism depends on careful maintenance and honest public systems.';
  if (analysis.mood === 'brutal' || analysis.mood === 'dark' || analysis.mood === 'horror') return 'Its authority is harsh, costly, and feared.';
  return 'Its stability depends on tradeoffs that become story pressure.';
}

function indefiniteArticle(value) {
  return /^[aeiou]/i.test(String(value || '')) ? 'an' : 'a';
}

function factionGenerator(analysis, usedNames) {
  const bank = THEME_BANKS[analysis.theme];
  const name = nameGenerator('faction', analysis, usedNames);
  const power = getConstraintPowerSource(analysis, bank);
  const ideology = analysis.government === 'republic'
    ? 'representative stewardship'
    : analysis.government === 'civilization'
      ? 'species-wide continuity'
      : analysis.government === 'academy'
        ? 'learning through shared craft'
        : analysis.mood === 'peaceful' || analysis.mood === 'cozy'
          ? 'careful cooperation'
          : pick(bank.ideologies);
  const citizens = getSpeciesCitizenTerm(analysis);
  const techLine = analysis.kardashevType ? `${analysis.kardashevType} scale` : analysis.technologyLevel !== 'unspecified' ? `${analysis.technologyLevel} infrastructure` : `${analysis.setting} civic systems`;
  return {
    ...baseEntityFields(name, `${name} is ${indefiniteArticle(analysis.mood)} ${analysis.mood} ${analysis.government} of ${citizens} in ${analysis.setting}. It is built around ${power} and ${techLine}. ${getConstraintToneLine(analysis)}`, analysis.tags),
    leader: '',
    ideology: titleCase(ideology),
    goals: analysis.noWar
      ? `Keep ${power} fair, transparent, and peaceful across ${analysis.setting}.`
      : `Secure ${power} while protecting the society's core identity.`,
    allies: '',
    enemies: ''
  };
}

function characterGenerator(role, analysis, faction, usedNames) {
  const bank = THEME_BANKS[analysis.theme];
  const isLeader = role === 'Leader';
  const name = nameGenerator(isLeader ? 'character' : 'supportingCharacter', analysis, usedNames);
  const roleTitle = isLeader ? `${getLeaderTitle(analysis)} of ${faction.name}` : getSupportingRole(analysis);
  const species = analysis.characterSpecies || (analysis.species ? titleCase(analysis.species) : pick(['Citizen', 'Local species', 'Oathbound citizen']));
  const power = getConstraintPowerSource(analysis, bank);
  return {
    ...baseEntityFields(name, isLeader
      ? `${name} is a ${species} leader who keeps ${faction.name} aligned with ${analysis.populationRule}. Their authority depends on ${power}, not on imported assumptions.`
      : `${name} is a ${species} specialist whose work reveals how ${faction.name} actually functions day to day.`,
    analysis.tags),
    role: roleTitle,
    species,
    personality: analysis.mood === 'cozy'
      ? 'Gentle, curious, and quietly exacting.'
      : isLeader ? 'Commanding, patient, and strategically empathetic.' : 'Observant, conflicted, and brave at inconvenient moments.',
    goals: isLeader
      ? analysis.noWar ? `Preserve peace and fair access to ${power}.` : `Preserve ${faction.name} while honoring its founding conditions.`
      : analysis.noWar ? `Resolve a civic tension without coercion or war.` : `Reveal a pressure point before it harms ${getSpeciesCitizenTerm(analysis)}.`,
    secrets: analysis.mood === 'peaceful' || analysis.mood === 'cozy' || analysis.noWar
      ? 'Carries private doubts about whether the current system can stay gentle at scale.'
      : isLeader ? pick(bank.secrets) : `Knows evidence that could break ${faction.name}'s claim to power.`
  };
}

function locationGenerator(kind, analysis, faction, usedNames) {
  const bank = THEME_BANKS[analysis.theme];
  const isCapital = kind === 'capital';
  const name = nameGenerator(isCapital ? 'capital' : 'secondaryLocation', analysis, usedNames);
  const power = getConstraintPowerSource(analysis, bank);
  return {
    ...baseEntityFields(name, isCapital
      ? `${name} is the central ${analysis.setting} hub of ${faction.name}, designed around ${power} and the needs of ${getSpeciesCitizenTerm(analysis)}.`
      : `${name} is a secondary ${analysis.setting} site where daily life tests whether ${faction.name}'s ideals actually work.`,
    analysis.tags),
    region: isCapital ? analysis.setting : `Secondary ${analysis.setting}`,
    importance: isCapital ? 'Primary civic and logistical hub' : analysis.noWar ? 'Peaceful pressure point and local problem space' : 'Secondary location with a dangerous pressure point',
    associatedFactions: [faction.id]
  };
}

function loreNoteGenerator(analysis, generated) {
  const bank = THEME_BANKS[analysis.theme];
  const { faction, leader, supportingCharacter, capital, secondaryLocation } = generated;
  const power = getConstraintPowerSource(analysis, bank);
  const citizens = getSpeciesCitizenTerm(analysis);
  const civicWord = analysis.noWar ? 'coordination challenge' : 'pressure point';
  const templates = [
    [`The Founding Condition`, `${faction.name} was organized around ${analysis.populationRule} and ${analysis.setting}.`, `Every institution in ${capital.name} is measured against old civic conditions: who belongs, how power works, which technologies are trusted, and which taboos keep society coherent.`],
    [`The ${titleCase(analysis.government)} Charter`, `${analysis.government} authority depends on ${power}.`, `${leader.name} maintains legitimacy by proving that ${power} serves ${citizens}, not an imported fantasy hierarchy.`],
    [`The Daily Life Standard`, `${citizens} shape architecture, law, and etiquette.`, `${capital.name} and ${secondaryLocation.name} are designed around the senses, bodies, tools, and social assumptions of ${citizens}.`],
    [`The ${titleCase(civicWord)} at ${secondaryLocation.name}`, `${secondaryLocation.name} reveals the hardest practical problem in the society.`, analysis.noWar ? `The issue must be solved through mediation, design, and public trust rather than war.` : `The issue creates drama by testing species needs, technology, government, and forbidden practices at the same time.`],
    [`The Future of ${faction.name}`, `${supportingCharacter.name} sees the next stress test before most citizens do.`, `The question is whether ${faction.name} can grow while staying true to its population laws, technology base, and public taboos.`]
  ];
  return templates.map(([name, summary, content]) => ({
    ...baseEntityFields(name, summary, analysis.tags),
    category: 'History',
    summary,
    content
  }));
}

function relationshipGenerator(generated, analysis) {
  const now = new Date().toISOString();
  const { faction, leader, supportingCharacter, capital, secondaryLocation } = generated;
  const tagText = analysis.tags.join(', ');
  const makeRel = (source, sourceType, target, targetType, type, description, importance = 'Medium', intel = {}) => ({
    id: generateId(),
    sourceId: source.id,
    sourceType,
    targetId: target.id,
    targetType,
    type,
    description,
    importance,
    strength: intel.strength || inferRelationshipStrength({ type, description, importance, tags: tagText }),
    influence: intel.influence || inferRelationshipInfluence({ type, description, importance, tags: tagText }),
    visibility: intel.visibility || inferRelationshipVisibility({ type, description, importance, tags: tagText }),
    stability: intel.stability || inferRelationshipStability({ type, description, importance, tags: tagText }),
    tone: intel.tone || inferRelationshipTone({ type, description, importance, tags: tagText }),
    tags: tagText,
    created: now,
    updated: now
  });
  return [
    makeRel(leader, 'Character', faction, 'Faction', 'Leader Of', `${leader.name} leads ${faction.name} within the stated ${analysis.government} structure.`, 'High', { strength: 8, influence: 9, visibility: 'Public', stability: 'Stable', tone: 'Loyalty' }),
    makeRel(supportingCharacter, 'Character', faction, 'Faction', 'Member Of', `${supportingCharacter.name} serves ${faction.name} and tests whether its rules work for ${getSpeciesCitizenTerm(analysis)}.`, 'High', { strength: 7, influence: 7, visibility: 'Public', stability: 'Fragile', tone: 'Loyalty' }),
    makeRel(faction, 'Faction', capital, 'Location', 'Controls', `${faction.name} administers ${capital.name} through systems appropriate to ${analysis.technologyLevel}.`, 'High', { strength: 8, influence: 10, visibility: 'Public', stability: 'Stable', tone: 'Respect' }),
    makeRel(faction, 'Faction', secondaryLocation, 'Location', 'Controls', analysis.noWar ? `${faction.name} coordinates ${secondaryLocation.name} through negotiated civic agreements.` : `${faction.name} needs ${secondaryLocation.name}, but local priorities are difficult to align.`, 'Medium', { strength: 5, influence: 8, visibility: 'Public', stability: analysis.noWar ? 'Stable' : 'Fragile', tone: analysis.noWar ? 'Respect' : 'Distrust' }),
    makeRel(faction, 'Faction', capital, 'Location', 'Located In', `${faction.name}'s visible authority is centered in ${capital.name}.`, 'Medium', { strength: 6, influence: 8, visibility: 'Public', stability: 'Stable', tone: 'Respect' }),
    makeRel(supportingCharacter, 'Character', leader, 'Character', 'Secret Connection', analysis.noWar ? `${supportingCharacter.name} privately challenges ${leader.name} to keep the society peaceful.` : `${supportingCharacter.name} knows a constraint failure that could compromise ${leader.name}.`, 'High', { strength: 8, influence: 8, visibility: 'Secret', stability: 'Volatile', tone: analysis.noWar ? 'Admiration' : 'Distrust' }),
    makeRel(supportingCharacter, 'Character', secondaryLocation, 'Location', 'Located In', `${supportingCharacter.name} studies ${secondaryLocation.name} as the clearest test of the founding conditions.`, 'Medium', { strength: 5, influence: 6, visibility: 'Public', stability: 'Stable', tone: 'Admiration' })
  ];
}

function generatedScaleTags(analysis, scaleType) {
  return [...new Set([...analysis.tags, scaleType].filter(Boolean))];
}

function scaleBaseEntity(name, description, analysis, scaleType, extra = {}) {
  return {
    ...baseEntityFields(name, description, generatedScaleTags(analysis, scaleType)),
    scaleType,
    ...extra
  };
}

function scaleName(kind, analysis, usedNames, index = 0, parentName = '') {
  if (kind === 'character' || kind === 'citizen') return culturalPersonName(analysis, usedNames, index);
  return culturalPlaceName(kind, analysis, usedNames, index, parentName);
}

function getCommunicationCultureLine(analysis) {
  if (analysis.communicationMode === 'thought and vision only') {
    return 'Public life depends on shared mental imagery, visual grammar, dream etiquette, memory law, non-verbal art, and strict privacy boundaries.';
  }
  if (analysis.communicationMode === 'visual only; no spoken language') {
    return 'Public life depends on visual grammar, gesture courts, light-sign infrastructure, silent emergency signals, written consent marks, and etiquette around attention.';
  }
  return 'Communication uses spoken language, writing, public archives, and local media adapted to the society.';
}

function getSocialStructureLine(analysis) {
  if (analysis.socialStructureRule === 'collective consciousness') return 'Social identity is organized through thought clusters, caste roles, memory strata, and negotiated privacy walls.';
  if (analysis.presenceRules?.family === false) return `Social identity avoids conventional families and uses ${analysis.worldAlternatives?.family || 'cohorts, guild mentors, and public obligation circles'}.`;
  if (analysis.presenceRules?.colony) return 'Social identity is built from habitat crews, life-support rosters, apprenticeship circles, and emergency trust bonds.';
  return 'Social identity blends households, guild mentors, public obligations, and local civic circles.';
}

function getBeliefStructureLine(analysis) {
  if (analysis.presenceRules?.religion === false) return `Belief life is carried by ${analysis.worldAlternatives?.belief || 'philosophies, civic doctrines, scientific ethics, and taboo systems'}.`;
  if (analysis.blueprint?.religions) return 'Belief life includes organized faiths, public doubts, philosophical schools, and law-bound care institutions.';
  return 'Belief life remains mostly civic: ethics, customs, legal memory, and local taboos guide behavior.';
}

function getGovernmentStructureLine(analysis) {
  if (analysis.presenceRules?.government === false) return `No central office exists; order comes from ${analysis.worldAlternatives?.government || 'consensus networks and rotating councils'}.`;
  return `${titleCase(analysis.government)} institutions define decision process, legitimacy, public services, and accountable power.`;
}

function getContinentDetailLine(index, analysis) {
  const sizes = analysis.planetRules?.continentSizeRange === 'moderately large to extreme'
    ? ['moderately large', 'large', 'very large', 'extreme', 'storm-broken extreme']
    : ['compact', 'broad', 'rifted', 'polar', 'equatorial'];
  const climates = ['temperate storm belts', 'dry uplands', 'monsoon basins', 'polar margins', 'engineered wetlands', 'volcanic arcs'];
  const resources = ['freshwater corridors', 'rare earth seams', 'deep harbors', 'geothermal fields', 'seed vaults', 'orbital launch plateaus'];
  const hazards = ['quake belts', 'storm corridors', 'border droughts', 'invasive ecologies', 'glacier shifts', 'navigation dead zones'];
  return `Size category: ${sizes[index % sizes.length]}. Climate: ${climates[index % climates.length]}. Resources: ${resources[index % resources.length]}. Hazards: ${hazards[index % hazards.length]}.`;
}

function getCountryDetailLine(index, analysis, parent) {
  const economies = ['water engineering', 'archive logistics', 'coastal fabrication', 'agricultural reserve design', 'orbital customs', 'education exports'];
  const politics = analysis.presenceRules?.government === false
    ? ['consensus councils', 'rotating duty compacts', 'neighborhood assemblies', 'worksite delegates']
    : ['constitutional offices', 'regional ministries', 'public courts', 'service bureaus'];
  const parentText = parent ? ` It sits within ${parent.name}.` : '';
  const politicsLabel = analysis.presenceRules?.government === false ? 'Coordination style' : 'Government style';
  return `${parentText} ${politicsLabel}: ${politics[index % politics.length]}. Economy: ${economies[index % economies.length]}. Conflict role: it controls a practical chokepoint without becoming interchangeable with its neighbors.`;
}

function getCityDetailLine(index, analysis, parent) {
  const purposes = ['logistics and repair', 'education and memory work', 'coastal exchange', 'resource auditing', 'public design', 'medical adaptation'];
  const infrastructure = analysis.communicationMode === 'thought and vision only'
    ? ['privacy courts', 'visual-thought plazas', 'memory consent archives', 'dream-signal schools']
    : analysis.communicationMode === 'visual only; no spoken language'
      ? ['light-signal avenues', 'gesture plazas', 'silent alarm towers', 'public caption walls']
    : ['transit spines', 'waterworks', 'public archives', 'repair districts'];
  const parentText = parent ? ` It belongs to ${parent.name}.` : '';
  return `${parentText} Purpose: ${purposes[index % purposes.length]}. Infrastructure: ${infrastructure[index % infrastructure.length]}. Its landmarks make local culture visible rather than merely administrative.`;
}

function createScaleFaction(kind, index, analysis, usedNames, parent = null) {
  const name = scaleName(kind, analysis, usedNames, index, parent ? parent.name : '');
  const power = getConstraintPowerSource(analysis, THEME_BANKS[analysis.theme]);
  const citizens = getSpeciesCitizenTerm(analysis);
  const role = getRoleProfile(index);
  const culture = getCulture(analysis, index);
  const kindLabels = {
    government: 'government',
    country: 'regional authority',
    civilization: 'civilization-scale institution',
    institution: 'public institution',
    council: 'coordination council',
    'survival-role': 'survival-role network',
    'thought-cluster': 'thought-cluster',
    philosophy: 'philosophical school',
    faction: 'faction'
  };
  const kindLabel = kindLabels[kind] || kind;
  const organizationLine = analysis.presenceRules?.government === false
    ? `${name} is a ${kindLabel} shaped by ${culture.label} customs and ${role.label.toLowerCase()} priorities. It coordinates ${citizens} through ${power}, ${analysis.worldAlternatives?.government || 'consensus networks and duty compacts'}, and practical trust.`
    : `${name} is a ${kindLabel} shaped by ${culture.label} customs and ${role.label.toLowerCase()} priorities. It serves ${citizens} through ${power}, with daily politics centered on ${role.focus}.`;
  return scaleBaseEntity(
    name,
    `${organizationLine} Its main vulnerability is that ${role.tension}.`,
    analysis,
    kind,
    {
      leader: '',
      ideology: analysis.presenceRules?.government === false
        ? titleCase('decentralized mutual stewardship')
        : kind === 'country' || kind === 'government'
          ? titleCase(`${analysis.government} stewardship`)
          : titleCase(pick(THEME_BANKS[analysis.theme].ideologies)),
      goals: analysis.noWar || analysis.presenceRules?.government === false ? `Coordinate peacefully with neighboring powers while protecting ${citizens}.` : `Protect its interests while managing ${role.tension}.`,
      allies: '',
      enemies: '',
      worldRole: role.label,
      culture: culture.label,
      parentId: parent ? parent.id : '',
      parentName: parent ? parent.name : ''
    }
  );
}

function createScaleLocation(kind, index, analysis, usedNames, parent = null) {
  const name = scaleName(kind, analysis, usedNames, index, parent ? parent.name : '');
  const parentText = parent && !['country', 'city'].includes(kind) ? ` It belongs to ${parent.name}.` : '';
  const role = getRoleProfile(index);
  const culture = getCulture(analysis, index);
  const starSystemProfile = kind === 'starSystem' ? createStarSystemProfile(analysis, index, name) : null;
  const planetProfile = kind === 'planet' ? createPlanetProfile(analysis, index, name) : null;
  const kindDescriptions = {
    cosmicDomain: `${name} is a cosmic-scale continuity domain where reality rules, archives, causality traffic, and inter-galactic stewardship are treated as public infrastructure. Its main story pressure is that ${role.tension}.`,
    sector: `${name} is a stellar sector of trade lanes, protected habitats, jurisdiction boundaries, and cultural corridors. ${parent ? `It answers to ${parent.name}.` : ''} Its strongest identity comes from ${role.focus}.`,
    country: `${name} is a ${role.label.toLowerCase()} country where ${culture.language} shapes law, trade, and ordinary identity. ${getCountryDetailLine(index, analysis, parent)} Its public life centers on ${role.focus}, while ${role.tension}.`,
    continent: `${name} is a continental-scale region of climate corridors, historic migration routes, and ${culture.architecture}. ${getContinentDetailLine(index, analysis)} Its strongest identity comes from ${role.label.toLowerCase()} settlements.`,
    city: `${name} is a ${role.label.toLowerCase()} city known for ${culture.architecture}, ${culture.art}, and institutions tied to ${role.focus}. ${getCityDetailLine(index, analysis, parent)}`,
    starSystem: starSystemProfile ? starSystemProfileText(starSystemProfile) : `${name} is a ${analysis.planetRules?.starContext || 'star'} system whose settlements depend on traffic windows, local resource treaties, flare shelters, and ${analysis.kardashevType || analysis.technologyLevel} infrastructure.`,
    planet: planetProfile ? planetProfileText(planetProfile) : `${name} is a planetary world or colony with local stakes inside the larger civilization.`,
    megastructure: `${name} is a megastructure with maintenance districts, ritualized access law, and public myths about the workers who keep it alive.`,
    location: `${name} is a major site where ${culture.traditions[0]} and ${role.focus} meet in daily life.`
  };
  return scaleBaseEntity(
    name,
    `${kindDescriptions[kind] || kindDescriptions.location}${parentText}`,
    analysis,
    kind,
    {
      region: parent ? parent.name : analysis.setting,
      importance: kind === 'planet' && planetProfile ? `Planet profile: ${planetProfile.planetType}, ${planetProfile.gravity}, ${planetProfile.habitability} habitability` : kind === 'megastructure' ? 'Civilization-scale infrastructure' : kind === 'city' ? `${role.label} and cultural hub` : `${role.label} in the world hierarchy`,
      associatedFactions: [],
      worldRole: role.label,
      culture: culture.label,
      starSystemProfile: starSystemProfile ? JSON.stringify(starSystemProfile) : '',
      planetProfile: planetProfile ? JSON.stringify(planetProfile) : '',
      parentId: parent ? parent.id : '',
      parentName: parent ? parent.name : ''
    }
  );
}

function getCharacterTier(index, total) {
  const majorCount = Math.min(50, Math.max(3, Math.ceil(total * 0.05)));
  const secondaryCount = Math.min(300, Math.max(6, Math.ceil(total * 0.22)));
  if (index < majorCount) return 'Major Figure';
  if (index < majorCount + secondaryCount) return 'Secondary Figure';
  return 'Ordinary Citizen';
}

function getCitizenRoleForTier(tier, index, analysis) {
  const majorRoles = analysis.presenceRules?.religion === false
    ? ['philosopher', 'inventor', 'diplomat', 'reform organizer', 'cultural icon', 'systems architect', 'rights advocate', 'public investigator']
    : ['leader', 'inventor', 'diplomat', 'philosophical figure', 'rebel', 'celebrity', 'military strategist', 'rights advocate'];
  const secondaryRoles = ['local coordinator', 'teacher', 'merchant', 'engineer', 'doctor', 'artist', 'messenger', 'scholar', 'translator', 'maintenance lead', 'neighborhood mediator'];
  const ordinaryRoles = analysis.presenceRules?.family === false
    ? ['worker', 'student', 'traveler', 'technician', 'shopkeeper', 'performer', 'farmhand', 'repair apprentice', 'visual clerk', 'habitat tender']
    : ['worker', 'student', 'parent', 'traveler', 'farmer', 'technician', 'shopkeeper', 'performer', 'caregiver', 'dockhand', 'cook'];
  if (tier === 'Major Figure') return majorRoles[index % majorRoles.length];
  if (tier === 'Secondary Figure') return secondaryRoles[index % secondaryRoles.length];
  return ordinaryRoles[index % ordinaryRoles.length];
}

function getCitizenPersonality(index, tier, analysis) {
  const major = ['Strategic, visible, and privately burdened.', 'Charismatic, restless, and protective of the vulnerable.', 'Brilliant, exacting, and difficult to reassure.', 'Patient in public and uncompromising in private.'];
  const secondary = ['Practical, observant, and trusted by neighbors.', 'Warm, skeptical, and good at repair.', 'Careful, funny under stress, and quietly ambitious.', 'Reliable, curious, and protective of their work circle.'];
  const ordinary = ['Tired but kind, with a habit of noticing small changes.', 'Cheerful in routine and brave when cornered.', 'Private, competent, and loyal to a small circle.', 'Restless, generous, and afraid of being overlooked.'];
  const pool = tier === 'Major Figure' ? major : tier === 'Secondary Figure' ? secondary : ordinary;
  return pool[index % pool.length];
}

function getCitizenVulnerability(index, speciesProfile, analysis) {
  const practical = [
    'depends on a fragile permit, tool, route, or care network',
    'owes someone a debt that could become public',
    'is hiding a mistake that affected a neighbor',
    'fears losing access to the place where they belong',
    'knows their body or species needs are still treated as optional'
  ];
  if (speciesProfile?.weaknesses) return `${speciesProfile.weaknesses}; personally, ${practical[index % practical.length]}`;
  return practical[index % practical.length];
}

function getCitizenGoal(index, tier, faction, location, analysis) {
  const place = location ? location.name : analysis.setting;
  if (tier === 'Major Figure') return faction ? `Keep ${faction.name} legitimate while protecting ${place}.` : `Shape public life in ${place} before a crisis defines it.`;
  if (tier === 'Secondary Figure') return `Keep a local system in ${place} working well enough that ordinary citizens can trust it.`;
  return `Protect a small piece of daily life in ${place} from becoming collateral damage.`;
}

function createScaleCharacter(index, analysis, usedNames, faction = null, location = null) {
  const total = analysis.blueprint?.characters || analysis.blueprint?.citizens || 1;
  const tier = getCharacterTier(index, total);
  const species = getCharacterSpeciesForIndex(index, analysis);
  const speciesProfile = getSpeciesProfileByCharacterSpecies(analysis, species);
  const name = culturalPersonName(analysis, usedNames, index, species);
  const culture = getCulture(analysis, index);
  const profession = getCitizenRoleForTier(tier, index, analysis);
  const role = index === 0 && faction ? `${getLeaderTitle(analysis)} of ${faction.name}` : profession;
  const vulnerability = getCitizenVulnerability(index, speciesProfile, analysis);
  const socialConnection = faction ? `${faction.name} through ${profession} work` : location ? `${location.name} neighborhood network` : `${culture.label} work circle`;
  return scaleBaseEntity(
    name,
    `${name} is a ${tier.toLowerCase()} and ${species} ${role} from ${culture.label} society in ${location ? location.name : analysis.setting}. They carry local habits from ${culture.traditions[0]}, rely on ${socialConnection}, and understand how large institutions touch daily life. Vulnerability: ${vulnerability}. ${getSocialStructureLine(analysis)}`,
    analysis,
    'citizen',
    {
      role,
      species,
      profession,
      importanceTier: tier,
      culture: culture.label,
      personality: getCitizenPersonality(index, tier, analysis),
      goals: getCitizenGoal(index, tier, faction, location, analysis),
      vulnerability,
      fear: vulnerability,
      socialConnection,
      secrets: tier === 'Major Figure'
        ? (analysis.noWar ? 'Knows a quiet civic problem that needs care before it grows.' : 'Knows a pressure point that could change a major relationship.')
        : tier === 'Secondary Figure'
          ? 'Has noticed a local pattern that more powerful people keep missing.'
          : 'Keeps one private pressure point that could pull them into the wider story.',
      parentId: faction ? faction.id : '',
      parentName: faction ? faction.name : '',
      homeLocationId: location ? location.id : '',
      homeLocationName: location ? location.name : ''
    }
  );
}

function createScaleLore(kind, index, analysis, usedNames, subject = null) {
  const culture = getCulture(analysis, index);
  const role = getRoleProfile(index);
  const name = kind === 'blueprint'
    ? uniqueName(`${analysis.scaleLabel} Survey`, usedNames)
    : kind === 'culture'
      ? uniqueName(`${culture.label} Culture`, usedNames)
      : kind === 'philosophy'
        ? uniqueName(`${culture.label} ${['Ethic', 'Inquiry', 'Doctrine', 'Code', 'School'][index % 5]}`, usedNames)
        : kind === 'internalRules'
          ? uniqueName(`${analysis.scaleLabel} Internal Rules`, usedNames)
          : kind === 'habitability'
            ? uniqueName(`${analysis.scaleLabel} Habitability Logic`, usedNames)
        : kind === 'communication'
          ? uniqueName(`${culture.label} Communication Customs`, usedNames)
          : kind === 'socialStructure'
            ? uniqueName(`${culture.label} Social Pattern`, usedNames)
            : kind === 'presence'
      ? uniqueName(`${analysis.scaleLabel} Presence Record`, usedNames)
      : kind === 'planetProfile' && subject
        ? uniqueName(`${subject.name} Planetary Record`, usedNames)
        : kind === 'starSystemProfile' && subject
          ? uniqueName(`${subject.name} Stellar System Record`, usedNames)
          : kind === 'sector' && subject
            ? uniqueName(`${subject.name} Sector Record`, usedNames)
            : kind === 'cosmicDomain' && subject
              ? uniqueName(`${subject.name} Continuity Record`, usedNames)
        : scaleName('lore', analysis, usedNames, index, subject ? subject.name : '');
  const subjectName = subject ? subject.name : analysis.scaleLabel;
  const planetProfile = kind === 'planetProfile' && subject && subject.planetProfile ? JSON.parse(subject.planetProfile) : null;
  const starSystemProfile = kind === 'starSystemProfile' && subject && subject.starSystemProfile ? JSON.parse(subject.starSystemProfile) : null;
  const speciesProfile = kind === 'species' ? (analysis.speciesProfiles || [])[index % Math.max(1, (analysis.speciesProfiles || []).length)] : null;
  const summaries = {
    blueprint: `${analysis.scaleLabel} survey of population, hierarchy, climate, and civic pressure points.`,
    government: `${subjectName} defines representation, decision process, civic limits, and public accountability.`,
    economy: `${subjectName} moves resources through ${role.focus}.`,
    culture: `${culture.label} culture uses ${culture.language}, practices ${culture.traditions.join(', ')}, and values ${culture.education}. ${getCommunicationCultureLine(analysis)}`,
    military: `${subjectName} handles defense, conflict prevention, and force projection without ignoring civilian costs.`,
    technology: `${subjectName} maintains ${analysis.kardashevType || analysis.technologyLevel} infrastructure through visible labor, repair law, and risk planning.`,
    species: speciesProfile ? `${speciesProfile.label} records anatomy, senses, habitat needs, social instincts, and civic protections.` : `${subjectName} records a major species body, its social needs, sensory assumptions, and political protections.`,
    internalRules: `${subjectName} records the fictional rules that make strange biology, communication, and society internally possible.`,
    habitability: `${subjectName} explains how major species can thrive under local gravity, atmosphere, food, shelter, and social conditions.`,
    religion: `${subjectName} defines a belief system with public rituals, private doubts, and legal consequences.`,
    philosophy: `${subjectName} preserves a non-supernatural worldview used for ethics, civic trust, education, and taboo law.`,
    communication: `${subjectName} records communication customs, privacy boundaries, memory rights, and public media.`,
    socialStructure: `${subjectName} describes how people belong, cooperate, teach, inherit duties, and handle care.`,
    presence: `${subjectName} records which systems are present, absent, optional, or replaced by alternatives.`,
    infrastructure: `${subjectName} keeps food, water, transit, communication, and dispute resolution working at scale.`,
    planetProfile: planetProfile ? `${subjectName} is a ${planetProfile.planetType} with ${planetProfile.gravity} gravity and ${planetProfile.habitability} habitability.` : `${subjectName} has a known planetary profile.`,
    starSystemProfile: starSystemProfile ? `${subjectName} is a ${starSystemProfile.starType} system with ${starSystemProfile.primaryEnergy}.` : `${subjectName} has a known stellar profile.`,
    sector: `${subjectName} records sector-scale routes, jurisdiction, cultures, and high-influence institutions.`,
    cosmicDomain: `${subjectName} records cosmic continuity rules, reality-scale infrastructure, and safeguards against impossible-scale drift.`
  };
  const summary = summaries[kind] || `${subjectName} adds worldbuilding context.`;
  const contentDetails = {
    blueprint: `Population estimate: ${analysis.populationEstimate}. Core values: continuity, legitimacy, ecological fit, and social trust. ${getGovernmentStructureLine(analysis)} ${getBeliefStructureLine(analysis)} Major weaknesses: ${role.tension}. Long-term goal: preserve identity while infrastructure scales.`,
    government: `${getGovernmentStructureLine(analysis)} Rival offices, councils, or service groups compete over ${role.focus}.`,
    economy: `The economy depends on named routes, skilled labor, repair schedules, and regional specialization rather than vague wealth.`,
    culture: `Architecture: ${culture.architecture}. Art forms: ${culture.art}. ${getSocialStructureLine(analysis)} Education: ${culture.education}. ${getCommunicationCultureLine(analysis)}`,
    military: analysis.noWar ? `Security is mostly disaster response, mediation, and defense of critical infrastructure.` : `Force is constrained by supply lines, public legitimacy, and fear of damaging the systems everyone needs.`,
    technology: `Maintenance crews, teachers, inspectors, and local councils all have a say in how technology enters daily life.`,
    species: speciesProfile ? `Species: ${speciesProfile.label}. Anatomy: ${speciesProfile.anatomy}. Senses: ${speciesProfile.senses}. Communication: ${speciesProfile.communication}. Lifespan: ${speciesProfile.lifespan}. Reproduction/growth: ${speciesProfile.reproduction}. Food or energy: ${speciesProfile.food}. Habitat needs: ${speciesProfile.habitat}. Strengths: ${speciesProfile.strengths}. Weaknesses: ${speciesProfile.weaknesses}. Legal/social status: ${speciesProfile.legalStatus}. Social instincts: ${speciesProfile.socialInstincts}. Plausibility rule: ${speciesProfile.plausibilityRule}.` : `Major species: ${analysis.speciesLabel}. Design assumptions include body scale, senses, social bonding, communication needs, and access to public space.`,
    internalRules: (analysis.internalRules || []).map(rule => `${titleCase(rule.type)} rule for ${rule.subject}: ${rule.rule} Consequence: ${rule.implication}`).join(' '),
    habitability: (analysis.speciesProfiles || []).map(profile => `${profile.label}: ideal habitats need ${profile.habitat}; food or energy comes from ${profile.food}; threats include ${profile.weaknesses}; thriving requires shelter, social belonging, reproduction support, and legal access built around ${profile.anatomy}.`).join(' '),
    religion: `Followers are concentrated around festivals, care institutions, burial customs, and oath law; schisms form where doctrine meets trade or medicine.`,
    philosophy: `${getBeliefStructureLine(analysis)} This school asks how citizens should share risk, memory, repair work, and public truth without depending on supernatural authority.`,
    communication: analysis.communicationMode === 'visual only; no spoken language'
      ? `${getCommunicationCultureLine(analysis)} Schools teach gesture literacy, public design protects sightlines, and legal records require accessible visual copies of every civic order.`
      : `${getCommunicationCultureLine(analysis)} Schools teach consent before mind-sharing, public design favors visible thought maps, and legal records distinguish private memory from civic evidence.`,
    socialStructure: `${getSocialStructureLine(analysis)} Status comes from trusted service, practical care, teaching, repair, and the ability to keep communal boundaries intact.`,
    presence: `Present systems: ${Object.entries(analysis.presenceRules || {}).filter(([, value]) => value === true).map(([key]) => titleCase(key)).join(', ') || 'minimal required systems'}. Absent systems: ${Object.entries(analysis.presenceRules || {}).filter(([, value]) => value === false).map(([key]) => titleCase(key)).join(', ') || 'none explicitly absent'}. Alternatives: belief uses ${analysis.worldAlternatives?.belief}; organization uses ${analysis.worldAlternatives?.government}; belonging uses ${analysis.worldAlternatives?.family}.`,
    infrastructure: `Failure points include water, energy, transit, communications, food storage, and trust in public records.`,
    planetProfile: planetProfile ? planetProfileText(planetProfile) : summary,
    starSystemProfile: starSystemProfile ? starSystemProfileText(starSystemProfile) : summary,
    sector: `${subjectName} organizes star systems through route law, habitat representation, emergency refuges, customs houses, and cultural corridors. Its central conflict is whether distant settlements receive fair repair, protection, and narrative attention.`,
    cosmicDomain: `${subjectName} makes reality-scale civilization legible by treating causality, archives, identity continuity, and cosmic risk as institutions with names, limits, and public consequences.`
  };
  return scaleBaseEntity(
    name,
    summary,
    analysis,
    kind,
    {
      category: titleCase(kind),
      summary,
      content: contentDetails[kind] || summary,
      culture: culture.label,
      parentId: subject ? subject.id : '',
      parentName: subject ? subject.name : ''
    }
  );
}

function createGeneratedRelationship(source, sourceType, target, targetType, type, description, analysis, importance = 'Medium', intel = {}) {
  const tagText = generatedScaleTags(analysis, 'relationship').join(', ');
  const now = new Date().toISOString();
  return {
    id: generateId(),
    sourceId: source.id,
    sourceType,
    targetId: target.id,
    targetType,
    type,
    description,
    importance,
    strength: intel.strength || inferRelationshipStrength({ type, description, importance, tags: tagText }),
    influence: intel.influence || inferRelationshipInfluence({ type, description, importance, tags: tagText }),
    visibility: intel.visibility || inferRelationshipVisibility({ type, description, importance, tags: tagText }),
    stability: intel.stability || inferRelationshipStability({ type, description, importance, tags: tagText }),
    tone: intel.tone || inferRelationshipTone({ type, description, importance, tags: tagText }),
    tags: tagText,
    created: now,
    updated: now
  };
}

function addRelationshipIfPossible(relationships, source, sourceType, target, targetType, type, description, analysis, importance = 'Medium', intel = {}) {
  if (!source || !target || source.id === target.id) return;
  const key = `${source.id}|${target.id}|${type}`;
  if (relationships.some(rel => `${rel.sourceId}|${rel.targetId}|${rel.type}` === key)) return;
  relationships.push(createGeneratedRelationship(source, sourceType, target, targetType, type, description, analysis, importance, intel));
}

function relationshipIntelForType(type, tier = 'Ordinary Citizen') {
  const high = tier === 'Major Figure';
  const medium = tier === 'Secondary Figure';
  const strength = high ? 8 : medium ? 6 : 5;
  const influence = ['Leader Of', 'Controls', 'Military', 'Trade', 'Professional'].includes(type) ? (high ? 9 : 7) : high ? 7 : 4;
  const visibility = type === 'Secret Connection' ? 'Secret' : type === 'Romantic' ? 'Rumored' : 'Public';
  const stability = ['Rival', 'Rivalry', 'Enemy'].includes(type) ? 'Volatile' : ['Secret Connection', 'Romantic'].includes(type) ? 'Fragile' : 'Stable';
  const tone = inferRelationshipTone({ type });
  return { strength, influence, visibility, stability, tone };
}

function relationshipDescription(type, source, target, analysis) {
  const speciesLine = source.species && target.species && source.species !== target.species ? ` Their different bodies make the connection socially visible.` : '';
  const descriptions = {
    Family: `${source.name} and ${target.name} share a household, lineage, or recognized kinship obligation.${speciesLine}`,
    Friendship: `${source.name} and ${target.name} trust each other in ordinary life, making their bond useful when public systems fail.${speciesLine}`,
    Rival: `${source.name} and ${target.name} compete over status, resources, interpretation, or public trust without being simple enemies.`,
    Rivalry: `${source.name} and ${target.name} define one another through a long-running rivalry that shapes local choices.`,
    Mentor: `${target.name} teaches, sponsors, or challenges ${source.name}, creating a bond that can become loyalty or resentment.`,
    'Secret Connection': `${source.name} and ${target.name} share hidden knowledge that could change how others judge them.`,
    Professional: `${source.name} and ${target.name} depend on each other through work, repair, trade, teaching, or civic service.`,
    Romantic: `${source.name} and ${target.name} carry a private affection that may complicate public obligations.`,
    Trade: `${source.name} and ${target.name} exchange goods, favors, expertise, or access through a practical local route.`,
    Cultural: `${source.name} and ${target.name} share art, language, taboo, or education customs that bridge their circles.`,
    Military: `${source.name} and ${target.name} are tied by defense planning, emergency drills, or protective service.`,
    Religious: `${source.name} and ${target.name} share a belief institution, care tradition, or doctrine dispute.`,
    Neighbor: `${source.name} and ${target.name} live or work close enough that small choices keep affecting each other.`
  };
  if (type === 'Religious' && analysis.presenceRules?.religion === false) {
    return `${source.name} and ${target.name} share a philosophical school, care tradition, or doctrine dispute.`;
  }
  return descriptions[type] || `${source.name} and ${target.name} share a meaningful social connection.`;
}

function addCharacterNetworkRelationships(relationships, characters, factions, locations, analysis) {
  if (characters.length < 2) return;
  const allowFamily = analysis.presenceRules?.family !== false;
  const allowReligion = analysis.presenceRules?.religion !== false;
  const locationTargets = locations.filter(location => ['city', 'country', 'planet', 'location'].includes(location.scaleType));
  characters.forEach((character, index) => {
    const tier = character.importanceTier || getCharacterTier(index, characters.length);
    const targetCount = tier === 'Major Figure' ? 8 : tier === 'Secondary Figure' ? 3 : 1;
    const typePlan = [];
    if (allowFamily && index % 5 === 0) typePlan.push('Family');
    if (index % 2 === 0) typePlan.push('Friendship');
    if (index % 3 === 0) typePlan.push('Professional');
    if (index % 7 === 0) typePlan.push(index % 14 === 0 ? 'Rivalry' : 'Rival');
    if (index % 11 === 0) typePlan.push('Mentor');
    if (index % 13 === 0) typePlan.push('Secret Connection');
    if (index % 17 === 0 && allowFamily) typePlan.push('Romantic');
    if (index % 19 === 0) typePlan.push('Trade');
    if (index % 23 === 0) typePlan.push('Cultural');
    if (index % 29 === 0 && !analysis.noWar) typePlan.push('Military');
    if (index % 31 === 0 && allowReligion) typePlan.push('Religious');
    typePlan.push('Neighbor');
    typePlan.slice(0, targetCount).forEach((type, planIndex) => {
      const target = characters[(index + 3 + planIndex * 11) % characters.length];
      addRelationshipIfPossible(
        relationships,
        character,
        'Character',
        target,
        'Character',
        type,
        relationshipDescription(type, character, target, analysis),
        analysis,
        tier === 'Major Figure' ? 'High' : 'Medium',
        relationshipIntelForType(type, tier)
      );
    });
    if (tier === 'Major Figure' && factions.length) {
      const faction = factions[index % factions.length];
      addRelationshipIfPossible(relationships, character, 'Character', faction, 'Faction', 'Professional', `${character.name} has a public professional stake in ${faction.name}'s legitimacy and services.`, analysis, 'High', relationshipIntelForType('Professional', tier));
    }
    if (tier !== 'Ordinary Citizen' && locationTargets.length) {
      const place = locationTargets[index % locationTargets.length];
      addRelationshipIfPossible(relationships, character, 'Character', place, 'Location', 'Cultural', `${character.name} influences how ${place.name} is understood, taught, repaired, or represented.`, analysis, tier === 'Major Figure' ? 'High' : 'Medium', relationshipIntelForType('Cultural', tier));
    }
  });
}

function generateScaleExpansions(analysis, generated) {
  const blueprint = analysis.blueprint;
  const expansions = [
    `Open the Relationship Intelligence page to inspect ${generated.relationships.length} connections by story potential.`,
    `Add one point-of-view character from the most unstable ${analysis.scaleLabel.toLowerCase()} relationship.`,
    `Use Universe Chat to ask which entity is most central and what should be deepened next.`
  ];
  if (blueprint.countries) expansions.push(`Develop a distinctive export, taboo, and public festival for each of the ${blueprint.countries} generated countries.`);
  if (blueprint.cosmicDomains) expansions.push(`Define continuity rules and failure risks for the ${blueprint.cosmicDomains} cosmic domains.`);
  if (blueprint.sectors) expansions.push(`Map jurisdiction, trade, and cultural tensions across the ${blueprint.sectors} sectors.`);
  if (blueprint.starSystems) expansions.push(`Add travel times, disputed routes, and local hazards for the ${blueprint.starSystems} star systems.`);
  if (blueprint.religions) expansions.push(`Give each religion a public ritual, private doubt, and political consequence.`);
  return expansions.slice(0, 6);
}

function generateMultiScaleWorld(analysis, universe, usedNames, worldState = null) {
  const blueprint = analysis.blueprint;
  const factions = [];
  const characters = [];
  const locations = [];
  const loreNotes = [];
  const relationships = [];
  const conflicts = [];
  const mysteries = [];

  const cosmicDomains = [];
  for (let i = 0; i < blueprint.cosmicDomains; i++) {
    const domain = createScaleLocation('cosmicDomain', i, analysis, usedNames);
    cosmicDomains.push(domain);
    locations.push(domain);
  }

  const sectors = [];
  for (let i = 0; i < blueprint.sectors; i++) {
    const parent = cosmicDomains.length ? cosmicDomains[i % cosmicDomains.length] : null;
    const sector = createScaleLocation('sector', i, analysis, usedNames, parent);
    sectors.push(sector);
    locations.push(sector);
  }

  const continents = [];
  for (let i = 0; i < blueprint.continents; i++) {
    const continent = createScaleLocation('continent', i, analysis, usedNames);
    continents.push(continent);
    locations.push(continent);
  }

  const starSystems = [];
  for (let i = 0; i < blueprint.starSystems; i++) {
    const parent = sectors.length ? sectors[i % sectors.length] : cosmicDomains[i % Math.max(1, cosmicDomains.length)] || null;
    const system = createScaleLocation('starSystem', i, analysis, usedNames, parent);
    starSystems.push(system);
    locations.push(system);
  }

  const countries = [];
  for (let i = 0; i < blueprint.countries; i++) {
    const parent = continents.length ? continents[i % continents.length] : null;
    const country = createScaleLocation('country', i, analysis, usedNames, parent);
    countries.push(country);
    locations.push(country);
  }

  for (let i = 0; i < blueprint.factions; i++) {
    const kind = analysis.presenceRules?.government === false
      ? analysis.presenceRules?.colony
        ? (i === 0 ? 'survival-role' : 'council')
        : analysis.presenceRules?.hiveMind
          ? 'thought-cluster'
          : 'institution'
      : i < countries.length
        ? 'government'
      : i < countries.length + blueprint.civilizations
        ? 'civilization'
        : 'faction';
    const parentLocation = countries.length
      ? countries[i % countries.length]
      : sectors.length
        ? sectors[i % sectors.length]
        : starSystems.length
          ? starSystems[i % starSystems.length]
          : cosmicDomains[i % Math.max(1, cosmicDomains.length)] || null;
    factions.push(createScaleFaction(kind, i, analysis, usedNames, parentLocation));
  }

  if (factions.length === 0 && (blueprint.characters || blueprint.locations || analysis.scale === 'character' || analysis.scale === 'faction')) {
    factions.push(factionGenerator(analysis, usedNames));
    factions[0].scaleType = analysis.scale === 'character' ? 'supporting-faction' : 'faction';
  }

  const planets = [];
  for (let i = 0; i < blueprint.planets; i++) {
    const parent = starSystems.length ? starSystems[i % starSystems.length] : null;
    const planet = createScaleLocation('planet', i, analysis, usedNames, parent);
    planets.push(planet);
    locations.push(planet);
  }
  if (planets.length) {
    continents.forEach((continent, index) => {
      const planet = planets[index % planets.length];
      continent.parentId = planet.id;
      continent.parentName = planet.name;
      continent.region = planet.name;
    });
  }

  const cities = [];
  for (let i = 0; i < blueprint.cities; i++) {
    const parent = countries.length
      ? countries[i % countries.length]
      : planets.length
        ? planets[i % planets.length]
        : factions[i % Math.max(1, factions.length)] || null;
    const city = createScaleLocation('city', i, analysis, usedNames, parent);
    if (parent && ['faction', 'government', 'civilization'].includes(parent.scaleType)) city.associatedFactions = [parent.id];
    cities.push(city);
    locations.push(city);
  }

  for (let i = 0; i < blueprint.megastructures; i++) {
    const parent = starSystems.length ? starSystems[i % starSystems.length] : planets[i % Math.max(1, planets.length)] || null;
    locations.push(createScaleLocation('megastructure', i, analysis, usedNames, parent));
  }

  while (locations.length < blueprint.locations) {
    const parent = cities.length ? cities[locations.length % cities.length] : factions[locations.length % Math.max(1, factions.length)] || null;
    locations.push(createScaleLocation('location', locations.length, analysis, usedNames, parent));
  }

  const characterTarget = blueprint.characters || blueprint.citizens;
  const batchSize = analysis.performancePlan?.batchSize || CHARACTER_BATCH_SIZE;
  for (let batchStart = 0; batchStart < characterTarget; batchStart += batchSize) {
    const batchEnd = Math.min(characterTarget, batchStart + batchSize);
    for (let i = batchStart; i < batchEnd; i++) {
      const faction = factions.length ? factions[i % factions.length] : null;
      const home = cities.length ? cities[i % cities.length] : planets.length ? planets[i % planets.length] : locations[i % Math.max(1, locations.length)] || null;
      characters.push(createScaleCharacter(i, analysis, usedNames, faction, home));
    }
    if (worldState) {
      worldState.batchProgress = worldState.batchProgress || [];
      worldState.batchProgress.push({ type: 'citizens', start: batchStart + 1, end: batchEnd, total: characterTarget });
    }
  }

  factions.forEach((faction, index) => {
    const leader = characters[index % Math.max(1, characters.length)];
    if (leader) faction.leader = leader.name;
  });

  loreNotes.push(createScaleLore('blueprint', 0, analysis, usedNames));
  const coreLoreKinds = [
    analysis.presenceRules?.government === false ? 'presence' : 'government',
    'economy',
    'culture',
    'technology',
    'infrastructure',
    'socialStructure'
  ];
  if (analysis.presenceRules?.communication) coreLoreKinds.push('communication');
  if (analysis.internalRules?.length) coreLoreKinds.push('internalRules');
  if (analysis.speciesProfiles?.length) coreLoreKinds.push('habitability');
  coreLoreKinds.forEach((kind, index) => {
    if (loreNotes.length < blueprint.loreNotes) loreNotes.push(createScaleLore(kind, index, analysis, usedNames, factions[0] || locations[0] || null));
  });
  (analysis.cultures || []).forEach((culture, index) => {
    if (index === 0) return;
    if (loreNotes.length < blueprint.loreNotes) loreNotes.push(createScaleLore('culture', index, analysis, usedNames, null));
  });
  for (let i = 0; i < blueprint.religions && loreNotes.length < blueprint.loreNotes; i++) {
    loreNotes.push(createScaleLore('religion', i, analysis, usedNames, factions[i % Math.max(1, factions.length)] || null));
  }
  for (let i = 0; i < blueprint.philosophies && loreNotes.length < blueprint.loreNotes; i++) {
    loreNotes.push(createScaleLore('philosophy', i, analysis, usedNames, factions[i % Math.max(1, factions.length)] || null));
  }
  for (let i = 0; i < blueprint.species && loreNotes.length < blueprint.loreNotes; i++) {
    loreNotes.push(createScaleLore('species', i, analysis, usedNames, null));
  }
  cosmicDomains.forEach((domain, index) => {
    if (loreNotes.length < blueprint.loreNotes) loreNotes.push(createScaleLore('cosmicDomain', index, analysis, usedNames, domain));
  });
  sectors.forEach((sector, index) => {
    if (loreNotes.length < blueprint.loreNotes) loreNotes.push(createScaleLore('sector', index, analysis, usedNames, sector));
  });
  starSystems.forEach((system, index) => {
    if (loreNotes.length < blueprint.loreNotes) loreNotes.push(createScaleLore('starSystemProfile', index, analysis, usedNames, system));
  });
  planets.forEach((planet, index) => {
    if (loreNotes.length < blueprint.loreNotes) loreNotes.push(createScaleLore('planetProfile', index, analysis, usedNames, planet));
  });
  while (loreNotes.length < blueprint.loreNotes) {
    loreNotes.push(createScaleLore('culture', loreNotes.length, analysis, usedNames, factions[loreNotes.length % Math.max(1, factions.length)] || locations[0] || null));
  }

  factions.forEach((faction, index) => {
    const leader = characters[index % Math.max(1, characters.length)];
    if (leader) {
      addRelationshipIfPossible(relationships, leader, 'Character', faction, 'Faction', 'Leader Of', `${leader.name} leads or represents ${faction.name} within the generated hierarchy.`, analysis, 'High', { strength: 8, influence: 8, visibility: 'Public', stability: 'Stable', tone: 'Loyalty' });
    }
    if (faction.parentId) {
      const parentLocation = locations.find(location => location.id === faction.parentId);
      if (parentLocation) {
        const type = analysis.presenceRules?.government === false ? 'Ally' : 'Controls';
        const description = analysis.presenceRules?.government === false
          ? `${faction.name} coordinates services, records, and emergency obligations with ${parentLocation.name}.`
          : `${faction.name} governs public services, law, and representation in ${parentLocation.name}.`;
        addRelationshipIfPossible(relationships, faction, 'Faction', parentLocation, 'Location', type, description, analysis, 'High', { strength: 7, influence: 8, visibility: 'Public', stability: 'Stable', tone: 'Respect' });
      }
    }
  });

  countries.forEach(country => {
    if (!country.parentId) return;
    const parentLocation = locations.find(location => location.id === country.parentId);
    if (parentLocation) addRelationshipIfPossible(relationships, country, 'Location', parentLocation, 'Location', 'Located In', `${country.name} lies within ${parentLocation.name}.`, analysis, 'High', { strength: 8, influence: 5, visibility: 'Public', stability: 'Stable', tone: 'Respect' });
  });

  continents.forEach(continent => {
    if (!continent.parentId) return;
    const parentPlanet = locations.find(location => location.id === continent.parentId);
    if (parentPlanet) addRelationshipIfPossible(relationships, continent, 'Location', parentPlanet, 'Location', 'Located In', `${continent.name} is one of ${parentPlanet.name}'s major continental regions.`, analysis, 'High', { strength: 8, influence: 4, visibility: 'Public', stability: 'Stable', tone: 'Respect' });
  });

  sectors.forEach(sector => {
    if (!sector.parentId) return;
    const parentDomain = locations.find(location => location.id === sector.parentId);
    if (parentDomain) addRelationshipIfPossible(relationships, sector, 'Location', parentDomain, 'Location', 'Located In', `${sector.name} operates inside ${parentDomain.name}'s continuity and infrastructure rules.`, analysis, 'High', { strength: 8, influence: 7, visibility: 'Public', stability: 'Stable', tone: 'Respect' });
  });

  starSystems.forEach(system => {
    if (!system.parentId) return;
    const parentSector = locations.find(location => location.id === system.parentId);
    if (parentSector) addRelationshipIfPossible(relationships, system, 'Location', parentSector, 'Location', 'Located In', `${system.name} is charted inside ${parentSector.name}.`, analysis, 'High', { strength: 8, influence: 7, visibility: 'Public', stability: 'Stable', tone: 'Respect' });
  });

  cities.forEach((city, index) => {
    const country = countries.length ? countries[index % countries.length] : null;
    const government = country ? factions.find(faction => faction.parentId === country.id) : factions[index % Math.max(1, factions.length)];
    if (country) {
      addRelationshipIfPossible(relationships, city, 'Location', country, 'Location', 'Located In', `${city.name} is one of ${country.name}'s major urban centers.`, analysis, 'High', { strength: 8, influence: 6, visibility: 'Public', stability: 'Stable', tone: 'Respect' });
    }
    if (government) {
      const type = analysis.presenceRules?.government === false ? 'Ally' : 'Controls';
      const description = analysis.presenceRules?.government === false
        ? `${government.name} supports ${city.name} through duty rosters, life-support agreements, and shared records.`
        : `${government.name} administers ${city.name} through courts, services, and local offices.`;
      addRelationshipIfPossible(relationships, government, 'Faction', city, 'Location', type, description, analysis, 'High', { strength: 7, influence: 9, visibility: 'Public', stability: 'Stable', tone: 'Respect' });
    }
  });

  planets.forEach((planet, index) => {
    const system = starSystems.length ? starSystems[index % starSystems.length] : null;
    if (system) addRelationshipIfPossible(relationships, planet, 'Location', system, 'Location', 'Located In', `${planet.name} orbits within ${system.name}.`, analysis, 'High', { strength: 8, influence: 6, visibility: 'Public', stability: 'Stable', tone: 'Respect' });
    const faction = factions[index % Math.max(1, factions.length)];
    if (faction) addRelationshipIfPossible(relationships, faction, 'Faction', planet, 'Location', analysis.presenceRules?.government === false ? 'Ally' : 'Controls', `${faction.name} has major responsibilities on ${planet.name}.`, analysis, 'Medium', { strength: 5, influence: 8, visibility: 'Public', stability: 'Fragile', tone: 'Respect' });
  });

  characters.forEach((character, index) => {
    const faction = factions.length ? factions[index % factions.length] : null;
    const home = cities.length ? cities[index % cities.length] : planets.length ? planets[index % planets.length] : locations[index % Math.max(1, locations.length)] || null;
    if (faction) addRelationshipIfPossible(relationships, character, 'Character', faction, 'Faction', 'Member Of', `${character.name} belongs to ${faction.name}.`, analysis, 'Medium', { strength: 6, influence: index < factions.length ? 7 : 4, visibility: 'Public', stability: 'Stable', tone: 'Loyalty' });
    if (home) addRelationshipIfPossible(relationships, character, 'Character', home, 'Location', 'Located In', `${character.name} is rooted in ${home.name}.`, analysis, 'Medium', { strength: 5, influence: 3, visibility: 'Public', stability: 'Stable', tone: 'Affection' });
  });

  addCharacterNetworkRelationships(relationships, characters, factions, locations, analysis);

  for (let i = 0; i < factions.length - 1; i++) {
    const type = i % 3 === 0 && !analysis.noWar ? 'Rival' : 'Ally';
    addRelationshipIfPossible(relationships, factions[i], 'Faction', factions[i + 1], 'Faction', type, `${factions[i].name} and ${factions[i + 1].name} define a major ${type.toLowerCase()} axis in the generated setting.`, analysis, 'Medium', {
      strength: type === 'Rival' ? 7 : 6,
      influence: 8,
      visibility: 'Public',
      stability: type === 'Rival' ? 'Volatile' : 'Stable',
      tone: type === 'Rival' ? 'Rivalry' : 'Respect'
    });
  }

  let safety = 0;
  const allEntities = [
    ...characters.map(entity => ({ entity, type: 'Character' })),
    ...factions.map(entity => ({ entity, type: 'Faction' })),
    ...locations.map(entity => ({ entity, type: 'Location' })),
    ...loreNotes.map(entity => ({ entity, type: 'Lore Note' }))
  ];
  while (relationships.length < blueprint.relationships && allEntities.length > 1 && safety < blueprint.relationships * 4) {
    const source = allEntities[safety % allEntities.length];
    const target = allEntities[(safety * 3 + 1) % allEntities.length];
    const type = safety % 5 === 0 && !analysis.noWar ? 'Secret Connection' : safety % 3 === 0 ? 'Ally' : 'Member Of';
    addRelationshipIfPossible(
      relationships,
      source.entity,
      source.type,
      target.entity,
      target.type,
      type,
      `${source.entity.name} and ${target.entity.name} are connected so the generated ${analysis.scaleLabel.toLowerCase()} does not feel isolated.`,
      analysis,
      type === 'Secret Connection' ? 'High' : 'Medium',
      type === 'Secret Connection'
        ? { strength: 7, influence: 7, visibility: 'Secret', stability: 'Fragile', tone: 'Distrust' }
        : { strength: 5, influence: 5, visibility: 'Public', stability: 'Stable', tone: 'Respect' }
    );
    safety += 1;
  }

  conflicts.push(...conflictGenerator({
    faction: factions[0] || createScaleFaction('faction', 0, analysis, usedNames),
    leader: characters[0] || createScaleCharacter(0, analysis, usedNames, factions[0] || null, locations[0] || null),
    supportingCharacter: characters[1] || characters[0] || createScaleCharacter(1, analysis, usedNames, factions[0] || null, locations[0] || null),
    capital: cities[0] || locations[0] || createScaleLocation('location', 0, analysis, usedNames),
    secondaryLocation: cities[1] || locations[1] || locations[0] || createScaleLocation('location', 1, analysis, usedNames)
  }, analysis));
  mysteries.push(...mysteryGenerator({
    faction: factions[0] || createScaleFaction('faction', 1, analysis, usedNames),
    leader: characters[0] || createScaleCharacter(2, analysis, usedNames, factions[0] || null, locations[0] || null),
    supportingCharacter: characters[1] || characters[0] || createScaleCharacter(3, analysis, usedNames, factions[0] || null, locations[0] || null),
    capital: cities[0] || locations[0] || createScaleLocation('location', 2, analysis, usedNames)
  }, analysis));

  const generated = {
    analysis,
    blueprint,
    factions,
    characters,
    locations,
    loreNotes,
    relationships: relationships.slice(0, blueprint.relationships),
    conflicts,
    mysteries,
    expansions: []
  };
  if (worldState) {
    worldState.entityRegistry = [
      ...characters.map(entity => ({ id: entity.id, name: entity.name, type: 'Character', subtype: entity.scaleType || 'citizen' })),
      ...factions.map(entity => ({ id: entity.id, name: entity.name, type: 'Faction', subtype: entity.scaleType || 'faction' })),
      ...locations.map(entity => ({ id: entity.id, name: entity.name, type: 'Location', subtype: entity.scaleType || 'location' })),
      ...loreNotes.map(entity => ({ id: entity.id, name: entity.name, type: 'Lore Note', subtype: entity.scaleType || entity.category || 'lore' }))
    ];
    generated.worldState = worldState;
  }
  generated.expansions = generateScaleExpansions(analysis, generated);
  return generated;
}

function conflictGenerator(generated, analysis) {
  const { faction, leader, supportingCharacter, capital, secondaryLocation } = generated;
  const conflicts = analysis.noWar || analysis.mood === 'cozy'
    ? [
      ['Conflict: The Allocation Debate', `${faction.name} must allocate resources without creating hidden inequality.`, `${leader.name} and ${supportingCharacter.name} disagree over a peaceful policy that affects ${capital.name} and ${secondaryLocation.name}.`],
      ['Conflict: The Representation Question', `${getSpeciesCitizenTerm(analysis)} in ${secondaryLocation.name} want better representation.`, `The dispute is solved through negotiation, design, and civic transparency, not war.`],
      ['Conflict: The Comfort Limit', `${faction.name} promises peace, but comfort is unevenly distributed.`, `${supportingCharacter.name} must reveal the imbalance without turning the society against itself.`]
    ]
    : [
      ['Conflict: The Founding Fracture', `${leader.name}'s authority depends on honoring the oldest civic conditions.`, `${supportingCharacter.name} can expose where the system is drifting away from its population laws, technology base, or public taboos.`],
      ['Conflict: The Local Refusal', `${secondaryLocation.name} resists one demand of ${faction.name}.`, `The refusal begins as a practical dispute, then grows into a test of whether the faction still deserves obedience.`],
      ['Conflict: The Price of Stability', `${faction.name} protects its society by exploiting something it cannot safely lose.`, `Every reform threatens the system that keeps the society functional, forcing characters to choose between justice and stability.`]
    ];
  return conflicts.map(([name, summary, content]) => ({
    ...baseEntityFields(name, summary, analysis.tags),
    category: 'Conflict',
    summary,
    content
  }));
}

function mysteryGenerator(generated, analysis) {
  const bank = THEME_BANKS[analysis.theme];
  const { faction, leader, supportingCharacter, capital } = generated;
  const secret = analysis.magicMode === 'none' || analysis.magicMode === 'none unless requested'
    ? pick(['a civic model is hiding a flawed assumption', 'an archive contains a missing consent record', 'an infrastructure forecast has been quietly edited'])
    : pick(bank.secrets);
  return [
    ['Mystery: The First Condition', secret, `The oldest records in ${capital.name} raise a question about whether ${faction.name}'s public origin story is complete.`],
    ['Mystery: The Missing Witness', `Someone who can confirm ${supportingCharacter.name}'s suspicions has vanished.`, `Their disappearance was staged to look voluntary, but one object left behind points back to ${leader.name}.`],
    ['Mystery: The Quiet Exception', `${faction.name} has one exception to its public rules.`, `Finding the exception reveals whether it is wise adaptation or the first sign of collapse.`]
  ].map(([name, summary, content]) => ({
    ...baseEntityFields(name, summary, analysis.tags),
    category: 'Mystery',
    summary,
    content
  }));
}

function expansionSuggestionGenerator(generated, analysis) {
  const { faction, leader, supportingCharacter, capital, secondaryLocation } = generated;
  if (analysis.noWar || analysis.mood === 'cozy') {
    return [
      `Add a festival or public project in ${capital.name} that shows the society at its best.`,
      `Create an ordinary ${analysis.characterSpecies || 'citizen'} from ${secondaryLocation.name} who reveals a practical need.`,
      `Develop a peaceful neighboring partner with a different solution to the same constraint.`,
      `Add an art, education, or care tradition that only makes sense for ${getSpeciesCitizenTerm(analysis)}.`,
      `Give ${supportingCharacter.name} an ally who solves problems through craft rather than force.`
    ];
  }
  return [
    `Add an opposing power that challenges ${faction.name} without breaking the founding conditions.`,
    `Create an ordinary ${analysis.characterSpecies || 'citizen'} from ${capital.name} who shows the cost of the system.`,
    `Add a public hearing where ${leader.name} must prove the society still obeys its founding constraint.`,
    `Develop ${secondaryLocation.name} with local customs, infrastructure, and one beloved landmark.`,
    `Give ${supportingCharacter.name} an ally who wants the truth for the wrong reason.`
  ];
}

function getGeneratedTextObjects(gen) {
  return [
    ...gen.factions,
    ...gen.characters,
    ...gen.locations,
    ...gen.loreNotes,
    ...gen.relationships,
    ...gen.conflicts,
    ...gen.mysteries
  ];
}

function rewriteForPromptConstraints(text, analysis) {
  if (!text) return text;
  let output = String(text);
  const citizenTerm = getSpeciesCitizenTerm(analysis);
  if (analysis.forbiddenSpecies.includes('human')) {
    output = output
      .replace(/\bhumanity\b/gi, `${citizenTerm} civilization`)
      .replace(/\bhumans\b/gi, citizenTerm)
      .replace(/\bhuman\b/gi, analysis.characterSpecies || citizenTerm)
      .replace(/\bmortals\b/gi, citizenTerm)
      .replace(/\bmortal\b/gi, analysis.characterSpecies || 'citizen')
      .replace(/\bmen\b/gi, citizenTerm)
      .replace(/\bman\b/gi, 'citizen')
      .replace(/\bwomen\b/gi, citizenTerm)
      .replace(/\bwoman\b/gi, 'citizen');
  }
  if (analysis.species === 'cats' && normalizeText(analysis.populationRule).includes('only')) {
    output = output
      .replace(/\bnon-feline\b/gi, 'lost feline')
      .replace(/\bnon feline\b/gi, 'lost feline');
  }
  if (analysis.magicMode === 'none' || analysis.magicMode === 'none unless requested') {
    output = output
      .replace(/\bmagic\b/gi, 'advanced technology')
      .replace(/\bmagical\b/gi, 'technological')
      .replace(/\bspells?\b/gi, 'algorithms')
      .replace(/\bcurses?\b/gi, 'failure modes')
      .replace(/\brituals?\b/gi, 'protocols')
      .replace(/\brites?\b/gi, 'protocols')
      .replace(/\bprophecies\b/gi, 'forecasts')
      .replace(/\bprophecy\b/gi, 'forecast')
      .replace(/\bdivine\b/gi, 'institutional')
      .replace(/\bmiracles?\b/gi, 'breakthroughs')
      .replace(/\bbloodlines?\b/gi, 'lineages');
  }
  if (isHighTechAnalysis(analysis) || analysis.negativeConstraints.includes('not ancient') || analysis.negativeConstraints.includes('not medieval')) {
    output = output
      .replace(/\bancient\b/gi, 'long-running')
      .replace(/\bmedieval\b/gi, 'legacy')
      .replace(/\bcastles?\b/gi, 'habitats')
      .replace(/\bfeudal\b/gi, 'hierarchical')
      .replace(/\bsuccession\b/gi, 'leadership transition');
    if (analysis.government !== 'kingdom') output = output.replace(/\bkingdoms?\b/gi, 'polities');
    if (analysis.negativeConstraints.includes('no kings') || analysis.government !== 'kingdom') {
      output = output
        .replace(/\bkings?\b/gi, 'leaders')
        .replace(/\bqueens?\b/gi, 'leaders')
        .replace(/\bcrowns?\b/gi, 'offices');
    }
  }
  if (analysis.noWar) {
    output = output
      .replace(/\bwars?\b/gi, 'disputes')
      .replace(/\bbattles?\b/gi, 'debates')
      .replace(/\battacks?\b/gi, 'challenges')
      .replace(/\brebellions?\b/gi, 'reform movements')
      .replace(/\bviolent\b/gi, 'intense')
      .replace(/\bconquest\b/gi, 'expansion debate');
  }
  if (analysis.presenceRules?.religion === false) {
    output = output
      .replace(/\breligions?\b/gi, 'philosophical schools')
      .replace(/\bfaiths?\b/gi, 'civic ethics')
      .replace(/\btemples?\b/gi, 'public ethics halls')
      .replace(/\bgods?\b/gi, 'founding principles')
      .replace(/\bdeities\b/gi, 'founding principles')
      .replace(/\bchurches?\b/gi, 'care institutions')
      .replace(/\bcults?\b/gi, 'closed ideological circles')
      .replace(/\bprophets?\b/gi, 'forecasters');
  }
  if (analysis.presenceRules?.family === false) {
    output = output
      .replace(/\bfamilies\b/gi, 'cohorts')
      .replace(/\bfamily\b/gi, 'cohort')
      .replace(/\bhouseholds?\b/gi, 'habitat circles')
      .replace(/\bclans?\b/gi, 'duty circles')
      .replace(/\blineages?\b/gi, 'memory chains')
      .replace(/\bbloodlines?\b/gi, 'record chains')
      .replace(/\binheritance\b/gi, 'duty transfer');
  }
  if (analysis.presenceRules?.government === false) {
    output = output
      .replace(/\bgovernments?\b/gi, 'coordination systems')
      .replace(/\bgovernance\b/gi, 'coordination')
      .replace(/\bgoverns?\b/gi, 'coordinates')
      .replace(/\badministers?\b/gi, 'coordinates')
      .replace(/\bauthorities\b/gi, 'service circles')
      .replace(/\bauthority\b/gi, 'service mandate')
      .replace(/\bcentralized\b/gi, 'single-center')
      .replace(/\bcentral government\b/gi, 'central office')
      .replace(/\bformal government\b/gi, 'formal office');
  }
  return output;
}

const PROMPT_LEAK_REPLACEMENTS = [
  [/\bAI World Architect\b/gi, 'the civic archive'],
  [/\bworld architect\b/gi, 'civic archive'],
  [/\bgenerated worldbuilding package\b/gi, 'world survey'],
  [/\bgenerated world\b/gi, 'world'],
  [/\bgenerated hierarchy\b/gi, 'civic hierarchy'],
  [/\bgenerated setting\b/gi, 'setting'],
  [/\bgenerated scale\b/gi, 'civilizational scale'],
  [/\bgeneration plan\b/gi, 'strategic survey'],
  [/\bgeneration profile\b/gi, 'survey depth'],
  [/\bgenerated by\b/gi, 'recorded by'],
  [/\bgenerated\b/gi, 'established'],
  [/\bgeneration\b/gi, 'formation'],
  [/\btemplates?\b/gi, 'patterns'],
  [/\bconstraints?\b/gi, 'conditions'],
  [/\bpackages?\b/gi, 'archives'],
  [/\brequested output\b/gi, 'documented record'],
  [/\bthe user asked for\b/gi, 'the chronicles describe'],
  [/\buser asked\b/gi, 'chronicles describe'],
  [/\brequested by\b/gi, 'recorded in'],
  [/\brequested\b/gi, 'documented'],
  [/\bthis prompt describes\b/gi, 'the founding records describe'],
  [/\bprompt describes\b/gi, 'founding records describe'],
  [/\bprompt constraints\b/gi, 'founding conditions'],
  [/\bprompt's\b/gi, "society's"],
  [/\boriginal prompt\b/gi, 'founding record'],
  [/\bthe prompt\b/gi, 'the founding record'],
  [/\bprompt\b/gi, 'founding record']
];

function sanitizeImmersiveText(text) {
  if (!text) return text;
  let output = String(text);
  PROMPT_LEAK_REPLACEMENTS.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  return output;
}

function getImmersiveContentText(gen) {
  const contentFields = ['name', 'description', 'notes', 'leader', 'ideology', 'goals', 'allies', 'enemies', 'role', 'profession', 'importanceTier', 'species', 'personality', 'vulnerability', 'fear', 'socialConnection', 'secrets', 'region', 'importance', 'category', 'summary', 'content', 'type'];
  return getGeneratedTextObjects(gen)
    .map(item => contentFields.map(field => item[field] || '').join(' '))
    .join(' ');
}

function ensureUniqueGeneratedNames(gen) {
  const used = new Set();
  const entities = [...gen.factions, ...gen.characters, ...gen.locations, ...gen.loreNotes, ...gen.conflicts, ...gen.mysteries];
  entities.forEach(entity => {
    const original = entity.name || 'Unnamed Entry';
    const cleaned = original.replace(/\s+\d+$/g, '').trim();
    if (used.has(normalizeText(cleaned)) || /\s+\d+$/.test(original)) {
      entity.name = uniqueName(cleaned, used);
    } else {
      used.add(normalizeText(cleaned));
      entity.name = cleaned;
    }
  });
}

function getImmersionIssues(gen) {
  const issues = [];
  const names = [...gen.factions, ...gen.characters, ...gen.locations, ...gen.loreNotes, ...gen.conflicts, ...gen.mysteries].map(item => item.name || '');
  const normalizedNames = names.map(normalizeText);
  if (normalizedNames.some((name, index) => name && normalizedNames.indexOf(name) !== index)) issues.push('Review duplicate names.');
  if (names.some(name => /\s+\d+$/.test(name))) issues.push('Review numbered name suffixes.');
  const descriptions = [...gen.factions, ...gen.characters, ...gen.locations].map(item => normalizeText(item.description)).filter(Boolean);
  if (descriptions.some((description, index) => description && descriptions.indexOf(description) !== index)) issues.push('Review repeated descriptions.');
  const text = normalizeText(getImmersiveContentText(gen));
  if (['prompt', 'user asked', 'ai world architect', 'generated', 'generation', 'template', 'constraints', 'package', 'requested output'].some(phrase => text.includes(phrase))) issues.push('Review prompt leakage.');
  if (gen.analysis.presenceRules?.religion === false && gen.loreNotes.some(item => item.scaleType === 'religion')) issues.push('Review forbidden religion entries.');
  if (gen.analysis.presenceRules?.government === false && gen.factions.some(item => item.scaleType === 'government')) issues.push('Review forbidden formal government entries.');
  if (gen.analysis.presenceRules?.family === false && ['family', 'families'].some(word => text.includes(word))) issues.push('Review forbidden family terms.');
  const countries = gen.locations.filter(item => item.scaleType === 'country');
  const cities = gen.locations.filter(item => item.scaleType === 'city');
  if (countries.length && cities.some(city => !city.parentId)) issues.push('Review city-to-country hierarchy.');
  const planets = gen.locations.filter(item => item.scaleType === 'planet');
  if ((gen.analysis.presenceRules?.planet || gen.analysis.scale === 'world' || gen.analysis.scale === 'galactic') && (!planets.length || planets.some(planet => !planet.planetProfile))) issues.push('Review missing planet profiles.');
  if (gen.factions.length > gen.locations.length + gen.characters.length && gen.analysis.scale !== 'faction') issues.push('Review faction inflation.');
  const entityIds = new Set([
    ...gen.factions,
    ...gen.characters,
    ...gen.locations,
    ...gen.loreNotes
  ].map(item => item.id));
  if (gen.relationships.some(rel => !entityIds.has(rel.sourceId) || !entityIds.has(rel.targetId))) issues.push('Review relationships with missing endpoints.');
  return issues;
}

function getGeneratedBlueprintCounts(gen) {
  return {
    countries: gen.locations.filter(item => item.scaleType === 'country').length,
    cities: gen.locations.filter(item => item.scaleType === 'city').length,
    citizens: gen.characters.length,
    characters: gen.characters.length,
    factions: gen.factions.length,
    continents: gen.locations.filter(item => item.scaleType === 'continent').length,
    religions: gen.loreNotes.filter(item => item.scaleType === 'religion').length,
    philosophies: gen.loreNotes.filter(item => item.scaleType === 'philosophy').length,
    species: gen.loreNotes.filter(item => item.scaleType === 'species').length,
    cosmicDomains: gen.locations.filter(item => item.scaleType === 'cosmicDomain').length,
    sectors: gen.locations.filter(item => item.scaleType === 'sector').length,
    starSystems: gen.locations.filter(item => item.scaleType === 'starSystem').length,
    planets: gen.locations.filter(item => item.scaleType === 'planet').length,
    megastructures: gen.locations.filter(item => item.scaleType === 'megastructure').length,
    relationships: gen.relationships.length
  };
}

function validateBlueprintCounts(gen) {
  const blueprint = gen.analysis.blueprint;
  if (!blueprint) return [];
  const actual = getGeneratedBlueprintCounts(gen);
  const explicit = blueprint.explicit || {};
  const checks = [
    ['countries', explicit.countries !== undefined || explicit.citiesPerCountry !== undefined || explicit.citizensPerCountry !== undefined],
    ['cities', explicit.cities !== undefined || explicit.citiesPerCountry !== undefined],
    ['citizens', explicit.citizens !== undefined || explicit.characters !== undefined || explicit.citizensPerCountry !== undefined],
    ['factions', explicit.factions !== undefined],
    ['continents', explicit.continents !== undefined],
    ['religions', explicit.religions !== undefined],
    ['philosophies', explicit.philosophies !== undefined],
    ['species', explicit.species !== undefined],
    ['cosmicDomains', explicit.cosmicDomains !== undefined],
    ['sectors', explicit.sectors !== undefined],
    ['starSystems', explicit.starSystems !== undefined || explicit.planetsPerSystem !== undefined],
    ['planets', explicit.planets !== undefined || explicit.planetsPerSystem !== undefined],
    ['megastructures', explicit.megastructures !== undefined],
    ['relationships', explicit.relationships !== undefined]
  ];
  const exactWarnings = checks
    .filter(([key, active]) => active && blueprint[key] !== actual[key])
    .map(([key]) => `Requested ${blueprint[key]} ${key}, generated ${actual[key]}.`);
  const minimumWarnings = Object.entries(explicit.minimums || {})
    .filter(([key, value]) => actual[key] !== undefined && actual[key] < value)
    .map(([key, value]) => `Requested at least ${value} ${key}, generated ${actual[key]}.`);
  const maximumWarnings = Object.entries(explicit.maximums || {})
    .filter(([key, value]) => actual[key] !== undefined && actual[key] > value)
    .map(([key, value]) => `Requested at most ${value} ${key}, generated ${actual[key]}.`);
  return [...exactWarnings, ...minimumWarnings, ...maximumWarnings];
}

function validateLargeCharacterQuality(gen) {
  const issues = [];
  const explicit = gen.analysis.blueprint?.explicit || {};
  const requestedCitizens = explicit.citizens || explicit.characters || explicit.exact?.citizens || explicit.exact?.characters || explicit.minimums?.citizens || explicit.minimums?.characters || 0;
  if (requestedCitizens && gen.characters.length < requestedCitizens) issues.push(`Requested ${requestedCitizens} citizens, generated ${gen.characters.length}.`);
  const incomplete = gen.characters.find(character => !character.name || !character.species || !character.role || !character.personality || !character.goals || !character.vulnerability || !character.socialConnection);
  if (incomplete) issues.push('Review incomplete citizen character fields.');
  const majorFigures = gen.characters.filter(character => character.importanceTier === 'Major Figure');
  if (majorFigures.length) {
    const relCounts = gen.relationships.reduce((acc, rel) => {
      acc[rel.sourceId] = (acc[rel.sourceId] || 0) + 1;
      acc[rel.targetId] = (acc[rel.targetId] || 0) + 1;
      return acc;
    }, {});
    if (majorFigures.some(character => (relCounts[character.id] || 0) < 6)) issues.push('Review major figures with too few relationships.');
  }
  const relationshipTypes = new Set(gen.relationships.map(rel => rel.type));
  const requiredTypes = ['Friendship', 'Professional', 'Mentor', 'Secret Connection', 'Rival'];
  if (gen.analysis.presenceRules?.family !== false) requiredTypes.push('Family');
  const missing = requiredTypes.filter(type => !relationshipTypes.has(type) && !(type === 'Rival' && relationshipTypes.has('Rivalry')));
  if (gen.characters.length >= 50 && missing.length) issues.push(`Review relationship diversity; missing ${missing.join(', ')}.`);
  if (gen.analysis.presenceRules?.family === false && relationshipTypes.has('Family')) issues.push('Review forbidden family relationships.');
  if ((gen.analysis.fictionalPlausibility?.impossibleSpecies || []).length && !gen.loreNotes.some(note => note.scaleType === 'internalRules')) issues.push('Review missing plausibility rules for impossible species.');
  if ((gen.analysis.speciesProfiles || []).length && !gen.loreNotes.some(note => note.scaleType === 'habitability')) issues.push('Review missing species habitability logic.');
  return issues;
}

function validateGeneratedPackage(gen) {
  const analysis = gen.analysis;
  const fields = ['name', 'description', 'notes', 'leader', 'ideology', 'goals', 'allies', 'enemies', 'role', 'species', 'personality', 'secrets', 'region', 'importance', 'category', 'summary', 'content', 'type'];
  ensureUniqueGeneratedNames(gen);
  getGeneratedTextObjects(gen).forEach(item => {
    fields.forEach(field => {
      if (typeof item[field] === 'string') item[field] = sanitizeImmersiveText(rewriteForPromptConstraints(item[field], analysis));
    });
  });
  gen.characters.forEach(character => {
    if (analysis.characterSpecies) character.species = analysis.characterSpecies;
  });
  const text = normalizeText(getImmersiveContentText(gen));
  const textWords = text.split(' ');
  const warnings = [];
  const scanGroups = [
    [analysis.forbiddenSpecies.includes('human'), ['human', 'humans', 'mortal', 'man', 'woman'], 'forbidden human terms'],
    [analysis.magicMode === 'none' || analysis.magicMode === 'none unless requested', ['magic', 'spell', 'curse', 'ritual', 'rite', 'prophecy', 'divine', 'miracle'], 'forbidden magic terms'],
    [isHighTechAnalysis(analysis) || analysis.negativeConstraints.includes('not ancient') || analysis.negativeConstraints.includes('not medieval'), ['medieval', 'castle', 'feudal'], 'forbidden pre-modern terms'],
    [analysis.noWar, ['war', 'battle', 'attack', 'rebellion', 'conquest'], 'forbidden war terms'],
    [analysis.presenceRules?.religion === false, ['religion', 'faith', 'temple', 'god', 'deity', 'church'], 'forbidden religion terms'],
    [analysis.presenceRules?.family === false, ['family', 'families', 'household', 'clan'], 'forbidden family terms'],
    [analysis.presenceRules?.government === false, ['government', 'governance', 'govern', 'administer', 'centralized'], 'forbidden formal government terms']
  ];
  scanGroups.forEach(([active, words, label]) => {
    if (active && words.some(word => textWords.includes(word))) warnings.push(`Review ${label}.`);
  });
  warnings.push(...validateBlueprintCounts(gen));
  warnings.push(...validateLargeCharacterQuality(gen));
  warnings.push(...getImmersionIssues(gen));
  analysis.validationWarnings = warnings;
  return gen;
}

function summarizeWorldState(worldState) {
  return {
    scale: worldState.scale,
    scaleLabel: worldState.scaleLabel,
    worldKind: worldState.worldKind,
    genre: worldState.genre,
    technologyLevel: worldState.technologyLevel,
    kardashevType: worldState.kardashevType,
    communicationMode: worldState.communicationMode,
    populationRules: worldState.populationRules,
    planetRules: worldState.planetRules,
    speciesRules: worldState.speciesRules,
    fictionalPlausibility: worldState.fictionalPlausibility,
    internalRules: worldState.internalRules,
    presenceRules: worldState.presenceRules,
    beliefRule: worldState.beliefRule,
    governmentRule: worldState.governmentRule,
    familyRule: worldState.familyRule,
    socialStructureRule: worldState.socialStructureRule,
    blueprint: worldState.blueprint,
    performancePlan: worldState.performancePlan,
    validationIssues: worldState.validationIssues || [],
    engines: worldState.engines.map(engine => engine.label)
  };
}

function createWorldState(prompt, universe, profileOverride = '') {
  const analysis = analyzeWorldPrompt(prompt, profileOverride);
  const usedNames = new Set(getAllUniverseEntities(universe).map(item => normalizeText(item.entity.name)));
  const worldState = {
    id: generateId(),
    analysis,
    originalPrompt: prompt,
    parsedConstraints: analysis.quantityConstraints,
    explicitConstraints: analysis.explicitConstraints,
    negativeConstraints: analysis.negativeConstraints,
    scale: analysis.scale,
    scaleLabel: analysis.scaleLabel,
    worldKind: analysis.worldKind,
    genre: analysis.genre,
    technologyLevel: analysis.technologyLevel,
    kardashevType: analysis.kardashevType,
    speciesRules: {
      species: analysis.species,
      label: analysis.speciesLabel,
      profiles: analysis.speciesProfiles,
      populationRule: analysis.populationRule,
      forbiddenSpecies: analysis.forbiddenSpecies
    },
    populationRules: analysis.populationRules,
    planetRules: analysis.planetRules,
    environmentRules: {
      setting: analysis.setting,
      mood: analysis.mood
    },
    magicRules: {
      mode: analysis.magicMode,
      magicOrTech: analysis.magicOrTech
    },
    governmentRule: analysis.governmentRule,
    cultureRules: {
      cultures: analysis.cultures,
      communicationMode: analysis.communicationMode
    },
    beliefRule: analysis.beliefRule,
    conflictRules: {
      noWar: analysis.noWar,
      mood: analysis.mood
    },
    namingRules: {
      theme: analysis.theme,
      cultures: analysis.cultures?.map(culture => culture.label) || []
    },
    internalRules: analysis.internalRules,
    fictionalPlausibility: analysis.fictionalPlausibility,
    communicationMode: analysis.communicationMode,
    familyRule: analysis.familyRule,
    socialStructureRule: analysis.socialStructureRule,
    presenceRules: analysis.presenceRules,
    alternatives: analysis.worldAlternatives,
    blueprint: analysis.blueprint,
    performancePlan: analysis.performancePlan,
    entityRegistry: [],
    usedNames,
    usedNamesRegistry: Array.from(usedNames),
    validationIssues: [],
    engines: WORLD_ENGINE_MODULES.map(engine => ({ ...engine }))
  };
  analysis.worldState = summarizeWorldState(worldState);
  return worldState;
}

function runWorldEngine(worldState, universe) {
  const generated = generateMultiScaleWorld(worldState.analysis || analyzeWorldPrompt(worldState.originalPrompt), universe, worldState.usedNames, worldState);
  generated.worldState = worldState;
  const validated = validateGeneratedPackage(generated);
  worldState.validationIssues = validated.analysis.validationWarnings || [];
  validated.analysis.worldState = summarizeWorldState(worldState);
  return validated;
}

function generateWorld(prompt, universe, profileOverride = '') {
  const seed = `${Date.now().toString(36)}-${Math.floor(systemRandom.next() * 1e9).toString(36)}`;
  const generationContext = createGenerationContext({
    seed,
    generatorVersion: 'dreamforge-world-seeder-v0.3.4',
    inputPrompt: prompt,
    settings: { profileOverride },
    determinism: 'legacy-boundary-only',
    clock: appClock,
    ids: appIds
  });
  const worldState = createWorldState(prompt, universe, profileOverride);
  worldState.generationRunMetadata = generationContext.metadata;
  worldState.analysis.worldState = summarizeWorldState(worldState);
  const generated = runWorldEngine(worldState, universe);
  generated.generationRunMetadata = generationContext.metadata;
  return generated;
}

function renderAIArchitect() {
  clearMain();
  const universe = getUniverseById(appState.currentUniverseId);
  if (!universe) {
    const warn = document.createElement('p');
    warn.textContent = 'Please select a universe first.';
    mainContent.appendChild(warn);
    return;
  }
  const formDiv = document.createElement('div');
  formDiv.className = 'card architect-panel';
  const title = document.createElement('h2');
  title.textContent = 'AI World Architect';
  formDiv.appendChild(title);
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Create a Type I civilization with 5 countries and 3 cities per country';
  input.className = 'architect-prompt';
  const controls = document.createElement('div');
  controls.className = 'architect-controls';
  const profileSelect = document.createElement('select');
  [
    ['', 'Auto Profile'],
    ['minimal', 'Minimal'],
    ['standard', 'Standard'],
    ['detailed', 'Detailed'],
    ['massive', 'Massive']
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    profileSelect.appendChild(option);
  });
  const generateBtn = document.createElement('button');
  generateBtn.className = 'btn';
  generateBtn.textContent = 'Generate';
  controls.append(profileSelect, generateBtn);
  const resultDiv = document.createElement('div');
  resultDiv.style.marginTop = '1rem';
  formDiv.appendChild(input);
  formDiv.appendChild(controls);
  formDiv.appendChild(resultDiv);
  mainContent.appendChild(formDiv);
  generateBtn.addEventListener('click', () => {
    const prompt = input.value.trim();
    if (!prompt) return;
    const previewAnalysis = analyzeWorldPrompt(prompt, profileSelect.value);
    const plan = previewAnalysis.performancePlan;
    if (plan?.requiresWarning) {
      const warning = `This will create ${plan.citizenTarget.toLocaleString()} character entities in ${plan.estimatedBatches} batch(es). Large generations may be slower on mobile. Continue?`;
      if (!confirm(warning)) return;
    }
    generateBtn.disabled = true;
    resultDiv.textContent = plan?.requiresWarning ? `Generating ${plan.citizenTarget.toLocaleString()} citizens in batches of ${plan.batchSize}...` : 'Generating...';
    setTimeout(() => {
      try {
        const generated = generateWorld(prompt, universe, profileSelect.value);
        resultDiv.textContent = '';
        showGeneratedPreview(generated, universe);
      } finally {
        generateBtn.disabled = false;
      }
    }, 0);
  });
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      generateBtn.click();
    }
  });
}

function showGeneratedPreview(gen, universe) {
  const modal = createModal('Generated Worldbuilding Package');
  modal.content.classList.add('generated-preview-modal');
  const wrapper = document.createElement('div');
  wrapper.className = 'generated-preview';

  const analysisCard = document.createElement('div');
  analysisCard.className = 'generated-summary';
  function appendDefinitionSection(titleText, rows) {
    const title = document.createElement('h4');
    title.textContent = titleText;
    const list = document.createElement('dl');
    list.className = 'constraint-list';
    rows.filter(([, value]) => value !== undefined && value !== null && value !== '').forEach(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = Array.isArray(value) ? value.join(', ') : String(value);
      list.append(term, detail);
    });
    analysisCard.append(title, list);
  }
  function subtypeSummary(items) {
    const counts = items.reduce((acc, item) => {
      const key = item.scaleType || item.category || 'unspecified';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([key, count]) => `${titleCase(key)} ${count}`).join(', ') || 'None';
  }
  function readPlanetProfile() {
    const planet = gen.locations.find(item => item.scaleType === 'planet' && item.planetProfile);
    if (!planet) return null;
    try {
      return JSON.parse(planet.planetProfile);
    } catch (err) {
      return null;
    }
  }
  function readStarSystemProfile() {
    const system = gen.locations.find(item => item.scaleType === 'starSystem' && item.starSystemProfile);
    if (!system) return null;
    try {
      return JSON.parse(system.starSystemProfile);
    } catch (err) {
      return null;
    }
  }
  const constraintTitle = document.createElement('h4');
  constraintTitle.textContent = 'Detected Prompt Constraints';
  analysisCard.appendChild(constraintTitle);
  const constraintList = document.createElement('dl');
  constraintList.className = 'constraint-list';
  [
    ['Scale', `${gen.analysis.scaleLabel} (${gen.analysis.scaleConfidence}% confidence)`],
    ['Generation profile', gen.analysis.generationProfileLabel],
    ['Population estimate', gen.analysis.populationEstimate],
    ['Species', gen.analysis.speciesLabel],
    ['Population rule', gen.analysis.populationRule],
    ['Tech level', `${gen.analysis.kardashevType ? `${gen.analysis.kardashevType}, ` : ''}${gen.analysis.technologyLevel}`],
    ['Kardashev scope', gen.analysis.kardashevScope ? `${gen.analysis.kardashevScope.scaleLabel}: ${gen.analysis.kardashevScope.description}` : 'Not requested'],
    ['Government', gen.analysis.government],
    ['Setting', gen.analysis.setting],
    ['Communication', gen.analysis.communicationMode],
    ['Magic mode', gen.analysis.magicMode],
    ['Mood', gen.analysis.mood],
    ['Belief rule', gen.analysis.beliefRule],
    ['Family rule', gen.analysis.familyRule],
    ['Negative constraints', gen.analysis.negativeConstraints.length ? gen.analysis.negativeConstraints.join(', ') : 'None detected']
  ].forEach(([label, value]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value || 'Unclear: please edit prompt or regenerate.';
    constraintList.append(term, detail);
  });
  analysisCard.appendChild(constraintList);
  appendDefinitionSection('World State', [
    ['World kind', gen.analysis.worldKind],
    ['Engine modules', `${gen.analysis.worldEngineModules?.length || WORLD_ENGINE_MODULES.length} coordinated local engines`],
    ['Parsed quantities', Object.entries(gen.analysis.quantityConstraints || {}).filter(([, value]) => typeof value !== 'object').map(([key, value]) => `${key}: ${value}`).join(', ') || 'Scale defaults'],
    ['Population logic', gen.analysis.populationRules?.label],
    ['Performance plan', `${gen.analysis.performancePlan?.citizenTarget || gen.characters.length} citizens in ${gen.analysis.performancePlan?.estimatedBatches || 1} batch(es) of ${gen.analysis.performancePlan?.batchSize || CHARACTER_BATCH_SIZE}`],
    ['Storage plan', gen.characters.length > LARGE_ENTITY_STORAGE_THRESHOLD || gen.relationships.length > LARGE_ENTITY_STORAGE_THRESHOLD ? 'Large collections will be saved through local chunked persistence.' : 'Inline local persistence'],
    ['Taxonomy', 'Countries/continents/cities as Locations; citizens as Characters; cultures, beliefs, species, and planet records as Lore Notes']
  ]);
  if (gen.analysis.kardashevScope) {
    appendDefinitionSection('Kardashev Structure', [
      ['Scope', gen.analysis.kardashevScope.scaleLabel],
      ['Interpretation', gen.analysis.kardashevScope.description],
      ['Hierarchy', gen.analysis.kardashevScope.level === 2 ? 'One star system with planets, orbital habitats, stellar infrastructure, and local institutions' : gen.analysis.kardashevScope.level >= 4 ? 'Cosmic domains -> sectors -> star systems -> worlds/habitats' : gen.analysis.kardashevScope.level === 3 ? 'Galactic sectors -> star systems -> planets/habitats' : 'Planetary or regional civilization structure'],
      ['Named citizen default', gen.analysis.blueprint?.explicit?.citizens || gen.analysis.blueprint?.explicit?.characters ? 'Explicit prompt count used' : `${gen.analysis.blueprint?.characters || gen.characters.length} representative citizens`],
      ['Relationship sync', `${gen.relationships.length} relationships generated with strength, influence, tone, stability, visibility, and endpoint validation`]
    ]);
  }
  appendDefinitionSection('Species Logic', [
    ['Species profiles', gen.analysis.speciesProfiles?.length ? gen.analysis.speciesProfiles.map(profile => `${profile.characterSpecies}: ${profile.anatomy}`).join(' | ') : gen.analysis.speciesLabel],
    ['Habitat needs', gen.analysis.speciesProfiles?.length ? gen.analysis.speciesProfiles.map(profile => `${profile.characterSpecies}: ${profile.habitat}`).join(' | ') : 'Scale defaults'],
    ['Plausibility rules', gen.analysis.internalRules?.length ? gen.analysis.internalRules.map(rule => `${rule.subject}: ${rule.rule}`).join(' | ') : 'No impossible-world rules required'],
    ['Thriving logic', gen.analysis.planetRules?.thriving ? 'World must visibly support food, shelter, reproduction, care, and social belonging.' : 'Scale-based habitability']
  ]);
  appendDefinitionSection('Presence Rules', [
    ['Religion', gen.analysis.presenceRules?.religion === false ? `Absent; ${gen.analysis.worldAlternatives?.belief}` : gen.analysis.presenceRules?.religion ? 'Present' : 'Optional'],
    ['Philosophies', gen.analysis.blueprint?.philosophies ? `${gen.analysis.blueprint.philosophies} generated` : gen.analysis.presenceRules?.philosophies ? 'Present as alternatives' : 'Optional'],
    ['Government', gen.analysis.presenceRules?.government === false ? `Absent as formal authority; ${gen.analysis.worldAlternatives?.government}` : 'Formal institutions allowed'],
    ['Families', gen.analysis.presenceRules?.family === false ? `Absent; ${gen.analysis.worldAlternatives?.family}` : 'Allowed if culturally appropriate'],
    ['Countries', gen.analysis.presenceRules?.countries === false ? 'Absent unless explicitly requested' : 'Allowed by scale'],
    ['Planet', gen.analysis.presenceRules?.planet ? 'Required' : 'Optional']
  ]);
  if (gen.analysis.blueprint) {
    const blueprintTitle = document.createElement('h4');
    blueprintTitle.textContent = 'World Blueprint';
    const blueprintList = document.createElement('dl');
    blueprintList.className = 'constraint-list blueprint-list';
    [
      ['Countries', gen.analysis.blueprint.countries],
      ['Cities', gen.analysis.blueprint.cities],
      ['Citizens', gen.analysis.blueprint.characters],
      ['Factions', gen.analysis.blueprint.factions],
      ['Continents', gen.analysis.blueprint.continents],
      ['Religions', gen.analysis.blueprint.religions],
      ['Philosophies', gen.analysis.blueprint.philosophies],
      ['Species notes', gen.analysis.blueprint.species],
      ['Cosmic domains', gen.analysis.blueprint.cosmicDomains],
      ['Sectors', gen.analysis.blueprint.sectors],
      ['Star systems', gen.analysis.blueprint.starSystems],
      ['Planets', gen.analysis.blueprint.planets],
      ['Megastructures', gen.analysis.blueprint.megastructures],
      ['Relationships', gen.analysis.blueprint.relationships]
    ].filter(([, value]) => value > 0).forEach(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      blueprintList.append(term, detail);
    });
    analysisCard.append(blueprintTitle, blueprintList);
  }
  const planetProfile = readPlanetProfile();
  const starSystemProfile = readStarSystemProfile();
  if (starSystemProfile) {
    appendDefinitionSection('Star System Profile', [
      ['Name', starSystemProfile.systemName],
      ['Star type', starSystemProfile.starType],
      ['Energy infrastructure', starSystemProfile.primaryEnergy],
      ['Habitable worlds', `${starSystemProfile.habitableWorlds} of ${starSystemProfile.totalPlanets}`],
      ['Orbital habitats', starSystemProfile.orbitalHabitats],
      ['Routes', starSystemProfile.majorRoutes],
      ['Governance', starSystemProfile.governance],
      ['Hazards', starSystemProfile.majorHazards],
      ['Story pressure', starSystemProfile.storyPressure]
    ]);
  }
  if (planetProfile) {
    appendDefinitionSection('Planet Profile', [
      ['Name', planetProfile.planetName],
      ['Type', planetProfile.planetType],
      ['Gravity', planetProfile.gravity],
      ['Surface', `${planetProfile.surfaceWater} water, ${planetProfile.landPercentage} land`],
      ['Continents', `${planetProfile.continentCount} (${planetProfile.continentSizeRange})`],
      ['Climate/Biomes', `${planetProfile.climate}; ${planetProfile.biomes}`],
      ['Population capacity', planetProfile.populationCapacity],
      ['Communication', planetProfile.communicationMode],
      ['Resources', planetProfile.majorResources],
      ['Hazards', planetProfile.majorHazards]
    ]);
  }
  appendDefinitionSection('Generated Hierarchy', [
    ['Locations', subtypeSummary(gen.locations)],
    ['Factions', subtypeSummary(gen.factions)],
    ['Characters', subtypeSummary(gen.characters)],
    ['Lore Notes', subtypeSummary(gen.loreNotes)],
    ['Relationships', `${gen.relationships.length} story-aware links`]
  ]);
  appendDefinitionSection('Validation Status', [
    ['Status', gen.analysis.validationWarnings.length ? `${gen.analysis.validationWarnings.length} warning(s)` : 'Passed local validation'],
    ['Issues', gen.analysis.validationWarnings.length ? gen.analysis.validationWarnings.join(' ') : 'No duplicate names, forbidden systems, count mismatches, hierarchy gaps, or prompt leaks detected.']
  ]);
  if (gen.analysis.unclear.length || gen.analysis.validationWarnings.length) {
    const note = document.createElement('p');
    note.className = 'constraint-note';
    const unclear = gen.analysis.unclear.length ? `Unclear: ${gen.analysis.unclear.join(', ')}. ` : '';
    const warnings = gen.analysis.validationWarnings.length ? `Validation note: ${gen.analysis.validationWarnings.join(' ')}` : '';
    note.textContent = `${unclear}${warnings}`.trim();
    analysisCard.appendChild(note);
  }
  wrapper.appendChild(analysisCard);

  function createField(parent, item, field) {
    const label = document.createElement('label');
    label.textContent = field.label;
    let input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
    } else if (field.type === 'select') {
      input = document.createElement('select');
      field.options.forEach(optionText => {
        const option = document.createElement('option');
        option.value = optionText;
        option.textContent = optionText;
        input.appendChild(option);
      });
    } else if (field.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }
    input.value = item[field.key] || '';
    const updateItemField = () => {
      item[field.key] = field.type === 'number' ? clampRelationshipScore(input.value) : input.value;
      item.updated = new Date().toISOString();
    };
    input.addEventListener('input', updateItemField);
    input.addEventListener('change', updateItemField);
    parent.appendChild(label);
    parent.appendChild(input);
  }

  function createGroup(titleText, items, fields, getTitle) {
    const useAccordion = items.length > 12 || getGeneratedTextObjects(gen).length > 40;
    const section = document.createElement(useAccordion ? 'details' : 'div');
    section.className = 'generated-group';
    items.forEach(item => {
      item._include = item._include !== false;
    });
    const previewLimit = items.length > LARGE_PREVIEW_ITEM_LIMIT ? LARGE_PREVIEW_ITEM_LIMIT : items.length;
    const displayItems = items.slice(0, previewLimit);
    if (useAccordion) {
      section.open = items.length <= 20;
      const summary = document.createElement('summary');
      summary.textContent = `${titleText} (${items.length})`;
      section.appendChild(summary);
    } else {
      const h = document.createElement('h4');
      h.textContent = `${titleText} (${items.length})`;
      section.appendChild(h);
    }
    if (items.length > displayItems.length) {
      const note = document.createElement('p');
      note.className = 'constraint-note';
      note.textContent = `Showing first ${displayItems.length} of ${items.length}. Hidden entries remain included for saving.`;
      section.appendChild(note);
    }
    displayItems.forEach((item, index) => {
      const itemCard = document.createElement('div');
      itemCard.className = 'generated-item';
      const header = document.createElement('label');
      header.className = 'generated-item-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item._include;
      checkbox.addEventListener('change', () => {
        item._include = checkbox.checked;
        itemCard.classList.toggle('excluded', !item._include);
      });
      const labelText = document.createElement('span');
      const subtype = item.scaleType || item.category || '';
      const baseTitle = getTitle ? getTitle(item, index) : item.name || `${titleText} ${index + 1}`;
      labelText.textContent = subtype ? `${baseTitle} (${titleCase(subtype)})` : baseTitle;
      header.appendChild(checkbox);
      header.appendChild(labelText);
      itemCard.appendChild(header);
      fields.forEach(field => createField(itemCard, item, field));
      section.appendChild(itemCard);
    });
    return section;
  }

  function findGeneratedEntity(id) {
    return [...gen.factions, ...gen.characters, ...gen.locations, ...gen.loreNotes, ...gen.conflicts, ...gen.mysteries].find(item => item.id === id);
  }

  wrapper.appendChild(createGroup('Factions', gen.factions, [
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'leader', label: 'Leader' },
    { key: 'ideology', label: 'Ideology', type: 'textarea' },
    { key: 'goals', label: 'Goals', type: 'textarea' }
  ]));
  wrapper.appendChild(createGroup('Characters', gen.characters, [
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'role', label: 'Role' },
    { key: 'species', label: 'Species' },
    { key: 'goals', label: 'Goals', type: 'textarea' },
    { key: 'secrets', label: 'Secrets', type: 'textarea' }
  ]));
  wrapper.appendChild(createGroup('Locations', gen.locations, [
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'region', label: 'Region' },
    { key: 'importance', label: 'Importance', type: 'textarea' }
  ]));
  wrapper.appendChild(createGroup('Lore Notes', gen.loreNotes, [
    { key: 'name', label: 'Name' },
    { key: 'summary', label: 'Summary', type: 'textarea' },
    { key: 'content', label: 'Full Content', type: 'textarea' }
  ]));
  wrapper.appendChild(createGroup('Relationships', gen.relationships, [
    { key: 'type', label: 'Type', type: 'select', options: RELATIONSHIP_TYPES },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'strength', label: 'Strength', type: 'number', min: 1, max: 10, step: 1 },
    { key: 'influence', label: 'Influence', type: 'number', min: 1, max: 10, step: 1 },
    { key: 'visibility', label: 'Visibility', type: 'select', options: RELATIONSHIP_VISIBILITY_OPTIONS },
    { key: 'stability', label: 'Stability', type: 'select', options: RELATIONSHIP_STABILITY_OPTIONS },
    { key: 'tone', label: 'Tone', type: 'select', options: RELATIONSHIP_TONE_OPTIONS },
    { key: 'importance', label: 'Importance' },
    { key: 'tags', label: 'Tags' }
  ], rel => {
    const source = findGeneratedEntity(rel.sourceId);
    const target = findGeneratedEntity(rel.targetId);
    return `${source ? source.name : rel.sourceId} -> ${target ? target.name : rel.targetId}`;
  }));
  wrapper.appendChild(createGroup('Conflicts', gen.conflicts, [
    { key: 'name', label: 'Name' },
    { key: 'summary', label: 'Summary', type: 'textarea' },
    { key: 'content', label: 'Full Content', type: 'textarea' }
  ]));
  wrapper.appendChild(createGroup('Mysteries', gen.mysteries, [
    { key: 'name', label: 'Name' },
    { key: 'summary', label: 'Summary', type: 'textarea' },
    { key: 'content', label: 'Full Content', type: 'textarea' }
  ]));

  const expansionGroup = document.createElement('div');
  expansionGroup.className = 'generated-group';
  const expansionTitle = document.createElement('h4');
  expansionTitle.textContent = 'Next Expansions';
  expansionGroup.appendChild(expansionTitle);
  const expansionList = document.createElement('ul');
  gen.expansions.forEach(expansion => {
    const item = document.createElement('li');
    item.textContent = expansion;
    expansionList.appendChild(item);
  });
  expansionGroup.appendChild(expansionList);
  wrapper.appendChild(expansionGroup);

  modal.body.appendChild(wrapper);
  const actions = document.createElement('div');
  actions.className = 'generated-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    closeModal();
  });
  const regenerateBtn = document.createElement('button');
  regenerateBtn.className = 'btn secondary';
  regenerateBtn.textContent = 'Regenerate';
  regenerateBtn.addEventListener('click', () => {
    const regenerated = generateWorld(gen.analysis.originalPrompt, universe, gen.analysis.generationProfile);
    closeModal();
    showGeneratedPreview(regenerated, universe);
  });
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn';
  saveBtn.textContent = 'Save Approved';
  const saveStatus = document.createElement('span');
  saveStatus.className = 'save-status';

  function cloneForSave(item) {
    const copy = { ...item };
    delete copy._include;
    return copy;
  }

  function appendClonedItemsInBatches(target, items) {
    for (let start = 0; start < items.length; start += STORAGE_ENTITY_CHUNK_SIZE) {
      const batch = items.slice(start, start + STORAGE_ENTITY_CHUNK_SIZE).map(cloneForSave);
      target.push(...batch);
    }
  }

  saveBtn.addEventListener('click', () => {
    saveBtn.disabled = true;
    regenerateBtn.disabled = true;
    saveStatus.textContent = 'Saving approved content in batches...';
    setTimeout(() => {
      try {
        const includedFactions = gen.factions.filter(item => item._include !== false);
        const includedCharacters = gen.characters.filter(item => item._include !== false);
        const includedLocations = gen.locations.filter(item => item._include !== false);
        const includedLore = [...gen.loreNotes, ...gen.conflicts, ...gen.mysteries].filter(item => item._include !== false);
        const savedEntityIds = new Set([...includedFactions, ...includedCharacters, ...includedLocations, ...includedLore].map(item => item.id));
        includedLocations.forEach(location => {
          location.associatedFactions = (location.associatedFactions || []).filter(id => savedEntityIds.has(id));
        });
        appendClonedItemsInBatches(universe.factions, includedFactions);
        appendClonedItemsInBatches(universe.characters, includedCharacters);
        appendClonedItemsInBatches(universe.locations, includedLocations);
        appendClonedItemsInBatches(universe.loreNotes, includedLore);
        appendClonedItemsInBatches(
          universe.relationships,
          gen.relationships.filter(rel => rel._include !== false && savedEntityIds.has(rel.sourceId) && savedEntityIds.has(rel.targetId))
        );
        if (gen.generationRunMetadata) {
          universe.generatorRuns = Array.isArray(universe.generatorRuns) ? universe.generatorRuns : [];
          universe.generatorRuns.push(gen.generationRunMetadata);
        }
        universe.updated = new Date().toISOString();
        saveData();
        closeModal();
        alert('Generated content saved to universe.');
        renderAIArchitect();
      } catch (err) {
        console.error('Failed to save generated content', err);
        saveStatus.textContent = 'Save failed. Check available browser storage and try a smaller batch.';
        saveBtn.disabled = false;
        regenerateBtn.disabled = false;
      }
    }, 0);
  });
  actions.append(cancelBtn, regenerateBtn, saveBtn, saveStatus);
  modal.body.appendChild(actions);
  showModal(modal);
}

/**
 * Render Settings page (export/import)
 */
function renderSettings() {
  clearMain();
  const container = document.createElement('div');
  container.className = 'card';
  const title = document.createElement('h2');
  title.textContent = 'Settings';
  container.appendChild(title);
  // Export button
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn';
  exportBtn.textContent = 'Export Data';
  exportBtn.addEventListener('click', () => {
    const exported = DreamForgeStorage.exportState(appState);
    if (!exported.ok) {
      alert(exported.error.message);
      return;
    }
    const dataStr = exported.value;
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dreamforge_data.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  // Import input
  const importLabel = document.createElement('label');
  importLabel.textContent = 'Import Data:';
  importLabel.style.marginTop = '1rem';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json';
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result !== 'string') {
        alert('Failed to read file.');
        return;
      }
      if (confirm('Importing will overwrite your current data. Proceed?')) {
        const imported = DreamForgeStorage.importState(evt.target.result);
        if (!imported.ok) {
          alert(imported.error.message);
          return;
        }
        appState = imported.value.state;
        rebuildAllUniverseIndexes(appState);
        alert('Data imported successfully!');
        renderPage();
      }
    };
    reader.readAsText(file);
  });
  container.appendChild(exportBtn);
  container.appendChild(importLabel);
  container.appendChild(importInput);
  mainContent.appendChild(container);
}

/**
 * Utility: clear main content area
 */
function clearMain() {
  mainContent.innerHTML = '';
}

/**
 * Modal factory
 */
function createModal(titleText) {
  const modalContent = document.createElement('div');
  modalContent.className = 'modal';
  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = titleText;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', closeModal);
  header.appendChild(title);
  header.appendChild(closeBtn);
  modalContent.appendChild(header);
  const body = document.createElement('div');
  modalContent.appendChild(body);
  return { content: modalContent, body };
}

/**
 * Show modal
 */
function showModal(modal) {
  modalContainer.innerHTML = '';
  modalContainer.appendChild(modal.content);
  modalContainer.classList.remove('hidden');
}

/**
 * Close modal
 */
function closeModal() {
  modalContainer.classList.add('hidden');
  modalContainer.innerHTML = '';
}
