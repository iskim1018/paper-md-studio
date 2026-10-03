/**
 * 한컴 보조 평면 PUA-A(U+F0000~) 기호 → 표준 유니코드 매핑.
 *
 * 한/글 2004+는 유니코드에 대응 문자가 없(다고 판단했)던 기호를
 * Plane 15 사설영역에 저장한다. 이 문자들은 한컴 글꼴에서만
 * 렌더링되므로 변환 결과에서 깨져 보인다.
 *
 * 이 표는 함초롬바탕(HANBatang.ttf) 글리프를 비트맵 정규화 비교로
 * 표준 기호 글리프와 대조해 자동 생성(오차 ≤10/576비트)하고,
 * 삼각형 블록(U+F02F0~FF)·음표는 렌더링 시각 확인으로 수동 검증했다.
 * 매핑에 없는 코드는 원본을 유지한다.
 */
export const HANCOM_P15_SYMBOL_MAP: Readonly<Record<number, string>> = {
  983049: "\u{23AC}", // ⎬ Right Curly Bracket Middle Piece
  983050: "\u{239B}", // ⎛ Left Parenthesis Upper Hook
  983052: "\u{23A7}", // ⎧ Left Curly Bracket Upper Hook
  983054: "\u{23A1}", // ⎡ Left Square Bracket Upper Corner
  983062: "\u{239D}", // ⎝ Left Parenthesis Lower Hook
  983064: "\u{23A9}", // ⎩ Left Curly Bracket Lower Hook
  983066: "\u{23A3}", // ⎣ Left Square Bracket Lower Corner
  983117: "\u{268C}", // ⚌ Digram For Greater Yang
  983125: "\u{266C}", // ♬ Beamed Sixteenth Notes
  983135: "\u{266A}", // ♪ Eighth Note
  983291: "\u{3280}", // ㊀ Circled Ideograph One
  983447: "\u{25CF}", // ● Black Circle
  983448: "\u{25CF}", // ● Black Circle
  983688: "\u{24EA}", // ⓪ Circled Digit Zero
  // ── 네모 숫자 (2026-10-03) ──
  // U+F02B0~U+F02B9와 U+F02BA~U+F02C2는 함초롬바탕에서 네모 안 숫자 0~9,
  // 1~9다(렌더링 시각 확인). 유니코드에 네모 숫자가 없어 같은 "둘러싼 숫자"인
  // 원문자로 옮긴다 — kordoc과 같은 선택이라 .hwp 기존 출력과도 맞는다.
  // kordoc은 U+F02BA부터 ⑩·⑪…로 이어 붙였지만 글리프는 다시 1이고,
  // U+F02C3부터는 장식 없는 숫자라 매핑하지 않는다.
  983728: "\u{24EA}", // ⓪ (네모 0)
  983729: "\u{2460}", // ① (네모 1)
  983730: "\u{2461}", // ②
  983731: "\u{2462}", // ③
  983732: "\u{2463}", // ④
  983733: "\u{2464}", // ⑤
  983734: "\u{2465}", // ⑥
  983735: "\u{2466}", // ⑦
  983736: "\u{2467}", // ⑧
  983737: "\u{2468}", // ⑨ (네모 9)
  983738: "\u{2460}", // ① (두 번째 네모 1)
  983739: "\u{2461}", // ②
  983740: "\u{2462}", // ③
  983741: "\u{2463}", // ④
  983742: "\u{2464}", // ⑤
  983743: "\u{2465}", // ⑥
  983744: "\u{2466}", // ⑦
  983745: "\u{2467}", // ⑧
  983746: "\u{2468}", // ⑨ (두 번째 네모 9)
  983787: "\u{25FB}", // ◻ White Medium Square
  983790: "\u{29EB}", // ⧫ Black Lozenge
  983791: "\u{25C6}", // ◆ Black Diamond
  983792: "\u{25B5}", // ▵ White Up-Pointing Small Triangle
  983793: "\u{25B4}", // ▴ Black Up-Pointing Small Triangle
  983794: "\u{25B2}", // ▲ Black Up-Pointing Triangle
  983795: "\u{25BD}", // ▽ White Down-Pointing Triangle
  983796: "\u{25BF}", // ▿ White Down-Pointing Small Triangle
  983797: "\u{25BC}", // ▼ Black Down-Pointing Triangle
  983798: "\u{25C3}", // ◃ White Left-Pointing Small Triangle
  983799: "\u{25C1}", // ◁ White Left-Pointing Triangle
  983800: "\u{25C0}", // ◀ Black Left-Pointing Triangle
  983801: "\u{25B9}", // ▹ White Right-Pointing Small Triangle
  983802: "\u{25B7}", // ▷ White Right-Pointing Triangle
  983803: "\u{25B8}", // ▸ Black Right-Pointing Small Triangle
  983804: "\u{25B6}", // ▶ Black Right-Pointing Triangle
  983805: "\u{25C0}", // ◀ Black Left-Pointing Triangle
  983806: "\u{25B2}", // ▲ Black Up-Pointing Triangle
  983807: "\u{25BC}", // ▼ Black Down-Pointing Triangle
  983835: "\u{20E6}", // ⃦ Combining Double Vertical Stroke Overlay
  983836: "\u{20E6}", // ⃦ Combining Double Vertical Stroke Overlay
  983857: "\u{2AFC}", // ⫼ Large Triple Vertical Bar Operator
  984219: "\u{B9}", // ¹ Superscript One
  984222: "\u{2074}", // ⁴ Superscript Four
  984229: "\u{B9}", // ¹ Superscript One
  984232: "\u{2074}", // ⁴ Superscript Four
  984320: "\u{2395}", // ⎕ Apl Functional Symbol Quad
  984321: "\u{20E6}", // ⃦ Combining Double Vertical Stroke Overlay
  984751: "\u{2395}", // ⎕ Apl Functional Symbol Quad
  985090: "\u{20ED}", // ⃭ Combining Leftwards Harpoon With Barb Downwards
  985091: "\u{20ED}", // ⃭ Combining Leftwards Harpoon With Barb Downwards
  985094: "\u{250E}", // ┎ Box Drawings Down Heavy And Right Light
  985095: "\u{22A4}", // ⊤ Down Tack
  985097: "\u{2520}", // ┠ Box Drawings Vertical Heavy And Right Light
  985098: "\u{2064}", // ⁤ Invisible Plus
  985100: "\u{2516}", // ┖ Box Drawings Up Heavy And Right Light
  985101: "\u{22A5}", // ⊥ Up Tack
  985103: "\u{2500}", // ─ Box Drawings Light Horizontal
  985114: "\u{20E6}", // ⃦ Combining Double Vertical Stroke Overlay
  985115: "\u{20E6}", // ⃦ Combining Double Vertical Stroke Overlay
  985144: "\u{256A}", // ╪ Box Drawings Vertical Single And Horizontal Double
  985147: "\u{2567}", // ╧ Box Drawings Up Single And Horizontal Double
  985160: "\u{2500}", // ─ Box Drawings Light Horizontal
};
