/**
 * 한글 수식 스크립트 → LaTeX 변환기 (자리표시 스텁).
 *
 * 실제 구현은 별도 작업이 같은 경로에 넣는다. 변환하지 못하면 null을
 * 돌려주는 계약이며, 호출측(HWPX 파서)은 null이면 원본 스크립트를 인라인
 * 코드로 남기고 경고를 단다.
 */
export function hwpEquationToLatex(_script: string): string | null {
  return null;
}
