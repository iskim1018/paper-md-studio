// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  __TEST_MARKERS__,
  injectPageNumbers,
  preprocessDocxPageFields,
} from "../../src/lib/docx-page-fields";

const { PAGE_MARKER, NUMPAGES_MARKER } = __TEST_MARKERS__;

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function buildHeaderXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W_NS}">
  <w:p>${inner}</w:p>
</w:hdr>`;
}

async function buildDocxWithHeader(headerXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", "<root/>");
  zip.file("word/header1.xml", headerXml);
  return zip.generateAsync({ type: "arraybuffer" });
}

async function readHeaderXml(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/header1.xml");
  if (!file) throw new Error("header1.xml missing");
  return file.async("string");
}

describe("preprocessDocxPageFields", () => {
  it("fldSimple PAGE를 마커 텍스트 run으로 치환한다", async () => {
    const xml = buildHeaderXml(`
      <w:r><w:t>Page </w:t></w:r>
      <w:fldSimple w:instr=" PAGE   \\* MERGEFORMAT ">
        <w:r><w:t>1</w:t></w:r>
      </w:fldSimple>
    `);
    const input = await buildDocxWithHeader(xml);
    const output = await preprocessDocxPageFields(input);
    const result = await readHeaderXml(output);

    expect(result).not.toContain("<w:fldSimple");
    expect(result).toContain(PAGE_MARKER);
  });

  it("fldSimple NUMPAGES를 별도 마커로 치환한다", async () => {
    const xml = buildHeaderXml(`
      <w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>10</w:t></w:r></w:fldSimple>
    `);
    const input = await buildDocxWithHeader(xml);
    const output = await preprocessDocxPageFields(input);
    const result = await readHeaderXml(output);

    expect(result).toContain(NUMPAGES_MARKER);
    expect(result).not.toContain(PAGE_MARKER);
  });

  it("PAGE/NUMPAGES가 아닌 fldSimple은 건드리지 않는다", async () => {
    const xml = buildHeaderXml(`
      <w:fldSimple w:instr=" DATE "><w:r><w:t>2026-01-01</w:t></w:r></w:fldSimple>
    `);
    const input = await buildDocxWithHeader(xml);
    const output = await preprocessDocxPageFields(input);
    const result = await readHeaderXml(output);

    expect(result).toContain("<w:fldSimple");
    expect(result).toContain(' w:instr=" DATE "');
    expect(result).not.toContain(PAGE_MARKER);
  });

  it("복잡 필드(begin/instrText/separate/end) PAGE를 마커로 치환한다", async () => {
    const xml = buildHeaderXml(`
      <w:r><w:t>Page </w:t></w:r>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r>
      <w:r><w:t>1</w:t></w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
    `);
    const input = await buildDocxWithHeader(xml);
    const output = await preprocessDocxPageFields(input);
    const result = await readHeaderXml(output);

    expect(result).not.toContain("fldChar");
    expect(result).not.toContain("instrText");
    expect(result).toContain(PAGE_MARKER);
  });

  it("body 등 헤더/푸터 외 파일은 건드리지 않는다", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="${W_NS}">
        <w:body><w:p>
          <w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>
        </w:p></w:body>
      </w:document>`,
    );
    const input = await zip.generateAsync({ type: "arraybuffer" });
    const output = await preprocessDocxPageFields(input);
    const outZip = await JSZip.loadAsync(output);
    const docXml = await outZip.file("word/document.xml")?.async("string");

    expect(docXml).toContain("<w:fldSimple");
    expect(docXml).not.toContain(PAGE_MARKER);
  });
});

describe("injectPageNumbers", () => {
  it("각 페이지의 PAGE 마커를 인덱스+1로 교체한다", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <section class="docx"><footer><span>Page ${PAGE_MARKER}</span></footer></section>
      <section class="docx"><footer><span>Page ${PAGE_MARKER}</span></footer></section>
      <section class="docx"><footer><span>Page ${PAGE_MARKER}</span></footer></section>
    `;
    injectPageNumbers(container, 3);

    const footers = container.querySelectorAll("section.docx footer span");
    expect(footers[0]?.textContent).toBe("Page 1");
    expect(footers[1]?.textContent).toBe("Page 2");
    expect(footers[2]?.textContent).toBe("Page 3");
  });

  it("NUMPAGES 마커를 총 페이지 수로 교체한다", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <section class="docx"><footer><span>${PAGE_MARKER} / ${NUMPAGES_MARKER}</span></footer></section>
      <section class="docx"><footer><span>${PAGE_MARKER} / ${NUMPAGES_MARKER}</span></footer></section>
    `;
    injectPageNumbers(container, 2);

    const footers = container.querySelectorAll("section.docx footer span");
    expect(footers[0]?.textContent).toBe("1 / 2");
    expect(footers[1]?.textContent).toBe("2 / 2");
  });

  it("마커가 없는 페이지는 변경하지 않는다", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <section class="docx"><footer><span>고정 텍스트</span></footer></section>
    `;
    injectPageNumbers(container, 1);

    expect(container.querySelector("footer span")?.textContent).toBe(
      "고정 텍스트",
    );
  });
});
