// Builds src-tauri/icons from the icon pack (OpenStage_Studio_Icon.zip, unpacked): the SVG master and the PNGs from
// 16 to 1024 pixels. Each size is used as drawn (the small ones are hand-tuned), packed into the Windows icon (.ico)
// and the .icns icon (the format some other desktop systems use) without resizing anything. No packages are needed.
//
// node tools/make-icons.mjs <unpacked icon pack folder>

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const pack = resolve(process.argv[2] ?? "");
const png = (size) => join(pack, "PNG", `OpenStage_Studio_${size}.png`);
if (!existsSync(png(1024))) {
  console.error(`No icon pack found in "${pack}". Give the folder that holds PNG/OpenStage_Studio_1024.png.`);
  process.exit(1);
}
const out = resolve("src-tauri/icons");
mkdirSync(out, { recursive: true });

/** The width and height written in a PNG file's header, checked against the size its name promises. */
function checked(size) {
  const bytes = readFileSync(png(size));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error(`${png(size)} is not a PNG file.`);
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  if (w !== size || h !== size) throw new Error(`${png(size)} is ${w} by ${h}, not ${size} by ${size}.`);
  return bytes;
}

// Windows icon: a directory of PNG images (allowed since Windows Vista), smallest first.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = icoSizes.map(checked);
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const e = 6 + 16 * i;
  const size = icoSizes[i];
  header.writeUInt8(size >= 256 ? 0 : size, e);
  header.writeUInt8(size >= 256 ? 0 : size, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
writeFileSync(join(out, "icon.ico"), Buffer.concat([header, ...images]));

// The .icns icon: typed PNG entries for each size and its double-density twin.
const icns = [
  ["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024],
  ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512],
];
const parts = icns.map(([type, size]) => {
  const data = checked(size);
  const head = Buffer.alloc(8);
  head.write(type, 0, "ascii");
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const body = Buffer.concat(parts);
const top = Buffer.alloc(8);
top.write("icns", 0, "ascii");
top.writeUInt32BE(body.length + 8, 4);
writeFileSync(join(out, "icon.icns"), Buffer.concat([top, body]));

// The PNGs the app bundle names, and the master.
copyFileSync(png(32), join(out, "32x32.png"));
copyFileSync(png(128), join(out, "128x128.png"));
copyFileSync(png(256), join(out, "128x128@2x.png"));
copyFileSync(png(512), join(out, "icon.png"));
copyFileSync(join(pack, "OpenStage_Studio.svg"), join(out, "app-icon.svg"));
console.log(`The app icons were made in ${out}: icon.ico (${icoSizes.join(", ")} pixels), icon.icns (16 to 1024 pixels), the PNGs and the SVG master.`);
