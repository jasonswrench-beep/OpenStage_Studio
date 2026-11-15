// The licences OpenStage Studio accepts, and how a package's licence expression is judged against them.
// The list matches CLAUDE.md ("Licensing"); change both together.

/** Accepted licences, by their standard short names. */
export const ACCEPTED = new Map([
  ["MIT", "permissive"],
  ["MIT-0", "permissive"],
  ["Apache-2.0", "permissive"],
  ["BSD-2-Clause", "permissive"],
  ["BSD-3-Clause", "permissive"],
  ["0BSD", "permissive"],
  ["ISC", "permissive"],
  ["Zlib", "permissive"],
  ["Unlicense", "permissive, public-domain-like"],
  ["CC0-1.0", "permissive, public-domain-like"],
  ["WTFPL", "permissive, public-domain-like (accepted 2026-11-14)"],
  ["Unicode-3.0", "permissive (Unicode data and code)"],
  ["CDLA-Permissive-2.0", "permissive (data)"],
  ["MPL-2.0", "file-level copyleft, accepted 2026-11-14 when used unchanged; NOTICE says where its source is"],
]);

/** Packages whose metadata points at a licence file instead of naming the licence. Each was read by a person; the
 * version is part of the key so an update is looked at again. */
export const READ_BY_HAND = new Map([
  ["language-tokenizer@0.1.0", "WTFPL"], // LICENSE.md: the WTFPL, version 2
]);

// How good a licence is for us, worst first. "AND" takes the worst part, "OR" the best choice.
const RANK = { refused: 0, unknown: 1, lgpl: 2, ok: 3 };
const BY_RANK = Object.keys(RANK);

/** One licence name on its own (an exception such as "WITH LLVM-exception" only ever adds permissions). */
function single(name) {
  if (ACCEPTED.has(name)) return "ok";
  if (/^LGPL/i.test(name)) return "lgpl";
  if (/^A?GPL/i.test(name)) return "refused";
  return "unknown";
}

/**
 * Judges a licence expression such as "MIT OR Apache-2.0", "(MIT OR Apache-2.0) AND Unicode-3.0" or the older
 * "MIT/Apache-2.0". Returns "ok", "lgpl" (dynamic linking only), "refused" (GPL or AGPL) or "unknown" (a person decides).
 */
export function classify(expression) {
  const text = String(expression ?? "").trim();
  if (!text) return "unknown";
  const tokens = text.replace(/\s*\/\s*/g, " OR ").match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const word = (w) => (peek()?.toUpperCase() === w ? (at++, true) : false);

  function factor() {
    if (word("(")) {
      const inner = either();
      word(")");
      return inner;
    }
    const name = tokens[at++];
    if (name === undefined) return "unknown";
    if (word("WITH")) at++;
    return single(name);
  }
  function both() {
    let worst = factor();
    while (word("AND")) worst = BY_RANK[Math.min(RANK[worst], RANK[factor()])];
    return worst;
  }
  function either() {
    let best = both();
    while (word("OR")) best = BY_RANK[Math.max(RANK[best], RANK[both()])];
    return best;
  }
  const verdict = either();
  return at === tokens.length ? verdict : "unknown";
}

/** Whether an expression accepted here relies on MPL-2.0 (so NOTICE must point at the package's source). */
export function usesMpl(expression) {
  const text = String(expression ?? "");
  if (!/MPL-2\.0/.test(text)) return false;
  return classify(text.replace(/MPL-2\.0/g, "NOT-ACCEPTED")) !== "ok";
}
