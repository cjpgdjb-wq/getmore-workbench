import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`[console] ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`[pageerror] ${error.message}`));

const dimTab = (text) => page.locator(".dim-tab").filter({ hasText: text }).first();
const waitTurn = async () => {
  await page.locator(".send-btn.stop").waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page.locator(".send-btn.stop").waitFor({ state: "detached", timeout: 150000 });
  await page.waitForTimeout(500);
};

await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(800);

const firstRowName = async () => page.locator("table.grid tbody tr").first().locator(".account-name").innerText();
const firstRowCost = async () => page.locator("table.grid tbody tr").first().locator("td").nth(3).innerText();

// 1) Search
const search = page.getByPlaceholder("请输入账户名称、ID、备注");
await search.fill("花间");
await page.waitForTimeout(500);
console.log("search rows:", await page.locator("table.grid tbody tr").count(), "first:", await firstRowName());
await page.locator(".filter-chip").first().locator("button").click();
await page.waitForTimeout(400);

// 2) Sort by cost (default desc -> first click asc)
await page.locator("th").filter({ hasText: "消耗" }).first().locator(".th-sort-btn").click();
await page.waitForTimeout(400);
console.log("asc first cost:", await firstRowCost());
await page.locator("th").filter({ hasText: "消耗" }).first().locator(".th-sort-btn").click();
await page.waitForTimeout(400);
console.log("desc first cost:", await firstRowCost());

// 3) Pagination
const pageOne = await firstRowName();
await page.locator(".page-btn").filter({ hasText: "2" }).first().click();
await page.waitForTimeout(500);
const pageTwo = await firstRowName();
console.log("pagination changed:", pageOne !== pageTwo, `(${pageOne} -> ${pageTwo})`);
await page.locator(".page-btn").filter({ hasText: "1" }).first().click();
await page.waitForTimeout(300);

// 4) Date range: today
await page.locator(".date-range").click();
await page.waitForTimeout(300);
await page.locator(".date-presets button").filter({ hasText: "今日" }).click();
await page.waitForTimeout(700);
console.log("date label:", (await page.locator(".date-range .dates").innerText()).replace(/\s+/g, " "));

// 5) Column customization: remove a visible secondary column
await page.getByRole("button", { name: "自定义列" }).click();
await page.waitForTimeout(400);
const noteRow = page.locator(".columns-picked .picked-item").filter({ hasText: "日预算" });
await noteRow.locator(".remove").click();
await page.getByRole("button", { name: "确定", exact: true }).click();
await page.waitForTimeout(600);
const headers = await page.locator("table.grid th").allInnerTexts();
console.log("日预算 header removed:", !headers.some((text) => text.includes("日预算")));

// 6) Export
const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
await page.getByRole("button", { name: "导出数据" }).click();
const download = await downloadPromise;
console.log("download:", download ? download.suggestedFilename() : "none");

// 7) Agent action: explicit view switch
await page.getByRole("button", { name: "GETmore 工作台" }).click();
await page.waitForTimeout(400);
const input = page.getByRole("textbox", { name: "输入问题" });
await input.fill("请把数据看板切换到组织总览维度，然后简单告诉我华东事业群的表现。");
await page.keyboard.press("Enter");
await waitTurn();
console.log("action cards:", await page.locator(".action-card").count());
if (await page.locator(".action-run").count()) {
  await page.locator(".action-run").first().click();
  await page.waitForTimeout(800);
  console.log("active dim tab:", await page.locator(".dim-tab.is-active").innerText());
}
const stepTexts = await page.locator(".step-card .step-name").allInnerTexts();
console.log("steps:", JSON.stringify(stepTexts));

// 8) Reload keeps the data view dimension
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(700);
console.log("dim after reload:", await page.locator(".dim-tab.is-active").innerText());
console.log("messages persisted:", await page.locator(".msg").count());

console.log("ERRORS:", errors.length ? `\n${errors.join("\n")}` : "none");
await browser.close();
