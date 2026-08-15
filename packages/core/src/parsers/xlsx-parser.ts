import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import {
  createImageAsset,
  makeImageName,
  mimeFromExt,
} from "../image-utils.js";
import type {
  ImageAsset,
  ParseOptions,
  ParseResult,
  Parser,
} from "../types.js";
import type { NumberFormats } from "./spreadsheet/cell-format.js";
import { buildNumberFormats } from "./spreadsheet/cell-format.js";
import type { SheetGrid } from "./spreadsheet/grid.js";
import type { RenderableSheet } from "./spreadsheet/render.js";
import { escapeHtml, renderWorkbook } from "./spreadsheet/render.js";
import type { SheetRef } from "./xlsx/workbook.js";
import {
  parseRelationships,
  parseSharedStrings,
  parseWorkbook,
  resolveZipPath,
} from "./xlsx/workbook.js";
import { parseWorksheet } from "./xlsx/worksheet.js";

/**
 * XLSX → HTML → Markdown 파서.
 *
 * kordoc 대신 직접 파싱한다. 표시형식(styles.xml)·그림(drawings)·하이퍼링크·
 * 숨김 상태는 kordoc이 읽지 않는 파트라 위임해서는 복원할 방법이 없다 —
 * 특히 날짜가 시리얼 숫자(45000)로 남는 문제는 사후 보정이 불가능하다.
 *
 * 표는 colspan/rowspan을 살린 HTML로 만든 뒤 `normalizeHtmlTablesToGfm`에
 * 넘긴다. HWPX·DOCX와 같은 함수를 타므로 병합 화살표·grid 정규화 계약이
 * 자동으로 일치한다.
 */

const drawingParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (tagName) =>
    ["twoCellAnchor", "oneCellAnchor", "absoluteAnchor", "pic"].includes(
      tagName,
    ),
});

interface DrawingImage {
  readonly embedId: string;
  readonly alt: string;
}

