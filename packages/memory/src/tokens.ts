// ponytail: 토크나이저를 붙이지 않는다. 소비처는 (a) A4 §12.3 self-model 상한 경고와
// (b) A4 §1.3 절삭 트리거뿐이고, 둘 다 10% 오차로 결론이 바뀌지 않는다. 실제 청구 토큰은
// agent_runs.tokens_in이 사후에 알려준다. 정확도가 문제가 되면 tiktoken으로 바꾼다.
const ASCII_CHARS_PER_TOKEN = 4;
const WIDE_CHARS_PER_TOKEN = 1.5;

export function estimateTokens(s: string): number {
  let ascii = 0;
  let wide = 0;
  for (const ch of s) {
    if ((ch.codePointAt(0) ?? 0) < 0x80) ascii += 1;
    else wide += 1;
  }
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + wide / WIDE_CHARS_PER_TOKEN);
}
