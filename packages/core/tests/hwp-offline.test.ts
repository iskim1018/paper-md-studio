/**
 * .hwp 변환은 네트워크 없이 동작해야 한다 (오프라인 1급 지원).
 *
 * rhwp 글루는 초기화에 URL 을 넘기면 `fetch` 로 WASM 을 받는다. 우리는 파일
 * 바이트를 넘기므로 fetch 가 불리면 안 된다. 이 파일은 모듈 레지스트리가 따로라
 * rhwp 를 처음 초기화하는 순간부터 fetch 를 막아 둔 상태로 검증한다.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HwpParser } from "../src/parsers/hwp-parser.js";
import { createHwp5 } from "./helpers/hwp-fixtures.js";

const fetchCalls: Array<unknown> = [];
let tmpDir: string;

beforeAll(async () => {
  vi.stubGlobal("fetch", (input: unknown) => {
    fetchCalls.push(input);
    throw new Error("네트워크 접근 금지 (테스트)");
  });
  tmpDir = await mkdtemp(join(tmpdir(), "hwp-offline-test-"));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("오프라인 .hwp 변환", () => {
  it("fetch 를 막아도 rhwp 초기화와 변환이 된다", async () => {
    // Arrange — rhwp 를 처음 초기화하는 지점(생성기)부터 fetch 가 막혀 있다
    const path = join(tmpDir, "오프라인.hwp");
    await writeFile(path, await createHwp5("오프라인 변환"));

    // Act
    const result = await new HwpParser().parse(path, {
      imagesDirName: "오프라인_images",
    });

    // Assert
    expect(result.html).toContain("오프라인 변환");
    expect(fetchCalls).toEqual([]);
  });
});
