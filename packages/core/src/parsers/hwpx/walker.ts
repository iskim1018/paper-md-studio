import {
  type HwpxContext,
  MAX_OBJECT_DEPTH,
  type WalkMode,
} from "./context.js";
import {
  autoNumberText,
  captionOf,
  DRAWING_OBJECTS,
  drawTextParagraphs,
  EMBEDDED_OBJECTS,
  hyperlinkUrl,
  subListParagraphs,
  textArtTokens,
} from "./controls.js";
import { renderEquation } from "./equation.js";
import type { CharStyles } from "./header.js";
import {
  InlineBuilder,
  PLAIN_STYLE,
  protectCellPipes,
  type RunStyle,
} from "./inline-builder.js";
import { tokenizeRunText } from "./inline-tokens.js";
import {
  attr,
  childNode,
  childNodes,
  orderedChildren,
  textOf,
  type XmlChild,
  type XmlNode,
} from "./xml.js";

/**
 * 문단 하나를 문서 순서대로 훑은 결과 조각.
 *
 * 글자·수식·각주·(셀에서는) 그림은 한 줄 흐름(inline)으로 모이고, 표·글상자·
 * (본문에서는) 그림은 흐름을 끊는 블록이 된다. 블록 앞뒤의 글자는 각각 다른
 * inline 조각이 되어 원래 순서를 지킨다 — 종전엔 한 문단 안의 표를 늘 글자보다
 * 먼저 내서, 표 앞 글이 표 뒤로 밀렸다.
 */
export type Segment =
  | { readonly kind: "inline"; readonly html: string }
  | { readonly kind: "image"; readonly html: string }
  | { readonly kind: "table"; readonly node: XmlNode }
  | {
      readonly kind: "paragraphs";
      readonly paragraphs: ReadonlyArray<XmlNode>;
    };

function styleOf(charStyles: CharStyles, charPrId: string): RunStyle {
  if (!charPrId) return PLAIN_STYLE;
  return {
    strong: charStyles.boldIds.has(charPrId),
    em: charStyles.italicIds.has(charPrId),
    del: charStyles.strikeIds.has(charPrId),
  };
}

/** `<hp:pic>`·`<hp:img>`의 BinData 참조 */
function binaryRef(node: XmlNode): string {
  const own = attr(node, "binaryItemIDRef");
  if (own) return own;
  const img = childNode(node, "img");
  return img ? attr(img, "binaryItemIDRef") : "";
}

class ParagraphWalker {
  private readonly segments: Array<Segment> = [];
  private builder: InlineBuilder;
  private style: RunStyle = PLAIN_STYLE;
  /** 열린 필드 스택 — 하이퍼링크면 true */
  private readonly fields: Array<boolean> = [];

  constructor(
    private readonly ctx: HwpxContext,
    private readonly mode: WalkMode,
  ) {
    this.builder = new InlineBuilder(mode);
  }

  walk(paragraph: XmlNode): Array<Segment> {
    for (const run of childNodes(paragraph, "run")) {
      this.style = styleOf(
        this.ctx.header.charStyles,
        attr(run, "charPrIDRef"),
      );
      this.visitChildren(run);
    }
    this.flush();
    return this.segments;
  }

  private visitChildren(node: XmlNode): void {
    for (const child of orderedChildren(node)) this.visit(child);
  }

  private visit({ name, node }: XmlChild): void {
    switch (name) {
      case "t":
        this.text(node);
        return;
      case "ctrl":
        for (const child of orderedChildren(node)) {
          this.control(child.name, child.node);
        }
        return;
      case "tbl":
        if (!this.dropIfDeleted()) this.block({ kind: "table", node });
        return;
      case "pic":
      case "img":
        this.image(node);
        return;
      case "equation":
        this.equation(node);
        return;
      case "container":
        this.container(node);
        return;
      case "switch":
        this.visitSwitch(node);
        return;
      case "dutmal":
        this.dutmal(node);
        return;
      case "compose":
        // 글자 겹치기 — 겹쳐 그린 글자들이 속성에 있다
        this.plainText(attr(node, "composeText"));
        return;
      default:
        this.control(name, node);
    }
  }

