import { err, ok, type Result } from "./result.ts";

export const safeClone = <T>(value: T): Result<T> => {
  try {
    return ok(structuredClone(value));
  } catch (cause) {
    return err("CLONE_FAILED", "The value could not be safely cloned.", cause);
  }
};
