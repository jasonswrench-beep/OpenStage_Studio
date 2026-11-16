// Checks the licence of every installed JavaScript package and every Rust crate against the accepted list in
// tools/licence-rules.mjs (the same list as CLAUDE.md). Refuses GPL and AGPL. Flags LGPL (dynamic linking only) and any
// licence not on the list for a person to decide. Packages under MPL-2.0 must be named in NOTICE.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { classify, usesMpl, READ_BY_HAND } from "./licence-rules.mjs";

const problems = [];
const reviews = [];
const mpl = new Set();
let count = 0;

function judge(kind, name, version, licence) {
  count++;
  const id = `${name}@${version}`;
  const text = String(licence ?? "").trim() || READ_BY_HAND.get(id) || "";
  if (!text) return reviews.push(`${kind} ${id}: licence not stated`);
  const verdict = classify(text);
  if (verdict === "refused") return problems.push(`${kind} ${id}: ${text}`);
  if (verdict === "lgpl") return reviews.push(`${kind} ${id}: ${text} (dynamic linking only)`);
  if (verdict === "unknown") return reviews.push(`${kind} ${id}: ${text} (not on the accepted list)`);
  if (usesMpl(text)) mpl.add(name);
}

function scanNode(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.name.startsWith("@")) { scanNode(path); continue; }
    const pkg = join(path, "package.json");
    if (!existsSync(pkg)) continue;
    const data = JSON.parse(readFileSync(pkg, "utf8"));
    const lic = typeof data.license === "string" ? data.license : data.license?.type ?? (data.licenses ?? []).map((l) => l.type).join(" OR ");
    judge("npm", data.name, data.version, lic);
  }
}

scanNode("node_modules");

// The app shell and the helper (its own Rust program, with the shared core's capture engine inside it).
const seen = new Set();
for (const manifest of ["src-tauri/Cargo.toml", "studio-helper/Cargo.toml"]) {
  if (!existsSync(manifest)) continue;
  try {
    const out = execSync(`cargo metadata --format-version 1 --manifest-path ${manifest}`, { maxBuffer: 1 << 28 }).toString();
    for (const p of JSON.parse(out).packages) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      judge("crate", p.name, p.version, p.license);
    }
  } catch {
    reviews.push(`The Rust crates in ${manifest} were not checked because cargo could not run. Install Rust and run this again.`);
  }
}

// Software built into the app that no package list shows. ONNX Runtime arrives as a prebuilt library; its notices list
// Eigen under MPL-2.0 (see NOTICE).
mpl.add("Eigen");

const notice = existsSync("NOTICE") ? readFileSync("NOTICE", "utf8") : "";
const unnamed = [...mpl].filter((name) => !notice.includes(name));
if (unnamed.length) reviews.push(`Under MPL-2.0 but not named in NOTICE (say where their source is): ${unnamed.join(", ")}`);

// The Node.js the installer carries: its licence file was audited for the pinned version, and NOTICE names that version.
// A new pin needs a new audit of its LICENSE (anything not on the accepted list is a person's call) and NOTICE updated.
if (existsSync(join("tools", "node-runtime.json"))) {
  const node = JSON.parse(readFileSync(join("tools", "node-runtime.json"), "utf8"));
  count++;
  if (!notice.includes(`Node.js ${node.version} `)) reviews.push(`Node.js ${node.version} (tools/node-runtime.json) is not the version NOTICE names: audit its LICENSE, then update NOTICE`);
}

console.log(`Checked ${count} packages.`);
console.log(`Under MPL-2.0, used unchanged and named in NOTICE: ${[...mpl].filter((n) => !unnamed.includes(n)).sort().join(", ") || "none"}.`);
if (reviews.length) { console.log("\nNeeds a human look:"); reviews.forEach((r) => console.log("  - " + r)); }
if (problems.length) {
  console.log("\nREFUSED (GPL or AGPL):"); problems.forEach((p) => console.log("  - " + p));
  console.log("\nThe licence check FAILED.");
  process.exit(1);
}
console.log(reviews.length
  ? "\nThe licence check passed (no GPL or AGPL), with the items above for a person to look at."
  : "\nThe licence check passed. Every package is under a licence on the accepted list.");
