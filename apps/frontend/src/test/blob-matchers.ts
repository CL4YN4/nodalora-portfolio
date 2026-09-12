import { expect } from "vitest";

export function blobLike(type?: string) {
  return expect.objectContaining({
    arrayBuffer: expect.any(Function),
    size: expect.any(Number),
    slice: expect.any(Function),
    type: type ?? expect.any(String),
  });
}
