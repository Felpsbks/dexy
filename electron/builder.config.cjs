/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "site.dexy.desktop",
  productName: "Dexy",
  files: ["dist-electron/**/*"],
  directories: { output: "release" },
  win: {
    target: ["nsis"],
    icon: "public/icon-512.png",
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};
