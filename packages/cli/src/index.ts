#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ConvertResult } from "@docs-to-md/core";
import { convert, convertToHtml, normalizePath } from "@docs-to-md/core";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string", short: "o" },
    "images-dir": { type: "string" },
    json: { type: "boolean" },
    html: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

function printHelp(): void {
  console.log(`
docs-to-md - 문서를 Markdown으로 변환

사용법:
  docs-to-md <파일경로> [옵션]

옵션:
  -o, --output <경로>       출력 디렉토리 (기본: 입력 파일과 같은 위치)
  --images-dir <이름>       이미지 디렉토리명 (기본: {문서명}_images)
  --json                    JSON 형식으로 결과 출력
  --html                    HTML 형식으로 결과 출력 (뷰어용)
  -h, --help                도움말 표시
  -v, --version             버전 표시

지원 형식:
  .hwp    한글 문서 (HWP 5.0, 내부적으로 HWPX로 선변환 — Java 11+ 필요)
  .hwpx   한글 문서 (HWPX)
  .docx   Word 문서
  .pdf    PDF 문서

예시:
  docs-to-md document.hwpx
  docs-to-md report.pdf -o ./output
  docs-to-md presentation.docx --images-dir assets
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

async function saveImages(
  result: ConvertResult,
  outDir: string,
  resolvedInput: string,
): Promise<void> {
  if (result.images.length === 0) return;

  const imgDirName =
    values["images-dir"] ??
    `${basename(resolvedInput).replace(/\.[^.]+$/, "")}_images`;
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
    console.log("docs-to-md v0.1.0");
    return;
  }

  const inputPath = positionals[0];
  if (!inputPath) {
    console.error("오류: 변환할 파일 경로를 지정해주세요.");
    console.error("도움말: docs-to-md --help\n");
    process.exit(1);
  }

  const resolvedInput = normalizePath(resolve(inputPath));
  const outputDir = values.output
    ? normalizePath(resolve(values.output))
    : undefined;
  const isJson = values.json === true;
  const isHtml = values.html === true;

  try {
    if (isHtml) {
      const htmlResult = await convertToHtml({ inputPath: resolvedInput });
      console.log(htmlResult.html);
      return;
    }

    if (!isJson) {
      console.log(`변환 중: ${basename(resolvedInput)}`);
    }

    const result = await convert({
      inputPath: resolvedInput,
      outputDir,
      imagesDirName: values["images-dir"],
    });

    const outDir = outputDir ?? resolve(resolvedInput, "..");
    const mdFileName = basename(resolvedInput).replace(/\.[^.]+$/, ".md");
    const mdPath = join(outDir, mdFileName);

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
