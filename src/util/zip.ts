// Reading zip files: OpenExplainer project files (stored without compression) and the AI runtime's download (compressed).
// Only reading, only the two ways of storing a file that zip programs use (stored and deflated), and every name is checked
// before anything is made from it, so a zip cannot write outside the folder it is unpacked into.

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  size: number;
  /** The file's bytes, read only when asked for. */
  read(): Buffer;
}

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** A name inside a zip that is safe to unpack: plain parts joined by /, no drive, no "..", no leading slash. */
export function safeName(name: string): boolean {
  return name.length > 0 && name.length < 400 && !/^[\\/]|^[A-Za-z]:|\\/.test(name) && !name.split("/").some((p) => p === ".." || p === ".");
}

/** The entries of a zip file. Throws, in words, if it is not one. An entry that does not unpack to exactly the size the zip
 * gives for it is refused, and so is reading more than `mostRead` bytes from one zip in all, so a small crafted file cannot
 * fill the computer's memory. */
export function readZip(data: Buffer, mostRead = Infinity): ZipEntry[] {
  let left = mostRead;
  // The end record is in the last 64 KB (it may be followed by a comment).
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This is not a zip file (or it is damaged).");
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (data.readUInt32LE(at) !== CENTRAL) throw new Error("The zip file's list of contents is damaged.");
    const method = data.readUInt16LE(at + 10);
    const packed = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const nameLen = data.readUInt16LE(at + 28);
    const extraLen = data.readUInt16LE(at + 30);
    const commentLen = data.readUInt16LE(at + 32);
    const localAt = data.readUInt32LE(at + 42);
    const name = data.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (packed === 0xffffffff || size === 0xffffffff) throw new Error(`${name} is too large for this reader.`);
    entries.push({
      name,
      size,
      read() {
        if (data.readUInt32LE(localAt) !== LOCAL) throw new Error(`${name} is damaged in the zip file.`);
        const start = localAt + 30 + data.readUInt16LE(localAt + 26) + data.readUInt16LE(localAt + 28);
        const raw = data.subarray(start, start + packed);
        if (method !== 0 && method !== 8) throw new Error(`${name} is stored in a way this reader does not know (method ${method}).`);
        if (size > left) throw new Error("The zip file holds more than this reader will unpack.");
        const wrong = () => new Error(`${name} does not unpack to the size the zip file gives for it. The file is damaged, or was made to mislead.`);
        let out: Buffer;
        try {
          // The reader stops one byte past the stated size (a limit of 0 is not allowed).
          out = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: size + 1 });
        } catch {
          throw wrong();
        }
        if (out.length !== size) throw wrong();
        left -= size;
        return out;
      },
    });
  }
  return entries;
}

/** Whether a file name matches a pattern with * standing for any letters, such as ggml-cpu*.dll. */
export function matches(name: string, pattern: string): boolean {
  const re = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
  return re.test(name);
}
