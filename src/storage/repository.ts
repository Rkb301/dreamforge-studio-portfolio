import type { AppState, ValidationIssue } from "../domain/schema.ts";
import type { Result } from "../shared/result.ts";
export interface LoadReport {
  state: AppState;
  issues: ValidationIssue[];
  migrations: string[];
}
export interface AppStateRepository {
  load(): Result<LoadReport>;
  save(state: AppState): Result<void>;
  exportJson(state: AppState): Result<string>;
  importJson(json: string): Result<LoadReport>;
  clear(): Result<void>;
}
