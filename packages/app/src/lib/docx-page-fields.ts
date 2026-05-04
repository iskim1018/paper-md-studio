/**
 * docx-preview는 PAGE/NUMPAGES 필드(fldSimple 및 복잡 필드)를 렌더하지 않는다:
 * - render 스위치에 SimpleField 케이스가 없어 fldSimple이 통째로 사라짐
 * - 복잡 필드의 instrText/fldChar 포함 run은 fieldRun=true로 마크되어 null 반환
 *   (캐시값 run이 별도로 있으면 살아남지만 fldSimple은 캐시값까지 사라짐)
 *
 * 워크어라운드: docx-preview에 넘기기 전에 헤더/푸터 XML을 전처리해
 * PAGE/NUMPAGES 필드를 마커 텍스트 run으로 치환하고, 렌더 후 각 페이지의
 * 마커를 실제 번호로 교체한다.
 */

const PAGE_MARKER = "DPMSPAGE";
const NUMPAGES_MARKER = "DPMSNUMPAGES";

const HEADER_FOOTER_PATH = /^word\/(header|footer)\d*\.xml$/;
const PAGE_INSTR = /\bPAGE\b/i;
const NUMPAGES_INSTR = /\bNUMPAGES\b/i;

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function createMarkerRun(doc: Document, marker: string): Element {
  const r = doc.createElementNS(W_NS, "w:r");
  const t = doc.createElementNS(W_NS, "w:t");
  t.setAttribute("xml:space", "preserve");
  t.textContent = marker;
  r.appendChild(t);
  return r;
}

function patchSimpleFields(doc: Document): void {
  const simples = Array.from(doc.getElementsByTagNameNS(W_NS, "fldSimple"));
  for (const fld of simples) {
    const instr =
      fld.getAttributeNS(W_NS, "instr") ?? fld.getAttribute("w:instr") ?? "";
    const marker = NUMPAGES_INSTR.test(instr)
      ? NUMPAGES_MARKER
      : PAGE_INSTR.test(instr)
        ? PAGE_MARKER
        : null;
    if (!marker || !fld.parentNode) continue;
    fld.parentNode.replaceChild(createMarkerRun(doc, marker), fld);
  }
}

function getRunFldCharType(run: Element): string | null {
  const fldChar = run.getElementsByTagNameNS(W_NS, "fldChar")[0];
  if (!fldChar) return null;
  return (
    fldChar.getAttributeNS(W_NS, "fldCharType") ??
    fldChar.getAttribute("w:fldCharType")
  );
}

function getRunInstrText(run: Element): string {
  return run.getElementsByTagNameNS(W_NS, "instrText")[0]?.textContent ?? "";
}

function instrToMarker(instr: string): string | null {
  if (NUMPAGES_INSTR.test(instr)) return NUMPAGES_MARKER;
  if (PAGE_INSTR.test(instr)) return PAGE_MARKER;
  return null;
}

function replaceComplexFieldRange(
  doc: Document,
  paragraph: Element,
  runs: Array<Element>,
  beginIdx: number,
  endIdx: number,
  marker: string,
): void {
  const markerRun = createMarkerRun(doc, marker);
  paragraph.insertBefore(markerRun, runs[beginIdx] ?? null);
  for (let j = beginIdx; j <= endIdx; j++) {
    const r = runs[j];
    if (r?.parentNode) r.parentNode.removeChild(r);
  }
}

function patchComplexFieldsInParagraph(
  doc: Document,
  paragraph: Element,
): void {
  const runs = Array.from(paragraph.children).filter(
    (el) => el.localName === "r" && el.namespaceURI === W_NS,
  );

  let beginIdx = -1;
  let instr = "";

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;

    const charType = getRunFldCharType(run);

    if (charType === "begin") {
      beginIdx = i;
      instr = "";
      continue;
    }

    if (beginIdx < 0) continue;

    if (charType === "end") {
      const marker = instrToMarker(instr);
      if (marker) {
        replaceComplexFieldRange(doc, paragraph, runs, beginIdx, i, marker);
      }
      beginIdx = -1;
      instr = "";
    } else {
      instr += getRunInstrText(run);
    }
  }
}

function patchComplexFields(doc: Document): void {
  const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, "p"));
  for (const p of paragraphs) {
    patchComplexFieldsInParagraph(doc, p);
  }
}

export async function preprocessDocxPageFields(
  arrayBuffer: ArrayBuffer,
): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(arrayBuffer);

  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const targets = Object.keys(zip.files).filter((p) =>
    HEADER_FOOTER_PATH.test(p),
  );
  for (const path of targets) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const doc = parser.parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) continue;
    patchSimpleFields(doc);
    patchComplexFields(doc);
    zip.file(path, serializer.serializeToString(doc));
  }

  return await zip.generateAsync({ type: "arraybuffer" });
}

export function injectPageNumbers(
  container: HTMLElement,
  pageCount: number,
): void {
  const sections = container.querySelectorAll<HTMLElement>("section.docx");
  sections.forEach((section, i) => {
    const pageNum = String(i + 1);
    const total = String(pageCount);
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    const toUpdate: Array<Text> = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue ?? "";
      if (text.includes(PAGE_MARKER) || text.includes(NUMPAGES_MARKER)) {
        toUpdate.push(node as Text);
      }
      node = walker.nextNode();
    }
    for (const textNode of toUpdate) {
      const text = textNode.nodeValue ?? "";
      textNode.nodeValue = text
        .replaceAll(NUMPAGES_MARKER, total)
        .replaceAll(PAGE_MARKER, pageNum);
    }
  });
}

export const __TEST_MARKERS__ = {
  PAGE_MARKER,
  NUMPAGES_MARKER,
};
