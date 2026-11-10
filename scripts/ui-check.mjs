import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`[console] ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`[pageerror] ${error.message}`));
page.on("requestfailed", (request) => {
  if (!request.url().includes("favicon")) errors.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`);
});

const dimTab = (text) => page.locator(".dim-tab").filter({ hasText: text }).first();
const cancel = () => page.getByRole("button", { name: "取消", exact: true }).click();
const waitTurn = async () => {
  await page.locator(".send-btn.stop").waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page.locator(".send-btn.stop").waitFor({ state: "detached", timeout: 150000 });
  await page.waitForTimeout(600);
};

await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/01-workspace-empty.png` });
console.log("workspace title:", await page.title());
console.log("agent status:", await page.locator(".status-title").first().innerText().catch(() => "n/a"));

// Data tab
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/02-data-accounts.png` });
console.log("account rows:", await page.locator("table.grid tbody tr").count());
console.log("roi cell:", await page.locator("table.grid tbody tr").first().locator("td").nth(5).innerText());

// Org overview + expand
await dimTab("组织总览").click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/03-data-org.png` });
await page.locator(".org-toggle").first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/03b-data-org-expanded.png` });
await dimTab("账户").click();
await page.waitForTimeout(500);

// Campaign dimension
await dimTab("推广计划").click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/04-data-campaigns.png` });

// More filters modal
await dimTab("账户").click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: /更多筛选/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04b-filters-modal.png` });
await cancel();
await page.waitForTimeout(300);

// Select rows to trigger batch bar
await page.locator("table.grid tbody tr").nth(0).locator(".check").click();
await page.locator("table.grid tbody tr").nth(1).locator(".check").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04c-batch-bar.png` });
await page.getByRole("button", { name: "关闭批量操作" }).click();

// Columns modal
await page.getByRole("button", { name: "自定义列" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-columns-modal.png` });
await cancel();
await page.waitForTimeout(300);

// Account detail drawer
await page.locator(".account-name").first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/06-account-drawer.png` });
await page.locator(".drawer .modal-close").click();
await page.waitForTimeout(300);

// Brand channel
await page.locator(".side-item").filter({ hasText: "品牌广告" }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/06b-brand.png` });

// Chat
await page.getByRole("button", { name: "GETmore 工作台" }).click();
await page.waitForTimeout(600);
const input = page.getByRole("textbox", { name: "输入问题" });
await input.click();
await input.fill("用三句话总结当前看板的表现，并给出一条最优先的预算调整建议。");
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/07-chat-streaming.png` });
await waitTurn();
await page.screenshot({ path: `${OUT}/08-chat-answer.png` });
console.log("chat answer length:", await page.locator(".agent-content").first().innerText().then((text) => text.length).catch(() => 0));
console.log("action card:", await page.locator(".action-card").count());

// Execute the suggested board action, verify it navigates and opens the drawer
if (await page.locator(".action-run").count()) {
  await page.locator(".action-run").first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/08b-agent-action-applied.png` });
  console.log("action applied, drawers:", await page.locator(".drawer").count());
  if (await page.locator(".drawer .modal-close").count()) {
    await page.locator(".drawer .modal-close").click();
    await page.waitForTimeout(300);
  }
  await page.getByRole("button", { name: "GETmore 工作台" }).click();
  await page.waitForTimeout(400);
}

// Tool-using request
await input.fill("请务必先读取工作区里的 data/README.md 文件，再告诉我文档中列出的指标口径有哪些。");
await page.keyboard.press("Enter");
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/09-chat-tool.png` });
await waitTurn();
await page.screenshot({ path: `${OUT}/10-chat-tool-done.png` });
console.log("tool steps:", await page.locator(".step-card").count());

// Reload: local conversation should persist and the agent context should continue
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
console.log("persisted messages:", await page.locator(".msg").count());
await input.fill("用一句话回顾一下我刚才问过什么。");
await page.keyboard.press("Enter");
await waitTurn();
await page.screenshot({ path: `${OUT}/11-chat-after-reload.png` });
console.log("after reload answer length:", await page.locator(".agent-content").last().innerText().then((text) => text.length).catch(() => 0));

console.log("ERRORS:", errors.length ? `\n${errors.join("\n")}` : "none");
await browser.close();
