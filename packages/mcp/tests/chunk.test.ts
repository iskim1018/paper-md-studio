import { describe, expect, test } from "vitest";
import { extractChunk } from "../src/outline/chunk.js";

const SAMPLE = `# Intro

intro body

## First

first body line 1
first body line 2

### First Deep

nested body

## Second

second body

# Top Two

top two body
`;

describe("extractChunk", () => {
  test("returns null for unknown anchor", () => {
    expect(extractChunk(SAMPLE, { anchor: "nonexistent" })).toBeNull();
  });

  test("slices from heading to next same-or-higher level (h2 → stops at next h2)", () => {
    const result = extractChunk(SAMPLE, { anchor: "first" });
    expect(result).not.toBeNull();
    expect(result?.markdown).toContain("## First");
    expect(result?.markdown).toContain("### First Deep");
    expect(result?.markdown).toContain("nested body");
    expect(result?.markdown).not.toContain("## Second");
  });

  test("slices top-level h1 until next h1", () => {
    const result = extractChunk(SAMPLE, { anchor: "intro" });
    expect(result?.markdown).toContain("## Second");
    expect(result?.markdown).not.toContain("# Top Two");
  });

  test("reports prev/next neighbors by anchor", () => {
    const result = extractChunk(SAMPLE, { anchor: "first" });
    expect(result?.neighbors.prev).toBe("intro");
    expect(result?.neighbors.next).toBe("first-deep");
  });

  test("builds heading path from ancestors", () => {
    const result = extractChunk(SAMPLE, { anchor: "first-deep" });
    expect(result?.headingPath).toEqual(["Intro", "First", "First Deep"]);
  });

  test("supports lookup by heading path", () => {
    const result = extractChunk(SAMPLE, {
      headingPath: ["Intro", "First", "First Deep"],
    });
    expect(result?.anchor).toBe("first-deep");
  });

  test("range selector returns raw line slice", () => {
    const result = extractChunk(SAMPLE, { range: { start: 0, end: 2 } });
    expect(result?.markdown).toBe("# Intro\n");
    expect(result?.anchor).toBeNull();
    expect(result?.range).toEqual({ start: 0, end: 2 });
  });

  test("returns null for empty / inverted range", () => {
    expect(extractChunk(SAMPLE, { range: { start: 5, end: 5 } })).toBeNull();
    expect(extractChunk(SAMPLE, { range: { start: 10, end: 3 } })).toBeNull();
  });
});
