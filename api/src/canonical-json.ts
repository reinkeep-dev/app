// Stable JSON: object keys sorted, no whitespace. The same data always gives the same bytes,
// so a hash made here matches a hash anyone recomputes later, in any language.
// Only plain JSON is accepted. bigint, undefined at the top, functions and non-finite numbers throw
// instead of being written out differently by different runtimes.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: number is not finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
  }
  throw new Error(`canonicalJson: cannot encode ${typeof value}`);
}
