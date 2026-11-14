export interface ProvenanceRecord {
  id: string;
  sourceKind: "creator" | "derived" | "imported";
  sourceIds: string[];
  rule: string;
  createdAt: string;
}
export interface WorldEvent {
  id: string;
  universeId: string;
  occurredAt: string;
  kind: string;
  payload: Readonly<Record<string, unknown>>;
  provenanceId: string;
}
export interface Observation {
  id: string;
  eventId: string;
  observerId: string;
  observedAt: string;
  details: Readonly<Record<string, unknown>>;
}
export interface Memory {
  id: string;
  characterId: string;
  observationId: string;
  rememberedAt: string;
  salience: number;
}
export interface Belief {
  id: string;
  holderId: string;
  claim: string;
  confidence: number;
  provenanceIds: string[];
}
export interface Testimony {
  id: string;
  speakerId: string;
  listenerId: string;
  beliefId: string;
  transmittedAt: string;
  distortion?: string;
}
export interface RelationshipChange {
  id: string;
  relationshipId: string;
  eventId: string;
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
}
export interface SimulationRun {
  id: string;
  universeId: string;
  seed: string;
  startedAt: string;
  autonomyLevel: string;
  proposedEventIds: string[];
}
export interface CreatorIntervention {
  id: string;
  universeId: string;
  action: "approve" | "reject" | "amend";
  targetId: string;
  createdAt: string;
}
export interface RecapItem {
  id: string;
  universeId: string;
  eventIds: string[];
  summary: string;
  createdAt: string;
}
export interface WorldCheckpoint {
  id: string;
  universeId: string;
  throughEventId: string;
  projectionVersion: number;
  createdAt: string;
}

export interface EventLedgerPort {
  appendProposed(
    events: readonly WorldEvent[],
    run: SimulationRun,
  ): Promise<void>;
  readUniverse(universeId: string): Promise<readonly WorldEvent[]>;
}
