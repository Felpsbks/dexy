// Builds electron/assets/icon.ico (16-256px PNG entries) from public/icon-512.png.
// Run with: npx electron electron/make-icon.cjs
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = nativeImage.createFromPath(path.join(root, "public", "icon-512.png"));
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const pngs = sizes.map((s) => src.resize({ width: s, height: s, quality: "best" }).toPNG());

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const e = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, e);
  dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(pngs[i].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.mkdirSync(path.join(__dirname, "assets"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "assets", "icon.ico"), Buffer.concat([header, dir, ...pngs]));
fs.writeFileSync(path.join(__dirname, "assets", "icon.png"), src.resize({ width: 256, height: 256, quality: "best" }).toPNG());
console.log("icon.ico written", sizes.join(","));
app.quit();
