const { chromium } = require("playwright");
(async () => {
 const browser=await chromium.launch({channel:"msedge",headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[]; page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
 await page.goto("http://127.0.0.1:5178",{waitUntil:"networkidle"});
 await page.locator(".ws-team-entry").click(); await page.waitForTimeout(400);
 await page.locator(".pt-home-card").first().click(); await page.waitForTimeout(400);
 // analytics
 await page.locator(".pt-expert-dir-item").nth(1).click(); await page.waitForTimeout(200);
 console.log("skills", await page.locator(".pt-expert-dir-skill").count(), "tools", await page.locator(".pt-expert-dir-tool").count());
 await page.locator(".pt-expert-dir-skill").first().click(); await page.waitForTimeout(500);
 console.log("skill modal", await page.locator(".pt-detail-modal").isVisible(), await page.locator(".pt-detail-modal .modal-title").innerText());
 console.log("steps", await page.locator(".pt-detail-steps li").count());
 await page.screenshot({path:"docs/screenshots/126-skill-detail.png"});
 await page.locator(".pt-detail-modal .modal-close").click(); await page.waitForTimeout(200);
 await page.locator(".pt-expert-dir-tool").first().click(); await page.waitForTimeout(500);
 console.log("tool modal", await page.locator(".pt-detail-modal").isVisible(), await page.locator(".pt-detail-modal .modal-title").innerText());
 console.log("meta", await page.locator(".pt-detail-meta").innerText());
 await page.screenshot({path:"docs/screenshots/127-tool-detail.png"});
 await page.locator(".pt-detail-modal .modal-close").click(); await page.waitForTimeout(200);
 console.log("errors",errors.slice(0,5));
 await browser.close();
})();