function toArray<T>(value: T | Array<T> | undefined): Array<T> {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 드로잉 XML에서 그림 목록(관계 ID + 대체텍스트)을 뽑는다 */
function parseDrawingImages(xml: string): Array<DrawingImage> {
  const doc = drawingParser.parse(xml) as Record<string, unknown>;
  const root = (doc.wsDr ?? {}) as Record<string, unknown>;
  const anchors = [
    ...toArray(root.twoCellAnchor as Array<Record<string, unknown>>),
    ...toArray(root.oneCellAnchor as Array<Record<string, unknown>>),
    ...toArray(root.absoluteAnchor as Array<Record<string, unknown>>),
  ];

  const images: Array<DrawingImage> = [];
  for (const anchor of anchors) {
    for (const pic of toArray(anchor.pic as Array<Record<string, unknown>>)) {
      const nvPicPr = (pic.nvPicPr ?? {}) as Record<string, unknown>;
      const cNvPr = (nvPicPr.cNvPr ?? {}) as Record<string, unknown>;
      const blipFill = (pic.blipFill ?? {}) as Record<string, unknown>;
      const blip = (blipFill.blip ?? {}) as Record<string, unknown>;
      const embedId = String(blip["@_embed"] ?? "");
      if (!embedId) continue;
      const alt =
        String(cNvPr["@_descr"] ?? "") || String(cNvPr["@_name"] ?? "그림");
      images.push({ embedId, alt });
    }
  }
  return images;
}

type ZipFiles = Record<string, Uint8Array>;

function readText(files: ZipFiles, path: string): string | null {
  const entry = files[path];
  return entry ? strFromU8(entry) : null;
}

interface SheetContext {
  readonly files: ZipFiles;
  readonly workbookRels: ReadonlyMap<string, string>;
  readonly sharedStrings: ReadonlyArray<string>;
  readonly formats: NumberFormats;
  readonly date1904: boolean;
  readonly images: Array<ImageAsset>;
  readonly warnings: Array<string>;
  readonly imagesDirName: string;
}

export class XlsxParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    const files = this.unzip(buffer);

    const workbookXml = readText(files, "xl/workbook.xml");
    if (!workbookXml) {
      throw new Error(
        "올바른 XLSX 파일이 아닙니다 (xl/workbook.xml을 찾을 수 없습니다).",
      );
    }

    const { sheets, date1904 } = parseWorkbook(workbookXml);
    if (sheets.length === 0) {
      throw new Error("통합 문서에 시트가 없습니다.");
    }

    const warnings: Array<string> = [];
    const images: Array<ImageAsset> = [];
    const includeHidden = options.xlsx?.includeHidden === true;
    const context: SheetContext = {
      files,
      workbookRels: parseRelationships(
        readText(files, "xl/_rels/workbook.xml.rels") ?? "<Relationships/>",
      ),
      sharedStrings: parseSharedStrings(
        readText(files, "xl/sharedStrings.xml") ?? "<sst/>",
      ),
      formats: buildNumberFormats(
        readText(files, "xl/styles.xml") ?? "<styleSheet/>",
      ),
      date1904,
      images,
      warnings,
      imagesDirName: options.imagesDirName,
    };

    const visibleSheets = sheets.filter(
      (sheet) => includeHidden || !sheet.hidden,
    );
    const renderable = visibleSheets
      .map((sheet) => this.toRenderableSheet(sheet, context))
      .filter((sheet): sheet is RenderableSheet => sheet !== null);

    // 렌더는 XLS와 공유한다 — 확장자가 달라도 결과는 같아야 한다
    const rendered = renderWorkbook(renderable, {
      includeHidden,
      hiddenSheetNames: sheets
        .filter((sheet) => sheet.hidden)
        .map((sheet) => sheet.name),
    });

    const allWarnings = [...warnings, ...rendered.warnings];
    return {
      html: rendered.html,
      markdown: rendered.markdown,
      images,
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      ...(rendered.hiddenExcluded
        ? { hiddenExcluded: rendered.hiddenExcluded }
        : {}),
    };
  }

  private unzip(buffer: Buffer): ZipFiles {
    try {
      return unzipSync(new Uint8Array(buffer));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`XLSX 파일을 열 수 없습니다 (손상 가능성): ${detail}`);
    }
  }

  /** 시트 하나를 공용 렌더가 받는 모양으로 만든다 (렌더 자체는 하지 않는다) */
  private toRenderableSheet(
    sheet: SheetRef,
    ctx: SheetContext,
  ): RenderableSheet | null {
    const target = ctx.workbookRels.get(sheet.relId);
    const sheetPath = target
      ? resolveZipPath("xl", target)
      : "xl/worksheets/sheet1.xml";
    const sheetXml = readText(ctx.files, sheetPath);
    if (!sheetXml) {
      ctx.warnings.push(
        `시트 "${sheet.name}"의 내용을 찾을 수 없어 건너뛰었습니다.`,
      );
      return null;
    }

    const raw = parseWorksheet(
      sheetXml,
      ctx.sharedStrings,
      ctx.formats,
      ctx.date1904,
    );

    // 관계 ID를 실제 주소로 바꿔 둔다 — 이후 좌표 재매핑은 공용 렌더가 한다
    const grid: SheetGrid = {
      ...raw,
      hyperlinkRels: this.resolveHyperlinks(raw, ctx.files, sheetPath),
    };

    return {
      name: sheet.name,
      grid,
      extraHtml: this.collectImages(raw, ctx, sheetPath),
    };
  }

  private resolveHyperlinks(
    grid: SheetGrid,
    files: ZipFiles,
    sheetPath: string,
  ): Map<string, string> {
    const resolved = new Map<string, string>();
    if (grid.hyperlinkRels.size === 0) return resolved;

    const relsXml = readText(files, relsPathFor(sheetPath));
    if (!relsXml) return resolved;

    const rels = parseRelationships(relsXml);
    for (const [position, relId] of grid.hyperlinkRels) {
      const target = rels.get(relId);
      if (target) resolved.set(position, target);
    }
    return resolved;
  }

  private collectImages(
    grid: SheetGrid,
    ctx: SheetContext,
    sheetPath: string,
  ): Array<string> {
    if (!grid.drawingRelId) return [];

    const sheetRelsXml = readText(ctx.files, relsPathFor(sheetPath));
    if (!sheetRelsXml) return [];

    const drawingTarget = parseRelationships(sheetRelsXml).get(
      grid.drawingRelId,
    );
    if (!drawingTarget) return [];

    const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf("/"));
    const drawingPath = resolveZipPath(sheetDir, drawingTarget);
    const drawingXml = readText(ctx.files, drawingPath);
    if (!drawingXml) return [];

    const drawingDir = drawingPath.slice(0, drawingPath.lastIndexOf("/"));
    const drawingRels = parseRelationships(
      readText(ctx.files, relsPathFor(drawingPath)) ?? "<Relationships/>",
    );

    const tags: Array<string> = [];
    for (const image of parseDrawingImages(drawingXml)) {
      const target = drawingRels.get(image.embedId);
      if (!target) continue;
      const mediaPath = resolveZipPath(drawingDir, target);
      const data = ctx.files[mediaPath];
      if (!data) continue;

      const ext = mediaPath.slice(mediaPath.lastIndexOf("."));
      const name = makeImageName(ctx.images.length + 1, ext);
      ctx.images.push(createImageAsset(name, data, mimeFromExt(mediaPath)));
      tags.push(
        `<p><img src="./${ctx.imagesDirName}/${name}" alt="${escapeHtml(image.alt)}"></p>`,
      );
    }
    return tags;
  }
}

/** `xl/worksheets/sheet1.xml` → `xl/worksheets/_rels/sheet1.xml.rels` */
function relsPathFor(partPath: string): string {
  return partPath.replace(/([^/]+)$/, (name) => `_rels/${name}.rels`);
}
