import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import type { ParseResult, Parser } from "../types.js";

export class DocxParser implements Parser {
  async parse(inputPath: string): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    const result = await mammoth.convertToHtml({ buffer });

    return {
      html: result.value,
      markdown: null,
      images: [],
    };
  }
}
