import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

const dimTab = (text) => page.locator(".dim-tab").filter({ hasText: text }).first();
const waitTurn = async () => {
  await page.locator(".send-btn.stop").waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page.locator(".send-btn.stop").waitFor({ state: "detached", timeout: 150000 });
  await page.waitForTimeout(700);
};

await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/01-workspace-empty.png` });

// Data: accounts
await page.getByRole("button", { name: "数据", exact: true }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/02-data-accounts.png` });

// Data: org overview expanded
await dimTab("组织总览").click();
await page.waitForTimeout(700);
if (await page.locator(".org-toggle").count()) {
  await page.locator(".org-toggle").first().click();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `${OUT}/03-data-org.png` });

// Chat: rich analysis answer (organization level, uses the org summary in the context)
await page.getByRole("button", { name: "GETmore 工作台" }).click();
await page.waitForTimeout(500);
const input = page.getByRole("textbox", { name: "输入问题" });
await input.fill("当前组织维度下，华东事业群和华南事业群哪个投放效率更高？用数据说明，并给一条预算建议。");
await page.keyboard.press("Enter");
await waitTurn();
await page.screenshot({ path: `${OUT}/04-agent-answer.png` });

// Chat: explicit board action
await input.fill("请把数据看板切换到账户维度，并告诉我消耗最高的三个账户分别是谁。");
await page.keyboard.press("Enter");
await waitTurn();
await page.screenshot({ path: `${OUT}/05-agent-action.png` });
console.log("action cards:", await page.locator(".action-card").count());
if (await page.locator(".action-run").count()) {
  await page.locator(".action-run").first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/06-agent-action-applied.png` });
  console.log("active dim:", await page.locator(".dim-tab.is-active").innerText());
}

// Chat: tool trace in a fresh conversation
await page.getByRole("button", { name: "GETmore 工作台" }).click();
await page.waitForTimeout(400);
await page.locator(".new-chat-btn").click();
await page.waitForTimeout(500);
await input.fill("请先读取工作区的 data/README.md 文件，再用一句话说明文档里的指标口径。");
await page.keyboard.press("Enter");
await waitTurn();
await page.screenshot({ path: `${OUT}/07-agent-tool.png` });
console.log("steps:", await page.locator(".step-card").count());

console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
