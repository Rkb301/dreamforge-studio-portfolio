export interface AppError {
  code: string;
  message: string;
  cause?: unknown;
  details?: Readonly<Record<string, unknown>>;
}

export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (
  code: string,
  message: string,
  cause?: unknown,
): Result<never> => ({
  ok: false,
  error: cause === undefined ? { code, message } : { code, message, cause },
});
