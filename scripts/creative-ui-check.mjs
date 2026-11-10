import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("docs/screenshots", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`[console] ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`[pageerror] ${error.message}`));

await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(800);
await page.locator(".dim-tab").filter({ hasText: "推广计划" }).first().click();
await page.waitForTimeout(800);
await page.locator(".plan-name").first().click();
await page.waitForTimeout(900);

const forecastSection = page.locator(".drawer-section").filter({ hasText: "未来 7 天判断" });
if (await forecastSection.count()) {
  await forecastSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  console.log("forecast:", (await forecastSection.innerText()).replace(/\n+/g, " | "));
  await forecastSection.screenshot({ path: "docs/screenshots/111-forecast-section.png" });
}

const section = page.locator(".drawer-section").filter({ hasText: "素材与审核" });
await section.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const rows = section.locator(".creative-row");
console.log("creative rows:", await rows.count());
for (let index = 0; index < Math.min(4, await rows.count()); index += 1) {
  console.log(`- ${(await rows.nth(index).innerText()).replace(/\n+/g, " | ")}`);
}
await section.screenshot({ path: "docs/screenshots/110-creative-data-section.png" });
await page.screenshot({ path: "docs/screenshots/110-creative-data-drawer.png" });
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
