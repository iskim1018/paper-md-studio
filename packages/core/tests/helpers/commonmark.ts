import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * 변환 결과를 실제 Markdown 렌더러가 읽는 방식으로 읽는다.
 *
 * 앱 미리보기(react-markdown)와 편집기(Milkdown Crepe)는 모두 micromark 기반
 * remark-parse + remark-gfm 위에서 돌고, Crepe 는 remark-math 를 기본으로 켠다.
 * 문자열 비교만으로는 "글자는 맞지만 렌더러에서 목록·수식·굵게가 깨지는" 결함을
 * 잡을 수 없어(CommonMark 의 flanking·목록 번호 규칙), 같은 파서로 구조를 본다.
 */

/** mdast 노드 — 테스트에 필요한 필드만 */
export interface MdNode {
  readonly type: string;
  readonly value?: string;
  readonly start?: number | null;
  readonly ordered?: boolean | null;
  readonly url?: string;
  readonly children?: ReadonlyArray<MdNode>;
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export function parseMarkdown(markdown: string): MdNode {
  return processor.parse(markdown) as unknown as MdNode;
}

/** 트리에서 해당 type 의 노드를 문서 순서대로 모은다 */
export function nodesOfType(tree: MdNode, type: string): Array<MdNode> {
  const found: Array<MdNode> = [];
  const visit = (node: MdNode): void => {
    if (node.type === type) found.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return found;
}

/** 노드 아래 글자를 이어 붙인다 (text·inlineCode·inlineMath 값) */
export function textOf(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}
