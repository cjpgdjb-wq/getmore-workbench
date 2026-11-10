import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(800);
await page.locator(".account-name").first().click();
await page.waitForTimeout(500);
const switches = page.locator(".drawer .switch");
console.log("drawer switches:", await switches.count());
const first = switches.first();
const before = await first.getAttribute("aria-checked");
await first.click();
await page.waitForTimeout(400);
const after = await first.getAttribute("aria-checked");
console.log("toggle:", before, "->", after);
await page.locator(".drawer .modal-close").click();
await page.waitForTimeout(300);
console.log("drawer closed:", (await page.locator(".drawer").count()) === 0);
console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
