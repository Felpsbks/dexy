import { chromium } from "playwright";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("C:\\Users\\kille\\AppData\\Local\\Temp\\claude\\c--Users-kille-OneDrive-Documentos-Respositorio-Dexy---Discord-fynix-connect\\fd2d8fd8-6849-4bda-ab20-84a116cb1dc8\\scratchpad\\db-check\\node_modules\\pg");
const BASE_URL = "http://localhost:8080";
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
const SCRATCH = "C:\\Users\\kille\\AppData\\Local\\Temp\\claude\\c--Users-kille-OneDrive-Documentos-Respositorio-Dexy---Discord-fynix-connect\\fd2d8fd8-6849-4bda-ab20-84a116cb1dc8\\scratchpad\\";

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await wait(500);
  await page.getByText("Entrar sem conta", { exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 15000 });
  await wait(1200);

  // Close the auto-opened "vincular conta" dialog first (Escape is the
  // standard Radix Dialog dismiss key) so it stops intercepting clicks.
  await page.keyboard.press("Escape");
  await wait(500);
  await page.screenshot({ path: `${SCRATCH}recheck2-after-escape.png` });

  const createBtn = page.locator('button[title="Vincule um e-mail para criar um servidor"], button[title="Criar servidor"]').first();
  await createBtn.click({ timeout: 8000 });
  await wait(1000);
  await page.screenshot({ path: `${SCRATCH}recheck2-after-click.png` });

  const modalVisible = await page.getByText("Criar seu servidor", { exact: true }).first().isVisible().catch(() => false);
  console.log("ACHADO DEFINITIVO: modal 'Criar seu servidor' abre pra convidado (após fechar o dialog de vincular conta que estava no caminho)?", modalVisible);

  if (modalVisible) {
    await page.getByText("Criar o meu", { exact: true }).first().click();
    await wait(300);
    await page.getByPlaceholder("Nome do servidor").fill("Recheck UI Server");
    await page.getByRole("button", { name: "Criar servidor", exact: true }).click();
    await wait(1500);
    const errorText = await page.locator("p.text-destructive").first().textContent().catch(() => null);
    console.log("Ao tentar SUBMETER de fato, a UI mostra a mensagem de erro do RPC?", `"${errorText}"`);
    await page.screenshot({ path: `${SCRATCH}recheck2-after-submit.png` });
  }

  const userId = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.includes("auth-token")) {
        try { return JSON.parse(localStorage.getItem(k)).user.id; } catch { return null; }
      }
    }
    return null;
  });
  await browser.close();

  if (userId) {
    const c = new pg.Client({ host: "aws-0-sa-east-1.pooler.supabase.com", port: 6543, user: "postgres.vpkgusspakhvlgpbywvy", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
    await c.connect();
    await c.query(`delete from servers where owner_id = $1`, [userId]);
    await c.query(`delete from auth.users where id = $1`, [userId]);
    await c.end();
    console.log("conta de teste removida:", userId);
  }
}
main().catch((e) => { console.error("ERRO:", e.message, e.stack); });
