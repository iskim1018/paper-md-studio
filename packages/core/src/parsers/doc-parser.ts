import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { normalizeToNFC } from "../normalize.js";
import type { ParseOptions, ParseResult, Parser } from "../types.js";
import { DocxParser } from "./docx-parser.js";

const LIBREOFFICE_ENV = "PAPER_MD_STUDIO_LIBREOFFICE";

interface RunResult {
  readonly code: number;
  readonly stderr: string;
}

function runCommand(
  cmd: string,
  args: Array<string>,
  errorHint: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderrChunks: Array<Buffer> = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(errorHint));
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });
  });
}

/**
 * LibreOffice 실행 파일 경로를 탐색한다.
 *
 * 탐색 순서:
 *   1. PAPER_MD_STUDIO_LIBREOFFICE 환경변수
 *   2. macOS 기본 설치 경로 (/Applications)
 *   3. PATH의 libreoffice 또는 soffice
 */
async function resolveLibreOffice(): Promise<string | null> {
  const override = process.env[LIBREOFFICE_ENV];
  if (override) {
    try {
      await access(override);
      return override;
    } catch {
      throw new Error(
        `${LIBREOFFICE_ENV}에 지정된 LibreOffice를 찾을 수 없습니다: ${override}`,
      );
    }
  }

  // macOS 기본 설치 경로
  if (process.platform === "darwin") {
    const macPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    try {
      await access(macPath);
      return macPath;
    } catch {
      // fall through
    }
  }

  // PATH 검색: libreoffice, soffice 순서
  for (const cmd of ["libreoffice", "soffice"]) {
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const which = process.platform === "win32" ? "where" : "which";
        const child = spawn(which, [cmd], {
          stdio: ["ignore", "pipe", "ignore"],
        });
        let stdout = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.on("close", (code) => {
          const firstLine = stdout.trim().split("\n")[0] ?? "";
          if (code === 0 && firstLine) resolve(firstLine);
          else reject(new Error("not found"));
        });
        child.on("error", () => reject(new Error("not found")));
      });
      return result;
    } catch {
      // 다음 후보 시도
    }
  }

  return null;
}

/**
 * macOS textutil 존재 여부 확인. 이미지는 보존되지 않으므로 fallback 전용.
 */
async function hasTextutil(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await access("/usr/bin/textutil");
    return true;
  } catch {
    return false;
  }
}

/**
 * DOC(레거시 Word) 파일을 DOCX로 선변환한 뒤 DocxParser에 위임한다.
 *
 * 변환 도구 우선순위:
 *   1. LibreOffice headless (크로스플랫폼, 이미지 보존)
 *   2. macOS textutil (fallback, 이미지 손실)
 */
export class DocParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const tmpDir = await mkdtemp(join(tmpdir(), "paper-md-studio-doc-"));
    const baseName = basename(inputPath).replace(/\.[^.]+$/, "");

    try {
      const loPath = await resolveLibreOffice();

      if (loPath) {
        return await this.convertWithLibreOffice(
          loPath,
          inputPath,
          tmpDir,
          baseName,
          options,
        );
      }

      if (await hasTextutil()) {
        return await this.convertWithTextutil(
          inputPath,
          tmpDir,
          baseName,
          options,
        );
      }

      throw new Error(
        "DOC 변환에 필요한 LibreOffice를 찾을 수 없습니다. " +
          "LibreOffice를 설치하거나 " +
          `${LIBREOFFICE_ENV} 환경변수로 경로를 지정해주세요. ` +
          "(macOS: brew install --cask libreoffice / Windows: https://www.libreoffice.org)",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async convertWithLibreOffice(
    loPath: string,
    inputPath: string,
    tmpDir: string,
    baseName: string,
    options: ParseOptions,
  ): Promise<ParseResult> {
    const result = await runCommand(
      loPath,
      ["--headless", "--convert-to", "docx", "--outdir", tmpDir, inputPath],
      "LibreOffice 실행에 실패했습니다.",
    );

    if (result.code !== 0) {
      const detail = result.stderr.trim() || `종료 코드 ${result.code}`;
      throw new Error(`DOC → DOCX 변환 실패 (LibreOffice): ${detail}`);
    }

    const tmpDocxPath = await this.findDocxInDir(tmpDir, baseName);
    const docxParser = new DocxParser();
    return await docxParser.parse(tmpDocxPath, options);
  }

  private async convertWithTextutil(
    inputPath: string,
    tmpDir: string,
    baseName: string,
    options: ParseOptions,
  ): Promise<ParseResult> {
    const outputPath = normalizeToNFC(join(tmpDir, `${baseName}.docx`));

    const result = await runCommand(
      "/usr/bin/textutil",
      ["-convert", "docx", "-output", outputPath, inputPath],
      "textutil 실행에 실패했습니다.",
    );

    if (result.code !== 0) {
      const detail = result.stderr.trim() || `종료 코드 ${result.code}`;
      throw new Error(`DOC → DOCX 변환 실패 (textutil): ${detail}`);
    }

    const docxParser = new DocxParser();
    return await docxParser.parse(outputPath, options);
  }

  /**
   * LibreOffice는 출력 파일명을 자체 결정하므로, tmpDir에서 .docx를 찾는다.
   */
  private async findDocxInDir(
    dir: string,
    expectedBaseName: string,
  ): Promise<string> {
    const entries = await readdir(dir);
    // LibreOffice가 생성한 파일은 보통 원본과 같은 basename
    const expected = `${expectedBaseName}.docx`;
    if (entries.includes(expected)) {
      return normalizeToNFC(join(dir, expected));
    }
    // fallback: 디렉토리 내 첫 번째 .docx
    const docxFile = entries.find((e) => e.endsWith(".docx"));
    if (docxFile) {
      return normalizeToNFC(join(dir, docxFile));
    }
    throw new Error(
      `DOC → DOCX 변환 후 DOCX 파일을 찾을 수 없습니다 (디렉토리: ${dir})`,
    );
  }
}
