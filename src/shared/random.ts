export interface RandomSource {
  next(): number;
  integer(minInclusive: number, maxInclusive: number): number;
  pick<T>(values: readonly T[]): T;
}

const hashSeed = (seed: string | number): number => {
  if (typeof seed === "number") return seed >>> 0;
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export class SeededRandom implements RandomSource {
  #state: number;

  constructor(seed: string | number) {
    this.#state = hashSeed(seed) || 0x6d2b79f5;
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  integer(minInclusive: number, maxInclusive: number): number {
    if (
      !Number.isInteger(minInclusive) ||
      !Number.isInteger(maxInclusive) ||
      minInclusive > maxInclusive
    ) {
      throw new Error("Random integer bounds must be ordered integers");
    }
    return (
      Math.floor(this.next() * (maxInclusive - minInclusive + 1)) + minInclusive
    );
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0)
      throw new Error("Cannot pick from an empty collection");
    const value = values[this.integer(0, values.length - 1)];
    if (value === undefined) throw new Error("Random selection failed");
    return value;
  }
}

export class SystemRandom implements RandomSource {
  next(): number {
    return Math.random();
  }

  integer(minInclusive: number, maxInclusive: number): number {
    return (
      Math.floor(this.next() * (maxInclusive - minInclusive + 1)) + minInclusive
    );
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0)
      throw new Error("Cannot pick from an empty collection");
    const value = values[this.integer(0, values.length - 1)];
    if (value === undefined) throw new Error("Random selection failed");
    return value;
  }
}

export const systemRandom: RandomSource = new SystemRandom();
