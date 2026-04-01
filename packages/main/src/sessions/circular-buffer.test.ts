import { expect, it } from "vitest";

import { CircularBuffer } from "./circular-buffer";

it("CircularBuffer evicts the oldest values when capacity is exceeded", () => {
  const buffer = new CircularBuffer<string>(3);

  buffer.push("one");
  buffer.push("two");
  buffer.push("three");
  buffer.push("four");

  expect(buffer.toArray()).toEqual(["two", "three", "four"]);
  expect(buffer.last(2)).toEqual(["three", "four"]);
});
