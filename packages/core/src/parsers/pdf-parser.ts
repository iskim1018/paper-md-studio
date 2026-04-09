import { readFile } from "node:fs/promises";
import type { ParseOptions, ParseResult, Parser } from "../types.js";

export class PdfParser implements Parser {
  /**
   * PDF를 Markdown으로 변환합니다.
   * 참고: @opendocsg/pdf2md는 이미지 추출을 지원하지 않아 images는 항상 빈 배열입니다.
   */
  async parse(inputPath: string, _options: ParseOptions): Promise<ParseResult> {
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
