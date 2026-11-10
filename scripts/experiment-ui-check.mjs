import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5178";
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(APP_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.locator(".ws-team-entry").click();
await page.waitForTimeout(500);
await page.locator(".pt-experiment-entry").click();
await page.locator(".pt-experiment-drawer").waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(600);

const tabs = await page.locator(".pt-exp-tab").allInnerTexts();
assert.equal(tabs.length, 3, "should have three tabs");
console.log("tabs:", tabs.map((item) => item.replace(/\n/g, " ")).join(" | "));
console.log("recommendations:", await page.locator(".pt-exp-rec").count());
assert.ok((await page.locator(".pt-exp-rec").count()) > 0, "should show recommendations");
await page.screenshot({ path: `${OUT}/80-experiment-recommendations.png` });

await page.locator(".pt-exp-tab", { hasText: "进行中" }).click();
await page.waitForTimeout(400);
console.log("running cards:", await page.locator(".pt-exp-run").count());
await page.screenshot({ path: `${OUT}/81-experiment-running.png` });

await page.locator(".pt-exp-tab", { hasText: "已结论" }).click();
await page.waitForTimeout(400);
console.log("concluded cards:", await page.locator(".pt-exp-run").count());
await page.screenshot({ path: `${OUT}/82-experiment-concluded.png` });

// Data page → account drawer → scoped experiment
await page.locator(".drawer .modal-close").click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(700);
const account = page.locator(".account-name").filter({ hasText: "初见护肤专营店" }).first();
if (await account.count()) {
  await account.click();
  await page.waitForTimeout(500);
  const callout = page.locator(".pt-data-experiment-callout");
  assert.equal(await callout.count(), 1, "account drawer should have experiment entry");
  await page.screenshot({ path: `${OUT}/83-data-experiment-entry.png` });
  await callout.locator(".btn").click();
  await page.locator(".pt-experiment-drawer").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  assert.ok((await page.locator(".drawer-sub").innerText()).includes("当前账户"), "scoped header");
  await page.screenshot({ path: `${OUT}/84-data-scoped-experiment.png` });
}

assert.equal(errors.length, 0, `console errors: ${errors.join(" | ")}`);
console.log("Experiment UI check passed");
await browser.close();
