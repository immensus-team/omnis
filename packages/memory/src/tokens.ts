// ponytail: no tokenizer is wired in. The only consumers are (a) the A4 §12.3 self-model cap
// warning and (b) the A4 §1.3 truncation trigger, and a 10% error changes neither conclusion.
// The actual billed tokens are reported after the fact by agent_runs.tokens_in. Switch to
// tiktoken if accuracy ever matters.
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
