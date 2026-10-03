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
  HwpDocumentMock.mockReset();
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

const encoder = new TextEncoder();

function hwpml(versionAttr: string, head = true): Uint8Array {
  const headTag = head ? '<HEAD SecCnt="1"/>' : "";
  return encoder.encode(
    `<?xml version="1.0" encoding="UTF-8"?><HWPML${versionAttr} Style="embed">${headTag}<BODY/></HWPML>`,
  );
}

function decoded(call: Array<unknown> | undefined): string {
  return new TextDecoder().decode(call?.[0] as Uint8Array);
}

describe("loadHwpDocument — HWPML 버전 대체 (변환 경로와 같은 규칙)", () => {
  it("미지원 버전으로 거부되면 Version 을 2.91 로 바꿔 한 번 더 연다", async () => {
    // Arrange — rhwp 0.8.6 이 2.8 문서에 던지는 문자열 그대로
    readFileMock.mockResolvedValue(hwpml(' Version="2.8"'));
    HwpDocumentMock.mockImplementationOnce(() => {
      throw "유효하지 않은 파일: HML 오류: 지원하지 않는 HWPML 버전입니다: 2.8";
    });
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    // Act
    const doc = await loadHwpDocument("/tmp/old.hwp");

    // Assert
    expect(doc).toBeDefined();
    expect(HwpDocumentMock).toHaveBeenCalledTimes(2);
    expect(decoded(HwpDocumentMock.mock.calls[1])).toContain('Version="2.91"');
  });

  it("Version 이 없어 형식을 못 알아보면 넣어서 다시 연다", async () => {
    readFileMock.mockResolvedValue(hwpml(""));
    HwpDocumentMock.mockImplementationOnce(() => {
      throw "유효하지 않은 파일: 알 수 없는 파일 형식. 오류코드: UNSUPPORTED_FILE_FORMAT.";
    });
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    await loadHwpDocument("/tmp/noversion.hwp");

    expect(HwpDocumentMock).toHaveBeenCalledTimes(2);
    expect(decoded(HwpDocumentMock.mock.calls[1])).toContain(
      '<HWPML Version="2.91"',
    );
  });

  it("HEAD 가 없으면 다시 열지 않고 원래 오류를 던진다", async () => {
    const original =
      "유효하지 않은 파일: HML 오류: 지원하지 않는 HWPML 버전입니다: 2.8";
    readFileMock.mockResolvedValue(hwpml(' Version="2.8"', false));
    HwpDocumentMock.mockImplementation(() => {
      throw original;
    });
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    await expect(loadHwpDocument("/tmp/nohead.hwp")).rejects.toBe(original);
    expect(HwpDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("버전과 무관한 오류는 다시 열지 않는다", async () => {
    const original =
      "유효하지 않은 파일: 비밀번호가 필요한 암호 문서입니다 (parse_hwp_with_password)";
    readFileMock.mockResolvedValue(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
    HwpDocumentMock.mockImplementation(() => {
      throw original;
    });
    const { loadHwpDocument } = await import("../../src/lib/rhwp");

    await expect(loadHwpDocument("/tmp/secret.hwp")).rejects.toBe(original);
    expect(HwpDocumentMock).toHaveBeenCalledTimes(1);
  });
});
