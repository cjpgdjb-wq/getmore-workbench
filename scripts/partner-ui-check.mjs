import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "GETmore 工作台", exact: true }).click();
await page.waitForTimeout(300);
await page.locator(".ws-team-entry").click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/40-partner-empty.png` });
console.log("status:", await page.locator(".pt-side-foot-text").innerText().catch(() => "n/a"));

await page.locator(".pt-composer textarea").fill(
  "把 ROI 低于 3.5 的计划停掉，把预算加到 ROI 高于 4.5 且余额充足的账户，整体 ROI 不低于 3.5。",
);
await page.getByRole("button", { name: "执行", exact: true }).click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/41-partner-running.png` });

await page.locator(".pt-done").waitFor({ timeout: 180000 });
await page.waitForTimeout(2800);
await page.screenshot({ path: `${OUT}/42-partner-run.png` });
console.log("plan experts:", await page.locator(".pt-plan-expert").count());
console.log("tool calls:", await page.locator(".pt-tool").count());
console.log("operations:", await page.locator(".pt-operation").count());

await page.locator(".pt-operations").scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/43-partner-operations.png` });

// Data dashboard reflects agent operations (before undo)
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/48-data-after-agent.png` });
console.log("ops chip:", await page.locator(".agent-ops-chip").innerText().catch(() => "none"));
console.log("agent marks:", await page.locator(".agent-mark").count());
console.log("strip:", await page.locator(".data-agent-strip").innerText().catch(() => "none"));
await page.getByRole("button", { name: "GETmore 工作台", exact: true }).click();
await page.waitForTimeout(300);
await page.locator(".ws-team-entry").click();
await page.waitForTimeout(600);

const undoButtons = page.locator(".pt-operation .btn");
console.log("undo buttons:", await undoButtons.count());
if (await undoButtons.count()) {
  await undoButtons.first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/44-partner-undone.png` });
  console.log("undone badges:", await page.locator(".pt-operation .badge-gray").count());
}

await page.locator(".pt-top-actions").getByRole("button", { name: /工具/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/45-partner-tools.png` });
console.log("tool definitions:", await page.locator(".pt-tool-def").count());
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

await page.locator(".pt-top-actions").getByRole("button", { name: /记忆/ }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/46-partner-memory.png` });
const verify = page.locator(".pt-memory-modal").getByRole("button", { name: /回看/ });
if (await verify.count()) {
  await verify.first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/47-partner-verified.png` });
}
await page.locator(".pt-memory-modal .modal-close").click();
await page.waitForTimeout(300);

// Data after undo
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/49-data-after-undo.png` });
console.log("ops chip after undo:", await page.locator(".agent-ops-chip").innerText().catch(() => "none"));

console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
