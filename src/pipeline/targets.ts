// How the player names a control that the accessibility driver finds by role and name (a step's `fallback`) rather
// than by an id: `@button|Save lesson`. Only the player and the driver see these names; scripts never contain them.

import type { Script, Step } from "../script/format.ts";

export const fallbackId = (role: string | undefined, name: string) => `@${role ?? ""}|${name}`;

export function keyOf(id: string): { id?: string; role?: string; name?: string } {
  if (!id.startsWith("@")) return { id };
  const [role, ...name] = id.slice(1).split("|");
  return { ...(role ? { role } : {}), name: name.join("|") };
}

/** The script with every step that names its control by role and name given an id the player can pass along. Scripts
 * for the hook are returned as they are. */
export function accessibleScript(script: Script): Script {
  if (script.driver !== "accessibility") return script;
  const fill = (s: Step): Step => (s.target || !s.fallback?.name ? s : { ...s, target: fallbackId(s.fallback.role, s.fallback.name) });
  return { ...script, steps: script.steps.map(fill) };
}
