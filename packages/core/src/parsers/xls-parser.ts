import { readFile } from "node:fs/promises";
import CFB from "cfb";
import type { ParseOptions, ParseResult, Parser } from "../types.js";
import { assertSafeOle2, Ole2GuardError } from "./ole2/guard.js";
import type { RenderableSheet } from "./spreadsheet/render.js";
import { renderWorkbook } from "./spreadsheet/render.js";
import { parseSheet } from "./xls/sheet.js";
import { assertSupportedBiff, parseGlobals } from "./xls/workbook.js";

/**
 * XLS(BIFF8) → HTML → Markdown 파서.
 *
 * 사용자에게 .xls와 .xlsx는 "같은 엑셀"이다. kordoc에 맡기면 날짜가 시리얼
 * 숫자로 남고 서식·숨김 처리가 빠져, 확장자만 다른 같은 문서가 전혀 다르게
 * 변환된다. 그래서 컨테이너(OLE2)와 레코드만 직접 읽고, **격자를 만든 뒤부터는
 * XLSX와 완전히 같은 코드**(`spreadsheet/`)를 탄다.
 */

/** OLE2 복합 문서에서 워크북 스트림을 꺼낸다 */
function extractWorkbookStream(buffer: Buffer): Uint8Array {
  // cfb 가 적대적 OLE2 에서 잡을 수 없는 OOM 으로 죽는 것을 막는다 — CFB.read 보다
  // 먼저 돈다. 사용자에게 보여줄 한국어 메시지로 거부 사유를 옮긴다.
  try {
    assertSafeOle2(buffer);
  } catch (error) {
    if (error instanceof Ole2GuardError) {
      const reason =
        error.reason === "TOO_LARGE"
          ? "XLS 파일이 비정상적으로 큽니다 (손상되었거나 악의적으로 만들어졌을 수 있습니다)"
          : "XLS 파일이 손상되었습니다";
      throw new Error(`${reason}: ${error.message}`);
    }
    throw error;
  }
  let container: ReturnType<typeof CFB.read>;
  try {
    container = CFB.read(buffer, { type: "buffer" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`XLS 파일을 열 수 없습니다 (손상 가능성): ${detail}`);
  }

  // Excel 97 이후는 "Workbook", Excel 5/95는 "Book"으로 저장한다
  for (const name of ["Workbook", "Book"]) {
    const entry = CFB.find(container, name);
    const content = entry?.content;
    if (content) {
      return content instanceof Uint8Array
        ? content
        : Uint8Array.from(content as ArrayLike<number>);
    }
  }

  throw new Error(
    "올바른 XLS 파일이 아닙니다 (Workbook 스트림을 찾을 수 없습니다).",
  );
}

export class XlsParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    const stream = extractWorkbookStream(buffer);
    assertSupportedBiff(stream);

    const globals = parseGlobals(stream);
    if (globals.sheets.length === 0) {
      throw new Error("통합 문서에 시트가 없습니다.");
    }

    const includeHidden = options.xlsx?.includeHidden === true;
    const context = {
      sharedStrings: globals.sharedStrings,
      formats: globals.formats,
      date1904: globals.date1904,
    };

    const renderable: Array<RenderableSheet> = globals.sheets
      .filter((sheet) => includeHidden || !sheet.hidden)
      .map((sheet) => ({
        name: sheet.name,
        grid: parseSheet(stream, sheet.streamOffset, context),
      }));

    // 렌더는 XLSX와 공유한다 — 확장자가 달라도 결과는 같아야 한다
    const rendered = renderWorkbook(renderable, {
      includeHidden,
      hiddenSheetNames: globals.sheets
        .filter((sheet) => sheet.hidden)
        .map((sheet) => sheet.name),
    });

    return {
      html: rendered.html,
      markdown: rendered.markdown,
      images: [],
      ...(rendered.warnings.length > 0 ? { warnings: rendered.warnings } : {}),
      ...(rendered.hiddenExcluded
        ? { hiddenExcluded: rendered.hiddenExcluded }
        : {}),
    };
  }
}
