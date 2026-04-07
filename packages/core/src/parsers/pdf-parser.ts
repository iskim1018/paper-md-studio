import { readFile } from "node:fs/promises";
import type { ParseResult, Parser } from "../types.js";

export class PdfParser implements Parser {
  async parse(inputPath: string): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pdf2md = (await import("@opendocsg/pdf2md")).default;
    const markdown: string = await pdf2md(buffer);

    return {
      html: null,
      markdown,
      images: [],
    };
  }
}
