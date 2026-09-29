const encoder = new TextEncoder();

/** Constant-time comparison of a presented secret against the expected one.
 *  Hand-rolled because app/ is typed against the DOM's SubtleCrypto, which
 *  lacks the Workers-only `timingSafeEqual`. */
export function secretMatches(presented: string | null, expected: string): boolean {
  if (!presented || !expected) return false;
  const a = encoder.encode(presented);
  const b = encoder.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
