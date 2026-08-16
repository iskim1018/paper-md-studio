import { readFile } from "node:fs/promises";
import type { ParseOptions, ParseResult, Parser } from "../types.js";
import {
  cleanupInspectorMarkdown,
  cleanupPdfMarkdown,
  hasExtractableText,
} from "./pdf-postprocess.js";
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

const INSPECTOR_LOAD_FAIL_WARNING =
  "PDF 엔진(pdf-inspector)을 불러올 수 없어 기존 엔진으로 변환했습니다. 표 구조가 단순화될 수 있습니다.";

export type PdfEngine = "inspector" | "legacy";

/**
 * PDF 엔진 선택.
 *
 * 기본은 pdf-inspector — 실물 한컴 PDF 실측(2026-08-17)에서 표 감지(우리 0 vs
 * 진짜 표)와 읽기 순서(인쇄형 PDF에서 79% vs 59%)가 우위였고, 내용 보존은
 * 양방향 동일했다. `legacy` 는 회귀 대비 탈출구다.
 */
export function resolvePdfEngine(
  env: Record<string, string | undefined> = process.env,
): PdfEngine {
  return env.PAPER_MD_STUDIO_PDF_ENGINE === "legacy" ? "legacy" : "inspector";
}

/** pdf-inspector `processPdf` 결과 중 우리가 쓰는 부분 */
interface InspectorResult {
  /** 스캔·이미지 PDF에서는 아예 없을 수 있다 (2026-08-17 실측) */
  readonly markdown?: string;
  readonly pdfType: string;
  readonly pagesNeedingOcr?: ReadonlyArray<number>;
}

type InspectorModule = {
  processPdf(buffer: Buffer): InspectorResult;
};

export class PdfParser implements Parser {
  async parse(inputPath: string, _options: ParseOptions): Promise<ParseResult> {
    const buffer = await readFile(inputPath);

    if (resolvePdfEngine() === "inspector") {
      // 네이티브 모듈이라 플랫폼 바이너리가 없을 수 있다 — 그때는 기존
      // 경로로 폴백하되, 표 품질이 달라지므로 조용히 넘어가지 않는다.
      let inspector: InspectorModule | null = null;
      try {
        inspector = (await import(
          "@firecrawl/pdf-inspector"
        )) as unknown as InspectorModule;
      } catch {
        inspector = null;
      }

      if (inspector) {
        return this.parseWithInspector(inspector, buffer);
      }
      const legacy = await this.parseWithLegacy(buffer);
      return {
        ...legacy,
        warnings: [INSPECTOR_LOAD_FAIL_WARNING, ...(legacy.warnings ?? [])],
      };
    }

    return this.parseWithLegacy(buffer);
  }

  private parseWithInspector(
    inspector: InspectorModule,
    buffer: Buffer,
  ): ParseResult {
    const result = inspector.processPdf(buffer);
    const markdown = cleanupInspectorMarkdown(result.markdown ?? "");

    const warnings: Array<string> = [];
    const ocrPages = result.pagesNeedingOcr?.length ?? 0;
    if (!hasExtractableText(markdown)) {
      warnings.push(NO_TEXT_WARNING);
    } else if (result.pdfType !== "TextBased" && ocrPages > 0) {
      // 부분 스캔(Mixed 등) — 어느 쪽이 비는지 알려야 사용자가 원인을 안다.
      // pdfType 조건이 없으면 텍스트 밀도가 낮은 정상 페이지(표지 등)까지
      // pagesNeedingOcr 에 잡혀 경고가 남발된다 (합성 2줄 PDF 실측).
      warnings.push(
        `일부 페이지(${ocrPages}쪽)가 이미지로만 구성되어 해당 텍스트가 누락될 수 있습니다.`,
      );
    }

    return {
      html: null,
      markdown,
      images: [],
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * 기존 pdf2md 경로.
   *
   * pdf2md 를 그대로 쓰면 한글 문서에서 두 가지가 크게 망가진다.
   * 1. 워드프로세서가 굵은 글씨를 겹쳐 그리기로 표현한 글자가 그 횟수만큼 반복됨
   * 2. 숫자 경계마다 런이 끊겨 `제21조` 가 `제 21 조` 로 벌어짐
   *
   * 둘 다 텍스트 런 단계에서만 고칠 수 있으므로 `pageParsed` 콜백에서 전처리한다.
   */
  private async parseWithLegacy(buffer: Buffer): Promise<ParseResult> {
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
