import { extractOutline, type OutlineNode } from "./extract.js";

export type ChunkSelector =
  | { readonly anchor: string }
  | { readonly headingPath: ReadonlyArray<string> }
  | { readonly range: { readonly start: number; readonly end: number } };

export interface ChunkResult {
  readonly markdown: string;
  readonly anchor: string | null;
  readonly headingPath: ReadonlyArray<string>;
  readonly range: { readonly start: number; readonly end: number };
  readonly neighbors: {
    readonly prev: string | null;
    readonly next: string | null;
  };
}

function findByAnchor(
  outline: ReadonlyArray<OutlineNode>,
  anchor: string,
): number {
  return outline.findIndex((node) => node.anchor === anchor);
}

function findByHeadingPath(
  outline: ReadonlyArray<OutlineNode>,
  path: ReadonlyArray<string>,
): number {
  if (path.length === 0) {
    return -1;
  }

  const stack: Array<OutlineNode> = [];
  for (let i = 0; i < outline.length; i += 1) {
    const node = outline[i];
    if (!node) {
      continue;
    }
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top && top.level >= node.level) {
        stack.pop();
      } else {
        break;
      }
    }
    stack.push(node);

    if (stack.length !== path.length) {
      continue;
    }
    let matches = true;
    for (let j = 0; j < path.length; j += 1) {
      const target = path[j];
      const frame = stack[j];
      if (!frame || !target || frame.text !== target) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return i;
    }
  }
  return -1;
}

function buildHeadingPath(
  outline: ReadonlyArray<OutlineNode>,
  index: number,
): ReadonlyArray<string> {
  const target = outline[index];
  if (!target) {
    return [];
  }
  const path: Array<string> = [target.text];
  let currentLevel = target.level;
  for (let i = index - 1; i >= 0 && currentLevel > 1; i -= 1) {
    const node = outline[i];
    if (!node) {
      continue;
    }
    if (node.level < currentLevel) {
      path.unshift(node.text);
      currentLevel = node.level;
    }
  }
  return path;
}

export function extractChunk(
  markdown: string,
  selector: ChunkSelector,
): ChunkResult | null {
  const lines = markdown.split(/\r?\n/);

  if ("range" in selector) {
    const start = Math.max(0, selector.range.start);
    const end = Math.min(lines.length, selector.range.end);
    if (start >= end) {
      return null;
    }
    return {
      markdown: lines.slice(start, end).join("\n"),
      anchor: null,
      headingPath: [],
      range: { start, end },
      neighbors: { prev: null, next: null },
    };
  }

  const outline = extractOutline(markdown);
  if (outline.length === 0) {
    return null;
  }

  const index =
    "anchor" in selector
      ? findByAnchor(outline, selector.anchor)
      : findByHeadingPath(outline, selector.headingPath);
  if (index === -1) {
    return null;
  }

  const target = outline[index];
  if (!target) {
    return null;
  }
  const nextSameOrHigher = outline.findIndex(
    (node, i) => i > index && node.level <= target.level,
  );
  const startLine = target.line;
  const endLine =
    nextSameOrHigher === -1
      ? lines.length
      : (outline[nextSameOrHigher]?.line ?? lines.length);

  const prevNode = index > 0 ? outline[index - 1] : null;
  const nextNode = index < outline.length - 1 ? outline[index + 1] : null;

  return {
    markdown: lines.slice(startLine, endLine).join("\n"),
    anchor: target.anchor,
    headingPath: buildHeadingPath(outline, index),
    range: { start: startLine, end: endLine },
    neighbors: {
      prev: prevNode ? prevNode.anchor : null,
      next: nextNode ? nextNode.anchor : null,
    },
  };
}
