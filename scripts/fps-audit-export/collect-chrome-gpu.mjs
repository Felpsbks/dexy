// Fase 7.6 -- tira um print de chrome://gpu (o conteúdo vive em shadow DOM,
// por isso print em vez de extrair texto) e imprime a versão do Chromium
// usado pelo Playwright. Roda sozinho: `node collect-chrome-gpu.mjs`.
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: false });
console.log("Chromium (Playwright) version:", await browser.version());
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto("chrome://gpu");
await page.waitForTimeout(3000);
await page.screenshot({ path: "chrome-gpu-maquinaB.png", clip: { x: 0, y: 0, width: 1600, height: 1200 } });
console.log("Salvo: chrome-gpu-maquinaB.png -- confira a seção 'Graphics Feature Status' (Video Encode/Decode/Compositing devem estar 'Hardware accelerated', não 'Software only' nem 'Disabled').");
await browser.close();
