import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
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

    return {
      html: result.value,
      markdown: null,
      images,
    };
  }
}
