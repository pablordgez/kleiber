export class CircularBuffer<T> {
  readonly #capacity: number;
  readonly #items: T[];
  #head = 0;
  #size = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("CircularBuffer capacity must be a positive integer.");
    }

    this.#capacity = capacity;
    this.#items = new Array<T>(capacity);
  }

  get capacity(): number {
    return this.#capacity;
  }

  get size(): number {
    return this.#size;
  }

  push(value: T): void {
    const index = (this.#head + this.#size) % this.#capacity;
    this.#items[index] = value;

    if (this.#size < this.#capacity) {
      this.#size += 1;
      return;
    }

    this.#head = (this.#head + 1) % this.#capacity;
  }

  clear(): void {
    this.#head = 0;
    this.#size = 0;
  }

  toArray(): T[] {
    return this.last(this.#size);
  }

  last(limit = this.#size): T[] {
    if (limit <= 0 || this.#size === 0) {
      return [];
    }

    const clampedLimit = Math.min(limit, this.#size);
    const start = (this.#head + this.#size - clampedLimit + this.#capacity) % this.#capacity;
    const values: T[] = [];

    for (let index = 0; index < clampedLimit; index += 1) {
      values.push(this.#items[(start + index) % this.#capacity] as T);
    }

    return values;
  }
}
