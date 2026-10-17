/** JSON with object keys sorted and undefined values dropped, so equal values always serialize the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortKeys) ?? "null";
}

function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) sorted[k] = (value as Record<string, unknown>)[k];
  return sorted;
}

/**
 * 64-bit non-cryptographic hash (two 32-bit lanes, cyrb53-style mixing) over UTF-16 code units, as 16 hex
 * digits. Used to recognise identical simulation inputs, not for security.
 */
export function hash64(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
