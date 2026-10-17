const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Node and edge ids: client-generated, URL-safe, unique within a document. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Operation ids are readable slugs, e.g. "redirect" or "create-link". */
export const OPERATION_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** A random id such as `n_4fJ9xQ2kLm`. 10 characters from 62 gives ~59 bits. */
export function createId(prefix: "n" | "e"): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = `${prefix}_`;
  // 62 doesn't divide 256, so the modulo is very slightly biased. Fine for uniqueness within a document.
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

/** Turns a name into an operation id that doesn't collide with `taken`. */
export function operationIdFromName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "operation";
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}
