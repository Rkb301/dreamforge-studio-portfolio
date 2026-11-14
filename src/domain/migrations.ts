import { CURRENT_SCHEMA_VERSION } from "../shared/schemaVersion.ts";

export interface MigrationReport {
  value: Record<string, unknown>;
  applied: string[];
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
export const migrateToCurrentSchema = (input: unknown): MigrationReport => {
  const value = record(input);
  const applied: string[] = [];
  let version = Number.isInteger(value.storageVersion)
    ? Number(value.storageVersion)
    : 0;
  if (version < 1) {
    value.universes = Array.isArray(value.universes) ? value.universes : [];
    value.currentUniverseId ??= null;
    version = 1;
    applied.push("0-to-1: establish app-state collections");
  }
  if (version < 2) {
    version = 2;
    applied.push("1-to-2: establish v0.3.4 storage manifest boundary");
  }
  if (version < 3) {
    version = 3;
    applied.push(
      "2-to-3: add generator-run metadata and rebuildable projections",
    );
  }
  value.storageVersion = Math.max(version, CURRENT_SCHEMA_VERSION);
  return { value, applied };
};
