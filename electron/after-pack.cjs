// electron-builder afterPack hook: stamps Dexy's icon and version strings
// into Dexy.exe with resedit (pure JS). signAndEditExecutable stays off
// because its winCodeSign download needs symlink privileges on Windows.
const fs = require("fs");
const path = require("path");
const PE = require("pe-library");
const ResEdit = require("resedit");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const version = context.packager.appInfo.version;
  const exe = PE.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exe);

  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, "assets", "icon.ico")));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] ?? { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    target.id,
    target.lang,
    ico.icons.map((i) => i.data),
  );

  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
  const [maj, min, pat] = version.split(".").map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(maj, min, pat, 0, 1033);
  vi.setProductVersion(maj, min, pat, 0, 1033);
  const lang = vi.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 };
  vi.setStringValues(lang, {
    FileDescription: "Dexy",
    ProductName: "Dexy",
    CompanyName: "Dexy",
    InternalName: "Dexy",
    OriginalFilename: "Dexy.exe",
    LegalCopyright: `© ${new Date().getFullYear()} Dexy`,
    FileVersion: version,
    ProductVersion: version,
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • Dexy icon + version stamped into ${path.basename(exePath)}`);
};
