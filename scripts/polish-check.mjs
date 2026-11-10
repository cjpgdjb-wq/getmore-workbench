import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(800);

// Date popover
await page.locator(".date-range").click();
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/20-date-popover.png" });
await page.locator(".click-catcher").first().click({ position: { x: 8, y: 8 } });
await page.waitForTimeout(300);

// Column settings popover
await page.getByRole("button", { name: "列设置" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/21-column-settings.png" });
await page.locator(".click-catcher").first().click({ position: { x: 8, y: 8 } });
await page.waitForTimeout(300);

// KPI fullscreen
await page.getByRole("button", { name: "全屏查看" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/22-kpi-fullscreen.png" });
await page.getByRole("button", { name: "关闭" }).click();
await page.waitForTimeout(300);

// Apply more filters: cost >= 60000
await page.getByRole("button", { name: /更多筛选/ }).click();
await page.waitForTimeout(400);
await page.locator(".filter-row .select-trigger").first().click();
await page.waitForTimeout(200);
await page.locator(".menu-item").filter({ hasText: "大于等于" }).click();
await page.locator(".filter-input input").first().fill("60000");
await page.getByRole("button", { name: "确定", exact: true }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: "shots/23-filter-applied.png" });
console.log("rows after filter:", await page.locator("table.grid tbody tr").count());

// Campaign search placeholder
await page.locator(".dim-tab").filter({ hasText: "推广计划" }).first().click();
await page.waitForTimeout(500);
console.log("campaign placeholder:", await page.locator(".search-field input").getAttribute("placeholder").catch(() => "n/a"));

// Brand search scope
await page.locator(".side-item").filter({ hasText: "品牌广告" }).click();
await page.waitForTimeout(600);
const before = await page.locator(".kpi-value b").first().innerText();
await page.locator(".scope-tab").filter({ hasText: /^搜索$/ }).click();
await page.waitForTimeout(600);
const after = await page.locator(".kpi-value b").first().innerText();
console.log("brand search scope changed:", before, "->", after);
await page.screenshot({ path: "shots/24-brand-search.png" });

// Narrow viewport
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/25-narrow-data.png" });
await page.getByRole("button", { name: "GETmore 工作台" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/26-narrow-chat.png" });

console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
