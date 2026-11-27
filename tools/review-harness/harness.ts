// A stand-in for the app's file access, so the review screen can be tried in a browser during development
// (`npm run dev`, then /tools/review-harness/?folder=renders/planted-path). Reads come from this project's folder through
// the development server; writes are kept in memory and listed in window.__writes. A folder dialog answers with
// window.__nextDialog, or a made-up folder. Never part of the built app.

/** The project's folder, from the development server (vite.config.ts). */
declare const __PROJECT_FOLDER__: string;
const ROOT = __PROJECT_FOLDER__;
const params = new URLSearchParams(location.search);
const folder = `${ROOT}\\${(params.get("folder") ?? "renders/planted-path").replace(/\//g, "\\")}`;

const writes = new Map<string, Uint8Array>();
const dirs = new Set<string>();
(window as unknown as Record<string, unknown>).__writes = writes;
(window as unknown as Record<string, unknown>).__nextDialog = "C:\\HarnessPackages";

const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+/g, "\\");
const url = (p: string) => {
  const n = norm(p);
  if (!n.toLowerCase().startsWith(ROOT.toLowerCase())) throw new Error(`forbidden path (outside the project): ${p}`);
  return n.slice(ROOT.length).replace(/\\/g, "/");
};

async function read(path: string): Promise<Uint8Array> {
  const n = norm(path);
  if (writes.has(n)) return writes.get(n)!;
  const r = await fetch(url(n));
  if (!r.ok) throw new Error(`failed to read ${path}`);
  return new Uint8Array(await r.arrayBuffer());
}

type Args = Record<string, unknown>;
async function invoke(cmd: string, args: unknown, options?: { headers?: Record<string, string> }): Promise<unknown> {
  const a = (args ?? {}) as Args;
  switch (cmd) {
    case "plugin:path|join":
      return norm((a.paths as string[]).join("\\"));
    case "plugin:fs|read_text_file":
    case "plugin:fs|read_file":
      return (await read(a.path as string)).buffer;
    case "plugin:fs|write_text_file": {
      const path = norm(decodeURIComponent(options!.headers!.path));
      writes.set(path, args as Uint8Array);
      console.log(`[harness] wrote ${path}`);
      return null;
    }
    case "plugin:fs|copy_file":
      writes.set(norm(a.toPath as string), await read(a.fromPath as string));
      console.log(`[harness] copied ${a.fromPath} to ${a.toPath}`);
      return null;
    case "plugin:fs|mkdir":
      dirs.add(norm(a.path as string));
      return null;
    case "plugin:fs|exists": {
      const n = norm(a.path as string);
      if (writes.has(n) || dirs.has(n)) return true;
      try {
        return (await fetch(url(n), { method: "HEAD" })).ok;
      } catch {
        return false;
      }
    }
    case "plugin:fs|read_dir": {
      const base = norm(a.path as string).toLowerCase() + "\\";
      const names = new Set<string>();
      for (const d of [...dirs, ...writes.keys()]) if (d.toLowerCase().startsWith(base)) names.add(d.slice(base.length).split("\\")[0]);
      return [...names].map((name) => ({ name, isDirectory: dirs.has(norm(`${a.path}\\${name}`)), isFile: false, isSymlink: false }));
    }
    case "plugin:dialog|open":
      return (window as unknown as Record<string, unknown>).__nextDialog;
    default:
      throw new Error(`The harness does not stand in for ${cmd}.`);
  }
}

(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke,
  transformCallback: () => 0,
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
};
(window as unknown as Record<string, unknown>).__OPENSTAGE_REVIEW__ = folder;
await import("../../src/main.ts");