  /**
   * 조판 부호(ctrl 자식)와, 같은 이름이 run에 직접 온 비표준 경로.
   * 머리말·꼬리말은 쪽 장식이라 본문에 넣지 않는다.
   */
  private control(name: string, node: XmlNode): void {
    switch (name) {
      case "footNote":
        this.note(node, "각주");
        return;
      case "endNote":
        this.note(node, "미주");
        return;
      case "fieldBegin":
        this.fieldBegin(node);
        return;
      case "fieldEnd":
        if (this.fields.pop()) this.builder.closeLink();
        return;
      case "deleteBegin":
        this.ctx.state.beginDelete();
        return;
      case "deleteEnd":
        this.ctx.state.endDelete();
        return;
      case "autoNum":
        this.autoNum(node);
        return;
      case "textart":
        this.textArt(node);
        return;
      default:
        this.shape(name, node);
    }
  }

  /**
   * 그 밖의 개체. 그리기 개체는 글상자를, 내장 개체(OLE·차트·동영상)는 내용을
   * 옮길 수 없어 캡션만 내고 개수를 센다. 양식 개체 등 나머지도 캡션이 있으면
   * 낸다 — OWPML 에서 캡션은 모든 개체가 가질 수 있다.
   */
  private shape(name: string, node: XmlNode): void {
    if (DRAWING_OBJECTS.has(name)) {
      this.drawing(node);
      return;
    }
    const embedded = EMBEDDED_OBJECTS.has(name);
    if (!embedded && !childNode(node, "caption")) return;
    if (this.dropIfDeleted()) return;
    this.withCaption(node, () => {
      if (embedded) this.ctx.state.skipObject(name);
    });
  }

  /** 글맵시 — 글자를 따로 한 흐름으로 낸다 (떠 있는 개체라 앞뒤 글과 섞지 않는다) */
  private textArt(node: XmlNode): void {
    if (this.dropIfDeleted()) return;
    this.withCaption(node, () => {
      this.flush();
      for (const token of textArtTokens(node)) {
        this.builder.token(token, PLAIN_STYLE);
      }
      this.flush();
    });
  }

  /**
   * 변경 추적 삭제 구간이면 내용을 버리고 true. 글자만이 아니라 그림·수식·
   * 표·각주·글상자·링크도 같이 버린다 — OWPML 에서 이 개체들은 deleteBegin 과
   * deleteEnd 를 담은 `<hp:t>` 사이에 run 형제로 놓인다.
   */
  private dropIfDeleted(): boolean {
    if (!this.ctx.state.isDeleting) return false;
    this.builder.markDeleted();
    return true;
  }

  private text(node: XmlNode): void {
    for (const token of tokenizeRunText(textOf(node))) {
      if (token.kind === "deleteBegin") this.ctx.state.beginDelete();
      else if (token.kind === "deleteEnd") this.ctx.state.endDelete();
      else if (!this.dropIfDeleted()) this.builder.token(token, this.style);
    }
  }

  /** 문서가 정한 글자 조각 — 본문 글자와 같이 정규화·escape 한다 */
  private plainText(value: string): void {
    if (!value || this.dropIfDeleted()) return;
    this.builder.token({ kind: "text", value }, this.style);
  }

  /**
   * 덧말 — 본문 글자(mainText) 위·아래에 작은 글자(subText)를 단 것. 본문
   * 글자가 문장의 일부이므로 반드시 내고, 덧말은 정보를 잃지 않게 괄호로
   * 잇는다 (한자 독음·약어 풀이처럼 덧말이 뜻을 보충하는 경우가 대부분이다).
   */
  private dutmal(node: XmlNode): void {
    const main = textOf(childNode(node, "mainText")).trim();
    const sub = textOf(childNode(node, "subText")).trim();
    this.plainText(sub && sub !== main ? `${main}(${sub})` : main);
  }

  /** 캡션 자동 번호 (표·그림·수식) */
  private autoNum(node: XmlNode): void {
    const text = autoNumberText(node, (type, stored) =>
      this.ctx.state.nextAutoNumber(type, stored),
    );
    if (text) this.plainText(text);
  }

