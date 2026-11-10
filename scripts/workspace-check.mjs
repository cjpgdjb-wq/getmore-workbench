import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5178";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);

async function expandOrg(name) {
  const row = page.locator(".ws-org-row", { hasText: name }).first();
  if ((await row.getAttribute("aria-expanded")) === "false") {
    await row.click();
    await page.waitForTimeout(180);
  }
}

async function createWorkspace(account, product) {
  const group = page.locator(".ws-account-group", { hasText: account }).first();
  await group.scrollIntoViewIfNeeded();
  const row = group.locator(".ws-product-row", { hasText: product }).first();
  await row.click();
  await page.waitForTimeout(180);
  await page.locator(".product-thread-modal .btn-primary").click();
  await page.waitForTimeout(700);
}

await expandOrg("美妆个护组");
await createWorkspace("初见美妆旗舰店", "轻透防晒霜");
assert.equal(await page.locator(".ws-title-text").innerText(), "轻透防晒霜");

// Regression: creating a second workspace while another product session is active
// must not bounce back to the previous session.
await expandOrg("服饰生活组");
await createWorkspace("轻氧家居旗舰店", "轻盈鹅绒被");
const titles = [];
for (let index = 0; index < 5; index += 1) {
  titles.push(await page.locator(".ws-title-text").innerText());
  await page.waitForTimeout(180);
}
assert.equal(new Set(titles).size, 1, `workspace title oscillated: ${titles.join(" -> ")}`);
assert.equal(titles[0], "轻盈鹅绒被");
assert.ok(await page.locator(".workspace-toolbar").isVisible());
assert.ok(await page.locator(".workspace-context-meter").isVisible());

// Shared capability binding persists in the workspace.
await page.locator(".ws-context").getByRole("button", { name: /管理绑定/ }).click();
await page.waitForTimeout(250);
assert.ok(await page.locator(".workspace-capabilities-modal").isVisible());
assert.ok((await page.locator(".capability-row").count()) >= 20);
await page.getByRole("checkbox", { name: "绑定工具 调整预算" }).click();
await page.getByRole("button", { name: /保存绑定/ }).click();
await page.waitForTimeout(350);
assert.match(await page.locator(".ws-context").innerText(), /工具\n8 个/);

// Multiple conversations in one workspace.
await page.locator(".workspace-toolbar").getByRole("button", { name: /新对话/ }).click();
await page.waitForTimeout(400);
assert.match(await page.getByRole("button", { name: "切换工作区对话" }).innerText(), /对话 2/);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("getmore.chat.v1") ?? "{}"));
const workspaceSessions = (stored.sessions ?? []).filter((session) => session.threadId);
assert.ok(workspaceSessions.length >= 2);

await page.waitForTimeout(900);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);
assert.equal(await page.locator(".ws-title-text").innerText(), "轻盈鹅绒被");
assert.match(await page.locator(".workspace-toolbar").innerText(), /对话 2/);

if (errors.length) {
  throw new Error(`console errors:\n${errors.join("\n")}`);
}

console.log("workspace check passed");
console.log("titles:", titles.join(" / "));
console.log("workspace sessions:", workspaceSessions.length);
await page.screenshot({ path: "docs/screenshots/57-workspace-check.png" });
await browser.close();
