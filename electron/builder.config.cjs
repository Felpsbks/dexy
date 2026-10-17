/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "site.dexy.desktop",
  productName: "Dexy",
  copyright: "© Dexy",
  files: ["dist-electron/**/*", "electron/assets/**/*"],
  directories: { output: "release" },
  afterPack: "./electron/after-pack.cjs",
  win: {
    target: ["nsis"],
    icon: "electron/assets/icon.ico",
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: "electron/assets/icon.ico",
    uninstallerIcon: "electron/assets/icon.ico",
    installerHeaderIcon: "electron/assets/icon.ico",
    shortcutName: "Dexy",
    uninstallDisplayName: "Dexy",
  },
};
