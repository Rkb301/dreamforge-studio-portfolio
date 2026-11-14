// Preserved procedural World Seeder and analysis; no UI or storage side effects.
import * as RelationshipDomain from '../src/relationships/domain.ts';
import { createGenerationContext } from '../src/generation/context.ts';
import { systemClock } from '../src/shared/clock.ts';
import { RuntimeIdFactory } from '../src/shared/id.ts';
import { systemRandom } from '../src/shared/random.ts';

const appClock = systemClock;

const appIds = new RuntimeIdFactory(appClock, systemRandom);

const RELATIONSHIP_CATEGORY_DEFS = RelationshipDomain.RELATIONSHIP_CATEGORY_DEFS;

function generateId() {
  return appIds.next();
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

function getRelationshipIntelligence(rel) {
  return RelationshipDomain.getRelationshipIntelligence(rel);
}

function buildRelationshipIndex(relationships = []) {
  return RelationshipDomain.buildRelationshipIndex(relationships, appClock);
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

export { generateWorld, analyzeWorldPrompt, answerWorldbuildingQuestion, getRelationshipIntelligence, buildRelationshipIndex, findShortestRelationshipPath, generateRelationshipInsights, getRelationshipDashboard, getEntityById, getAllUniverseEntities, getCentralEntities, getIsolatedEntities, detectMissingDetails, suggestNextBuildSteps, getGeneratedBlueprintCounts };
