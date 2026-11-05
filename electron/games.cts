import { execFile } from "node:child_process";
import type { BrowserWindow } from "electron";

// "Jogando X": looks for known game executables in the process list. Reads
// process names only (tasklist) and never touches the game itself.
const GAMES: Record<string, string> = {
  "valorant-win64-shipping.exe": "VALORANT",
  "cs2.exe": "Counter-Strike 2",
  "csgo.exe": "CS:GO",
  "leagueclient.exe": "League of Legends",
  "league of legends.exe": "League of Legends",
  "fortniteclient-win64-shipping.exe": "Fortnite",
  "gta5.exe": "Grand Theft Auto V",
  "gta5_enhanced.exe": "Grand Theft Auto V",
  "fivem.exe": "FiveM",
  "rdr2.exe": "Red Dead Redemption 2",
  "minecraft.exe": "Minecraft",
  "minecraftlauncher.exe": "Minecraft",
  "robloxplayerbeta.exe": "Roblox",
  "dota2.exe": "Dota 2",
  "overwatch.exe": "Overwatch 2",
  "r5apex.exe": "Apex Legends",
  "r5apex_dx12.exe": "Apex Legends",
  "rocketleague.exe": "Rocket League",
  "pubg.exe": "PUBG",
  "tslgame.exe": "PUBG",
  "rainbowsix.exe": "Rainbow Six Siege",
  "rainbowsix_vulkan.exe": "Rainbow Six Siege",
  "eldenring.exe": "Elden Ring",
  "cyberpunk2077.exe": "Cyberpunk 2077",
  "witcher3.exe": "The Witcher 3",
  "fc25.exe": "EA SPORTS FC 25",
  "fc26.exe": "EA SPORTS FC 26",
  "cod.exe": "Call of Duty",
  "modernwarfare.exe": "Call of Duty",
  "destiny2.exe": "Destiny 2",
  "warframe.x64.exe": "Warframe",
  "pathofexile_x64.exe": "Path of Exile",
  "diablo iv.exe": "Diablo IV",
  "wow.exe": "World of Warcraft",
  "genshinimpact.exe": "Genshin Impact",
  "starrail.exe": "Honkai: Star Rail",
  "terraria.exe": "Terraria",
  "stardew valley.exe": "Stardew Valley",
  "rust.exe": "Rust",
  "deadbydaylight-win64-shipping.exe": "Dead by Daylight",
  "among us.exe": "Among Us",
  "palworld-win64-shipping.exe": "Palworld",
  "helldivers2.exe": "HELLDIVERS 2",
  "marvel-win64-shipping.exe": "Marvel Rivals",
};

const POLL_MS = 20_000;

export function startGameDetection(getWin: () => BrowserWindow | null, isEnabled: () => boolean) {
  if (process.platform !== "win32") return { stop: () => {}, scan: () => {}, current: () => null as string | null };
  let current: string | null = null;

  const publish = (game: string | null) => {
    if (game === current) return;
    current = game;
    getWin()?.webContents.send("dexy:activity", game);
  };

  const scan = () => {
    if (!isEnabled()) return publish(null);
    execFile("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return;
      let found: string | null = null;
      for (const line of out.split("\n")) {
        const exe = line.slice(1, line.indexOf('"', 1)).toLowerCase();
        if (GAMES[exe]) {
          found = GAMES[exe];
          break;
        }
      }
      publish(found);
    });
  };

  scan();
  const timer = setInterval(scan, POLL_MS);
  return {
    stop: () => clearInterval(timer),
    scan,
    current: () => current,
  };
}
