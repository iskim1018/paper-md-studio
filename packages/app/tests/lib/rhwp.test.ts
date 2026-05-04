// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const initMock = vi.fn().mockResolvedValue(undefined);
const HwpDocumentMock = vi.fn();
const readFileMock = vi.fn();

vi.mock("@rhwp/core", () => ({
  default: (...args: Array<unknown>) => initMock(...args),
  HwpDocument: function MockHwpDocument(data: Uint8Array) {
    HwpDocumentMock(data);
    return { free: vi.fn(), pageCount: () => 0 };
  },
}));

vi.mock("@rhwp/core/rhwp_bg.wasm?url", () => ({
  default: "/mock/rhwp_bg.wasm",
}));

vi.mock("../../src/lib/file-reader", () => ({
  readFileAsBytes: (path: string) => readFileMock(path),
}));

afterEach(() => {
  initMock.mockClear();
  HwpDocumentMock.mockClear();
  readFileMock.mockReset();
  vi.resetModules();
  delete (globalThis as { measureTextWidth?: unknown }).measureTextWidth;
});

describe("loadHwpDocument", () => {
  it("WASM init 후 HwpDocument를 생성한다", async () => {
    readFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    const doc = await loadHwpDocument("/tmp/sample.hwp");

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith({
      module_or_path: "/mock/rhwp_bg.wasm",
    });
    expect(readFileMock).toHaveBeenCalledWith("/tmp/sample.hwp");
    expect(HwpDocumentMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(doc).toBeDefined();
  });

  it("init은 단 1회만 실행된다 (싱글턴)", async () => {
    readFileMock.mockResolvedValue(new Uint8Array());
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    await loadHwpDocument("/tmp/a.hwp");
    await loadHwpDocument("/tmp/b.hwp");

    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it("macOS NFD 한글 경로를 NFC로 정규화한다", async () => {
    readFileMock.mockResolvedValue(new Uint8Array());
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    // NFD: "ㅎ" + "ㅏ" + "ㄴ" + "ㄱ" + "ㅡ" + "ㄹ"
    const nfdPath = "/tmp/한글.hwpx".normalize("NFD");
    const nfcPath = nfdPath.normalize("NFC");
    await loadHwpDocument(nfdPath);

    expect(readFileMock).toHaveBeenCalledWith(nfcPath);
  });

  it("globalThis.measureTextWidth를 등록한다", async () => {
    readFileMock.mockResolvedValue(new Uint8Array());
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    await loadHwpDocument("/tmp/x.hwp");

    expect(typeof globalThis.measureTextWidth).toBe("function");
  });

  it("파일 읽기 실패 시 오류를 전파한다", async () => {
    readFileMock.mockRejectedValue(new Error("파일을 읽을 수 없습니다"));
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    await expect(loadHwpDocument("/no/file.hwp")).rejects.toThrow(
      "파일을 읽을 수 없습니다",
    );
  });
});
