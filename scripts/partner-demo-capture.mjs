import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "GETmore 工作台", exact: true }).click();
await page.waitForTimeout(300);
await page.locator(".ws-team-entry").click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/08-partner-empty.png` });

await page.locator(".pt-composer textarea").fill(
  "把 ROI 低于 3.5 的计划停掉，把 ROI 高于 4.5 的账户预算加 20%，并把最差计划的出价下调 10%。整体 ROI 不低于 3.5。",
);
await page.getByRole("button", { name: "执行", exact: true }).click();
await page.waitForTimeout(7000);
await page.screenshot({ path: `${OUT}/09-partner-running.png` });

await page.locator(".pt-done").waitFor({ timeout: 180000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/10-partner-run.png` });

await page.locator(".pt-expert-grid").scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/11-partner-experts.png` });

await page.locator(".pt-operations").scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/12-partner-operations.png` });

// data dashboard reflects agent operations
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/13-data-after-agent.png` });

await page.getByRole("button", { name: "GETmore 工作台", exact: true }).click();
await page.waitForTimeout(300);
await page.locator(".ws-team-entry").click();
await page.waitForTimeout(500);
await page.locator(".pt-top-actions").getByRole("button", { name: /工具/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/14-partner-tools.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

await page.locator(".pt-top-actions").getByRole("button", { name: /记忆/ }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/15-partner-memory.png` });
const verify = page.locator(".pt-memory-modal").getByRole("button", { name: /回看/ });
if (await verify.count()) {
  await verify.first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/16-partner-verified.png` });
}
await page.locator(".pt-memory-modal .modal-close").click();
await page.waitForTimeout(300);

// undo an operation
await page.locator(".pt-operations").scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
const undo = page.locator(".pt-operation .btn");
if (await undo.count()) {
  await undo.first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/17-partner-undone.png` });
}

console.log("experts:", await page.locator(".pt-plan-expert").count());
console.log("operations:", await page.locator(".pt-operation").count());
console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
