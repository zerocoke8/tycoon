// 한국어 글자 도우미 (토스트·실패 이유).

/** 받침에 맞는 조사를 붙인다. josa('보석', '이', '가') → '보석이'. */
export function josa(word: string, withBatchim: string, without: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (Number.isNaN(c) || c < 0xac00 || c > 0xd7a3) return word + without;
  return word + ((c - 0xac00) % 28 > 0 ? withBatchim : without);
}
