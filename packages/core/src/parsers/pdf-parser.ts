import { readFile } from "node:fs/promises";
import type { ParseOptions, ParseResult, Parser } from "../types.js";
import { cleanupPdfMarkdown, hasExtractableText } from "./pdf-postprocess.js";
import {
  dedupeOverlappingRuns,
  mergeAdjacentRuns,
  type PdfTextRun,
} from "./pdf-text-runs.js";

/**
 * pdf2md 의 `pageParsed` 가 넘겨주는 페이지.
 *
 * 패키지가 함께 제공하는 타입 선언은 `items` 를 pdfjs 의 `TextItem` 으로 적어두었지만
 * 실제로 넘어오는 것은 pdf2md 자체 모델(`lib/models/TextItem.js`)이라 직접 정의한다.
 */
interface ParsedPage {
  items?: Array<PdfTextRun>;
}

/**
 * 텍스트 레이어가 없는 PDF 안내.
 *
 * 이 경우 변환은 "성공"하지만 결과가 비어 있다. 경고가 없으면 사용자는 왜 빈
 * 파일이 나왔는지 알 수 없다.
 */
const NO_TEXT_WARNING =
  "PDF에서 추출할 텍스트를 찾지 못했습니다. 스캔한 문서라면 글자를 추출하는 데 문자 인식(OCR)이 필요합니다.";

export class PdfParser implements Parser {
  /**
   * PDF를 Markdown으로 변환합니다.
   *
   * pdf2md 를 그대로 쓰면 한글 문서에서 두 가지가 크게 망가진다.
   * 1. 워드프로세서가 굵은 글씨를 겹쳐 그리기로 표현한 글자가 그 횟수만큼 반복됨
   * 2. 숫자 경계마다 런이 끊겨 `제21조` 가 `제 21 조` 로 벌어짐
   *
   * 둘 다 텍스트 런 단계에서만 고칠 수 있으므로 `pageParsed` 콜백에서 전처리한다.
   *
   * 참고: @opendocsg/pdf2md는 이미지 추출을 지원하지 않아 images는 항상 빈 배열입니다.
   */
  async parse(inputPath: string, _options: ParseOptions): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    const pdf2md = (await import("@opendocsg/pdf2md")).default;

    // pageParsed 는 페이지가 하나 처리될 때마다 배열 전체를 다시 넘겨주므로
    // 이미 손본 페이지를 기억해 두 번 처리하지 않는다.
    const processed = new Set<number>();
    const preprocessPages = (pages: Array<ParsedPage>): void => {
      pages.forEach((page, index) => {
        if (processed.has(index) || !page.items?.length) {
          return;
        }
        processed.add(index);
        // pdf2md 가 이 배열을 그대로 변환 파이프라인에 태우므로 여기서 갈아끼운다
        page.items = mergeAdjacentRuns(dedupeOverlappingRuns(page.items));
      });
    };

    const markdown: string = await pdf2md(buffer, {
      pageParsed: (pages) =>
        preprocessPages(pages as unknown as Array<ParsedPage>),
    });

    const cleaned = cleanupPdfMarkdown(markdown);

    return {
      html: null,
      markdown: cleaned,
      images: [],
      ...(hasExtractableText(cleaned) ? {} : { warnings: [NO_TEXT_WARNING] }),
    };
  }
}
