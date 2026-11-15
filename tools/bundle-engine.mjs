// Bundles the engine (src/engine/main.ts and everything it uses, with Anthropic's SDK and PDF.js) into one file for the
// installer: src-tauri/engine/engine.mjs, with PDF.js's worker file beside it (PDF.js loads it by name at run time).
// Installed Studio runs it with its own copy of Node.js; nothing else is needed on the computer.
//
// node tools/bundle-engine.mjs

import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src-tauri", "engine");

export async function bundleEngine({ quiet = false } = {}) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, "engine.mjs");
  await build({
    entryPoints: [join(ROOT, "src", "engine", "main.ts")],
    outfile: file,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Every module in the bundle shares one address; this tells them only the engine's own command line should start
    // (src/util/is-main.ts).
    define: { __OPENSTAGE_BUNDLED__: "true" },
    // Packages written the older way ask for Node's own modules with require(); give the bundle one.
    banner: { js: 'import { createRequire as __studioRequire } from "node:module"; const require = __studioRequire(import.meta.url);' },
    legalComments: "eof",
    logLevel: quiet ? "error" : "warning",
  });
  copyFileSync(join(ROOT, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"), join(OUT, "pdf.worker.mjs"));
  return { file, bytes: statSync(file).size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { file, bytes } = await bundleEngine();
  console.log(`The engine is bundled: ${file} (${(bytes / 1048576).toFixed(1)} MB), with PDF.js's worker beside it.`);
}
