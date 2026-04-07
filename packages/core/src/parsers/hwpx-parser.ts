import { readFile } from "node:fs/promises";
import { HwpxReader } from "@ssabrojs/hwpxjs";
import type { ParseResult, Parser } from "../types.js";

export class HwpxParser implements Parser {
  async parse(inputPath: string): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    const reader = new HwpxReader();
    await reader.loadFromArrayBuffer(buffer.buffer as ArrayBuffer);

    const html = await reader.extractHtml({
      renderTables: true,
      renderStyles: false,
      renderImages: false,
      embedImages: false,
    });

    return {
      html,
      markdown: null,
      images: [],
    };
  }
}
