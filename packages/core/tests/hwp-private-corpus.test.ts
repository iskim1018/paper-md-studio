/**
 * 실물 .hwp 묶음 변환 (선택 실행).
 *
 * 비공개 문서는 저장소에 둘 수 없으므로(CLAUDE.md 2026-08-08), 로컬에서
 * `PAPER_MD_STUDIO_PRIVATE_HWP=<디렉토리>` 를 주면 그 안의 .hwp 를 모두 변환해
 * 오류 없이 비어 있지 않은 결과가 나오는지 본다. 테스트 이름에는 파일 이름을
 * 싣지 않는다(순번만) — 출력에 문서 제목이 새지 않게.
 *
 *   PAPER_MD_STUDIO_PRIVATE_HWP=private/fixtures pnpm exec vitest run hwp-private-corpus
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convert } from "../src/pipeline.js";

const ENV_KEY = "PAPER_MD_STUDIO_PRIVATE_HWP";
const corpusDir = process.env[ENV_KEY];

function listHwpFiles(dir: string): Array<string> {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".hwp"))
    .sort()
    .map((name) => join(resolve(dir), name));
}

const files = corpusDir ? listHwpFiles(corpusDir) : [];

describe.skipIf(!corpusDir)(`실물 .hwp 변환 (${ENV_KEY})`, () => {
  it("디렉토리에 .hwp 가 있다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(
    files.map((path, i) => ({ path, label: `문서 #${i + 1}` })),
  )("$label 이 오류 없이 비어 있지 않게 변환된다", async ({ path }) => {
    const result = await convert({ inputPath: path });

    expect(result.format).toBe("hwp");
    expect(result.markdown.trim().length).toBeGreaterThan(0);
  }, 120_000);
});
