import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { htmlToMarkdownKeepingTables } from "../html-to-md.js";
import {
  createImageAsset,
  extFromMime,
  makeImageName,
} from "../image-utils.js";
import type {
  ImageAsset,
  ParseOptions,
  ParseResult,
  Parser,
} from "../types.js";
import { normalizeHtmlTablesToGfm } from "./html-tables-to-gfm.js";

export class DocxParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    const images: Array<ImageAsset> = [];
    let imageIndex = 0;

    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement((image) => {
          return image.read("base64").then((base64Data) => {
            imageIndex += 1;
            const ext = extFromMime(image.contentType);
            const imageName = makeImageName(imageIndex, ext);
            const binaryData = Uint8Array.from(atob(base64Data), (c) =>
              c.charCodeAt(0),
            );

            images.push(
              createImageAsset(imageName, binaryData, image.contentType),
            );

            return { src: `./${options.imagesDirName}/${imageName}` };
          });
        }),
      },
    );

    // Word 병합 셀(gridSpan/vMerge)은 mammoth가 colspan/rowspan HTML로
    // 복원하지만, turndown-plugin-gfm은 이를 버리고 셀 안 <p>마다 줄바꿈을
    // 내어 표가 통째로 깨진다. 표만 HTML 원형으로 남겨 두었다가
    // HWPX/kordoc 경로와 같은 계약(grid 정규화 + 병합 화살표 + 1행 1줄)의
    // GFM으로 내린다. html은 뷰어용으로 mammoth 원본을 유지한다.
    const markdown = normalizeHtmlTablesToGfm(
      htmlToMarkdownKeepingTables(result.value),
    );

    return {
      html: result.value,
      markdown,
      images,
    };
  }
}
