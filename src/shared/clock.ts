export interface Clock {
  now(): Date;
  nowIso(): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

export class FixedClock implements Clock {
  readonly #instant: Date;

  constructor(instant: string | Date) {
    this.#instant = new Date(instant);
    if (Number.isNaN(this.#instant.valueOf()))
      throw new Error("FixedClock requires a valid instant");
  }

  now(): Date {
    return new Date(this.#instant);
  }

  nowIso(): string {
    return this.#instant.toISOString();
  }
}

export const systemClock: Clock = new SystemClock();
