import type { Clock } from "./clock.ts";
import type { RandomSource } from "./random.ts";

export interface IdFactory {
  next(prefix?: string): string;
}

export class StableIdFactory implements IdFactory {
  #counter = 0;

  constructor(private readonly namespace = "test") {}

  next(prefix = "id"): string {
    this.#counter += 1;
    return `${prefix}-${this.namespace}-${String(this.#counter).padStart(4, "0")}`;
  }
}

export class RuntimeIdFactory implements IdFactory {
  constructor(
    private readonly clock: Clock,
    private readonly random: RandomSource,
  ) {}

  next(prefix = "id"): string {
    const time = this.clock.now().valueOf().toString(36);
    const random = Math.floor(this.random.next() * 36 ** 8)
      .toString(36)
      .padStart(8, "0");
    return `${prefix}-${time}-${random}`;
  }
}