  /**
   * 개체를 캡션과 함께 낸다 — 캡션은 개체 앞(위·왼쪽) 또는 뒤에 문단 블록으로.
   * 표 셀·각주 안에서는 블록이 셀 글자로 평탄화된다 (글상자와 같은 경로).
   */
  private withCaption(node: XmlNode, emit: () => void): void {
    const caption = this.mode.depth < MAX_OBJECT_DEPTH ? captionOf(node) : null;
    if (caption?.before) {
      this.block({ kind: "paragraphs", paragraphs: caption.paragraphs });
    }
    emit();
    if (caption && !caption.before) {
      this.block({ kind: "paragraphs", paragraphs: caption.paragraphs });
    }
  }

  private image(node: XmlNode): void {
    if (this.dropIfDeleted()) return;
    this.withCaption(node, () => {
      const html = this.ctx.images.place(binaryRef(node));
      if (!html) return;
      if (this.mode.imagesInline) this.builder.raw(html);
      else this.block({ kind: "image", html });
    });
  }

  private equation(node: XmlNode): void {
    if (this.dropIfDeleted()) return;
    this.withCaption(node, () => {
      const script = childNode(node, "script");
      const rendered = renderEquation(script ? textOf(script) : "", (text) =>
        protectCellPipes(text, this.mode.inCell),
      );
      if (!rendered) return;
      if (rendered.fallback) this.ctx.state.equationFallbacks += 1;
      this.builder.raw(rendered.html);
    });
  }

  /** 묶음 개체 — 안의 그림·글상자·하위 묶음을 같은 규칙으로 훑는다 */
  private container(node: XmlNode): void {
    if (this.dropIfDeleted()) return;
    // 캡션은 withCaption 이 내므로 자식 순회에서는 control()이 무시한다
    this.withCaption(node, () => this.visitChildren(node));
  }

  /** 각주·미주 본문을 기준점 자리에 "(각주: …)"로 넣는다 */
  private note(node: XmlNode, label: string): void {
    if (this.dropIfDeleted() || this.mode.depth >= MAX_OBJECT_DEPTH) return;
    const html = this.ctx
      .renderNote(subListParagraphs(node), {
        ...this.mode,
        imagesInline: true,
        depth: this.mode.depth + 1,
      })
      .trim();
    if (html) this.builder.raw(` (${label}: ${html})`);
  }

  private fieldBegin(node: XmlNode): void {
    // 짝(fieldEnd)을 맞추려고 지운 필드도 스택에는 넣는다
    const url = this.dropIfDeleted() ? null : hyperlinkUrl(node);
    this.fields.push(url !== null);
    if (url) this.builder.openLink(url);
  }

  private drawing(node: XmlNode): void {
    if (this.dropIfDeleted()) return;
    this.withCaption(node, () => {
      const paragraphs = drawTextParagraphs(node);
      if (paragraphs.length === 0 || this.mode.depth >= MAX_OBJECT_DEPTH) {
        return;
      }
      this.block({ kind: "paragraphs", paragraphs });
    });
  }

  /** `<hp:switch>` — 호환용 대체 내용(default)을, 없으면 첫 case를 쓴다 */
  private visitSwitch(node: XmlNode): void {
    const branch = childNode(node, "default") ?? childNode(node, "case");
    if (branch) this.visitChildren(branch);
  }

  /** 흐름을 끊는 블록 — 앞의 글자를 조각으로 내보낸 뒤 블록을 잇는다 */
  private block(segment: Segment): void {
    this.flush();
    this.segments.push(segment);
  }

  private flush(): void {
    const html = this.builder.finish();
    if (this.builder.hasContent) this.segments.push({ kind: "inline", html });
    this.builder = new InlineBuilder(this.mode);
  }
}

/** 문단 하나를 문서 순서대로 조각으로 나눈다 */
export function walkParagraph(
  paragraph: XmlNode,
  ctx: HwpxContext,
  mode: WalkMode,
): Array<Segment> {
  return new ParagraphWalker(ctx, mode).walk(paragraph);
}
