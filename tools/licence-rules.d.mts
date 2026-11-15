// Types for licence-rules.mjs, so the tests can import it.
export const ACCEPTED: Map<string, string>;
export const READ_BY_HAND: Map<string, string>;
export function classify(expression: string | null | undefined): "ok" | "lgpl" | "refused" | "unknown";
export function usesMpl(expression: string | null | undefined): boolean;
