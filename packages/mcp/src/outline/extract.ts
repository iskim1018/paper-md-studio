export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface OutlineNode {
  readonly level: HeadingLevel;
  readonly text: string;
  readonly anchor: string;
  readonly line: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^(\s{0,3})(```+|~~~+)/;

function slugify(input: string): string {
  const normalized = input.normalize("NFKC");
  const stripped = normalized
    .replace(/[\s ]+/g, "-")
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return stripped;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

function uniqueAnchor(base: string, used: Map<string, number>): string {
  const key = base === "" ? "section" : base;
  const count = used.get(key) ?? 0;
  used.set(key, count + 1);
  return count === 0 ? key : `${key}-${count}`;
}

export function extractOutline(markdown: string): ReadonlyArray<OutlineNode> {
  const lines = markdown.split(/\r?\n/);
  const used = new Map<string, number>();
  const nodes: Array<OutlineNode> = [];

  let fenceDelim: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const fenceMatch = raw.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[2] ?? "";
      if (fenceDelim === null) {
        fenceDelim = marker[0] ?? null;
      } else if (marker[0] === fenceDelim) {
        fenceDelim = null;
      }
      continue;
    }

    if (fenceDelim !== null) {
      continue;
    }

    const match = raw.match(HEADING_RE);
    if (!match) {
      continue;
    }

    const hashes = match[1] ?? "";
    const textRaw = match[2] ?? "";
    const level = hashes.length as HeadingLevel;
    const text = stripMarkdown(textRaw).trim();
    if (text.length === 0) {
      continue;
    }
    const anchor = uniqueAnchor(slugify(text), used);
    nodes.push({ level, text, anchor, line: i });
  }

  return nodes;
}
