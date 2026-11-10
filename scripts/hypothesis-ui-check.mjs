import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5178";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(APP_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator(".ws-team-entry").click();
await page.waitForTimeout(700);
await page.locator(".pt-hypothesis-entry").click();
await page.locator(".pt-hyp-grid").waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(500);

console.log("hypothesis cards:", await page.locator(".pt-hyp-item").count());
console.log("detail title:", await page.locator(".pt-hyp-header h3").innerText());
await page.screenshot({ path: `${OUT}/70-hypothesis-library.png` });

const ids = ["H1", "H2", "H3"];
for (let index = 0; index < ids.length; index += 1) {
  const id = ids[index];
  await page.locator(".pt-hyp-item").nth(index).click();
  await page.waitForTimeout(350);
  const replayButton = page.locator(".pt-hyp-header .btn-primary").first();
  if (await replayButton.count()) {
    await replayButton.click();
    await page.locator(".pt-hyp-verdict").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(500);
  }
  const verdict = await page.locator(".pt-hyp-verdict b").first().innerText().catch(() => "--");
  const metrics = await page.locator(".pt-hyp-metric").count();
  console.log(id, "verdict:", verdict, "metrics:", metrics);
  await page.locator(".pt-hyp-verdict").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${71 + index}-hypothesis-${id}.png` });
}

console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
