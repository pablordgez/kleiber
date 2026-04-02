import { describe, it, expect } from "vitest";
import { CircularBuffer } from "../circular-buffer";

describe("CircularBuffer", () => {
  describe("constructor validation", () => {
    it("throws for capacity of 0", () => {
      expect(() => new CircularBuffer(0)).toThrow();
    });

    it("throws for negative capacity", () => {
      expect(() => new CircularBuffer(-1)).toThrow();
    });

    it("throws for non-integer capacity", () => {
      expect(() => new CircularBuffer(1.5)).toThrow();
    });

    it("accepts capacity of 1", () => {
      expect(() => new CircularBuffer(1)).not.toThrow();
    });
  });

  describe("push and toArray", () => {
    it("appends items and reads them back in order", () => {
      const buf = new CircularBuffer<number>(5);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      expect(buf.toArray()).toEqual([1, 2, 3]);
    });

    it("returns empty array when nothing is pushed", () => {
      const buf = new CircularBuffer<string>(4);
      expect(buf.toArray()).toEqual([]);
    });

    it("evicts oldest item when capacity is exceeded", () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      buf.push(4);
      expect(buf.toArray()).toEqual([2, 3, 4]);
    });

    it("toArray returns items in insertion order after multiple evictions", () => {
      const buf = new CircularBuffer<string>(4);
      ["a", "b", "c", "d", "e"].forEach((x) => buf.push(x));
      expect(buf.toArray()).toEqual(["b", "c", "d", "e"]);
    });

    it("handles single-capacity buffer correctly", () => {
      const buf = new CircularBuffer<number>(1);
      buf.push(10);
      buf.push(20);
      expect(buf.toArray()).toEqual([20]);
    });
  });

  describe("last()", () => {
    it("returns the last n items", () => {
      const buf = new CircularBuffer<number>(5);
      [1, 2, 3, 4, 5].forEach((x) => buf.push(x));
      expect(buf.last(3)).toEqual([3, 4, 5]);
    });

    it("returns all items when limit > size", () => {
      const buf = new CircularBuffer<number>(5);
      buf.push(1);
      buf.push(2);
      expect(buf.last(10)).toEqual([1, 2]);
    });

    it("returns empty array for limit of 0", () => {
      const buf = new CircularBuffer<number>(5);
      buf.push(1);
      expect(buf.last(0)).toEqual([]);
    });

    it("returns empty array when buffer is empty", () => {
      const buf = new CircularBuffer<number>(5);
      expect(buf.last(3)).toEqual([]);
    });
  });

  describe("size and capacity", () => {
    it("size starts at 0", () => {
      const buf = new CircularBuffer<number>(3);
      expect(buf.size).toBe(0);
    });

    it("size tracks number of items up to capacity", () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      expect(buf.size).toBe(1);
      buf.push(2);
      buf.push(3);
      expect(buf.size).toBe(3);
    });

    it("size stays at capacity after eviction", () => {
      const buf = new CircularBuffer<number>(3);
      [1, 2, 3, 4].forEach((x) => buf.push(x));
      expect(buf.size).toBe(3);
    });

    it("capacity property reflects constructor argument", () => {
      const buf = new CircularBuffer<number>(7);
      expect(buf.capacity).toBe(7);
    });
  });

  describe("clear()", () => {
    it("resets size to 0", () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.clear();
      expect(buf.size).toBe(0);
    });

    it("toArray returns empty after clear", () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      buf.clear();
      expect(buf.toArray()).toEqual([]);
    });

    it("can push new items after clear", () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.clear();
      buf.push(99);
      expect(buf.toArray()).toEqual([99]);
    });
  });
});
