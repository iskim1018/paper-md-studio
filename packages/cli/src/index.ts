#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ConvertResult, HtmlConvertOptions } from "@paper-md-studio/core";
import {
  convert,
  convertToHtml,
  isHttpUrl,
  normalizePath,
  urlToSlug,
} from "@paper-md-studio/core";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string", short: "o" },
    "images-dir": { type: "string" },
    json: { type: "boolean" },
    html: { type: "boolean" },
    "no-extract": { type: "boolean" },
    "download-images": { type: "boolean" },
    render: { type: "boolean" },
    "wait-selector": { type: "string" },
    timeout: { type: "string" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

function printHelp(): void {
  console.log(`
paper-md-studio - 문서를 Markdown으로 변환

사용법:
  paper-md-studio <파일경로|URL> [옵션]

옵션:
  -o, --output <경로>       출력 디렉토리 (기본: 입력 파일과 같은 위치)
  --images-dir <이름>       이미지 디렉토리명 (기본: {문서명}_images)
  --json                    JSON 형식으로 결과 출력
  --html                    HTML 형식으로 결과 출력 (뷰어용)
  --no-extract              HTML 본문 추출 비활성 (페이지 전체 변환)
  --download-images         HTML 원격 이미지를 {문서명}_images/로 다운로드
  --render                  SPA 렌더링 후 변환 (URL 전용, Chrome 필요)
  --wait-selector <셀렉터>  SPA 렌더링 시 대기할 CSS 셀렉터
  --timeout <ms>            네트워크·렌더링 시간 제한 (기본: 30000)
  -h, --help                도움말 표시
  -v, --version             버전 표시

지원 형식:
  .hwp    한글 문서 (HWP 5.0, 내부적으로 HWPX로 선변환 — Java 11+ 필요)
  .hwpx   한글 문서 (HWPX)
  .doc    Word 문서 (레거시, 내부적으로 DOCX로 선변환 — LibreOffice 필요)
  .docx   Word 문서
  .pdf    PDF 문서
  .html   HTML 문서 (로컬 파일 또는 http(s) URL, 본문 자동 추출)

예시:
  paper-md-studio document.hwpx
  paper-md-studio report.pdf -o ./output
  paper-md-studio presentation.docx --images-dir assets
  paper-md-studio article.html
  paper-md-studio https://example.com/post -o ./output
  paper-md-studio https://spa.example.com/app --render
`);
}

function printJsonResult(result: ConvertResult, outputPath: string): void {
  const jsonOutput = {
    markdown: result.markdown,
    format: result.format,
    elapsed: result.elapsed,
    imageCount: result.images.length,
    outputPath,
  };
  console.log(JSON.stringify(jsonOutput));
}

function defaultBaseName(resolvedInput: string): string {
  if (isHttpUrl(resolvedInput)) {
    return urlToSlug(resolvedInput);
  }
  return basename(resolvedInput).replace(/\.[^.]+$/, "");
}

/** HTML 변환 플래그를 HtmlConvertOptions로 변환한다 */
function buildHtmlOptions(): HtmlConvertOptions | undefined {
  const options: HtmlConvertOptions = {};
  if (values["no-extract"] === true) options.extractContent = false;
  if (values["download-images"] === true) options.downloadImages = true;
  if (values.render === true) options.renderSpa = true;
  if (values["wait-selector"]) options.waitSelector = values["wait-selector"];
  if (values.timeout) {
    const timeoutMs = Number.parseInt(values.timeout, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`--timeout 값이 올바르지 않습니다: ${values.timeout}`);
    }
    options.timeoutMs = timeoutMs;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

interface OutputTargets {
  outputDir: string | undefined;
  outputFileOverride: string | undefined;
}

// --output은 디렉토리 또는 .md 파일 경로를 모두 받는다.
// 파일 경로로 주어지면 해당 이름으로 저장(앱에서 "다른 이름으로" 처리).
function parseOutputOption(): OutputTargets {
  if (!values.output) {
    return { outputDir: undefined, outputFileOverride: undefined };
  }
  const resolvedOut = normalizePath(resolve(values.output));
  if (extname(resolvedOut).toLowerCase() === ".md") {
    return { outputDir: dirname(resolvedOut), outputFileOverride: resolvedOut };
  }
  return { outputDir: resolvedOut, outputFileOverride: undefined };
}

function resolveMdPath(
  targets: OutputTargets,
  resolvedInput: string,
  isUrl: boolean,
): { outDir: string; mdPath: string } {
  const outDir =
    targets.outputDir ?? (isUrl ? process.cwd() : resolve(resolvedInput, ".."));
  const mdPath =
    targets.outputFileOverride ??
    join(outDir, `${defaultBaseName(resolvedInput)}.md`);
  return { outDir, mdPath };
}

async function saveImages(
  result: ConvertResult,
  outDir: string,
  resolvedInput: string,
): Promise<void> {
  if (result.images.length === 0) return;

  const imgDirName =
    values["images-dir"] ?? `${defaultBaseName(resolvedInput)}_images`;
  const imgDir = join(outDir, imgDirName);
  await mkdir(imgDir, { recursive: true });

  for (const img of result.images) {
    await writeFile(join(imgDir, img.name), img.data);
  }
  console.error(`  이미지 ${result.images.length}개 추출 → ${imgDirName}/`);
}

async function main(): Promise<void> {
  if (values.help) {
    printHelp();
    return;
  }

  if (values.version) {
    console.log("paper-md-studio v0.4.2");
    return;
  }

  const inputPath = positionals[0];
  if (!inputPath) {
    console.error("오류: 변환할 파일 경로를 지정해주세요.");
    console.error("도움말: paper-md-studio --help\n");
    process.exit(1);
  }

  const isUrl = isHttpUrl(inputPath);
  const resolvedInput = isUrl ? inputPath : normalizePath(resolve(inputPath));
  const outputTargets = parseOutputOption();
  const isJson = values.json === true;
  const isHtml = values.html === true;

  try {
    const htmlOptions = buildHtmlOptions();

    if (isHtml) {
      const htmlResult = await convertToHtml({
        inputPath: resolvedInput,
        ...(htmlOptions ? { html: htmlOptions } : {}),
      });
      console.log(htmlResult.html);
      return;
    }

    if (!isJson) {
      console.log(
        `변환 중: ${isUrl ? resolvedInput : basename(resolvedInput)}`,
      );
    }

    const result = await convert({
      inputPath: resolvedInput,
      outputDir: outputTargets.outputDir,
      imagesDirName: values["images-dir"],
      ...(htmlOptions ? { html: htmlOptions } : {}),
    });

    const { outDir, mdPath } = resolveMdPath(
      outputTargets,
      resolvedInput,
      isUrl,
    );

    await mkdir(outDir, { recursive: true });
    await writeFile(mdPath, result.markdown, "utf-8");
    await saveImages(result, outDir, resolvedInput);

    if (isJson) {
      printJsonResult(result, mdPath);
      return;
    }

    console.log(`  완료: ${mdPath} (${Math.round(result.elapsed)}ms)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isJson) {
      console.error(message);
    } else {
      console.error(`오류: ${message}`);
    }
    process.exit(1);
  }
}

main();
