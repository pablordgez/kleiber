import test from "node:test";
import assert from "node:assert/strict";

import { CircularBuffer } from "./circular-buffer.js";

test("CircularBuffer evicts the oldest values when capacity is exceeded", () => {
  const buffer = new CircularBuffer<string>(3);

  buffer.push("one");
  buffer.push("two");
  buffer.push("three");
  buffer.push("four");

  assert.deepEqual(buffer.toArray(), ["two", "three", "four"]);
  assert.deepEqual(buffer.last(2), ["three", "four"]);
});
