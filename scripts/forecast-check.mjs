/**
 * 校验计划预测：
 * - horizon 3-7 天、daily 长度正确；
 * - 所有数字有限、区间有序；
 * - 建议动作/置信度合法，情景完整；
 * - 不出现 NaN/Infinity。
 *
 * 用法：node scripts/forecast-check.mjs
 */
import { loadMock } from "../server/mock.mjs";

const mock = await loadMock();
const range = { start: mock.DATE_KEYS[mock.DATE_KEYS.length - 7], end: mock.DATE_KEYS[mock.DATE_KEYS.length - 1] };
const plans = [...mock.CAMPAIGNS, ...mock.BRAND_CAMPAIGNS].filter((plan) => plan.daily.some((day) => day.cost > 0));
const actions = new Set(["increase", "decrease", "pause", "observe", "refresh_creative"]);
const confidences = new Set(["high", "medium", "low"]);
let failures = 0;
const actionCount = {};
const confidenceCount = {};

for (const plan of plans) {
  const forecast = mock.forecastPlan(plan, range, { horizonDays: 7 });
  const fail = (message) => {
    failures += 1;
    if (failures <= 8) console.log(`[FAIL] ${plan.id} ${plan.name}: ${message}`);
  };
  actionCount[forecast.recommendation.action] = (actionCount[forecast.recommendation.action] ?? 0) + 1;
  confidenceCount[forecast.confidence] = (confidenceCount[forecast.confidence] ?? 0) + 1;
  if (forecast.horizonDays < 3 || forecast.horizonDays > 7) fail("horizon 越界");
  if (forecast.baseline.daily.length !== forecast.horizonDays) fail("daily 长度不对");
  if (!actions.has(forecast.recommendation.action)) fail("未知建议动作");
  if (!confidences.has(forecast.confidence)) fail("未知置信度");
  if (!Array.isArray(forecast.scenarios) || forecast.scenarios.length !== 4) fail("情景数量不对");
  if (!Array.isArray(forecast.recommendation.checkpoints) || forecast.recommendation.checkpoints.length === 0) {
    fail("缺少验证点");
  }
  if (forecast.range.roiLow != null && forecast.range.roiHigh != null && forecast.range.roiLow > forecast.range.roiHigh) {
    fail("ROI 区间倒置");
  }
  if (forecast.range.revenueLow > forecast.range.revenueHigh) fail("成交区间倒置");
  if (String(JSON.stringify(forecast)).includes("NaN")) fail("出现 NaN");
  for (const value of [forecast.baseline.cost, forecast.baseline.revenue, forecast.baseline.orders, forecast.range.revenueLow]) {
    if (!Number.isFinite(value)) fail("出现非有限数字");
  }
  for (const scenario of forecast.scenarios) {
    if (!Number.isFinite(scenario.cost) || !Number.isFinite(scenario.revenue)) fail(`情景 ${scenario.key} 数字异常`);
  }
}

console.log(`\n预测校验：${plans.length} 个计划，${failures} 处异常`);
console.log(`建议分布：${JSON.stringify(actionCount)}`);
console.log(`置信度：${JSON.stringify(confidenceCount)}`);
if (failures > 0) process.exit(1);

const sample = plans.find(
  (plan) =>
    plan.channel === "auction" &&
    plan.creativeIds.length >= 3 &&
    plan.daily.at(-1)?.cost > 0 &&
    plan.daily.at(-1)?.netRevenue != null,
);
if (sample) {
  const forecast = mock.forecastPlan(sample, range, { horizonDays: 7 });
  console.log(`\n示例：${sample.name}（${sample.id}）`);
  console.log(`趋势：${forecast.trend.direction}，ROI 环比 ${forecast.trend.roiChangePct ?? "--"}%`);
  console.log(`预测：ROI ${forecast.range.roiLow}–${forecast.range.roiHigh}，成交 ${forecast.range.revenueLow}–${forecast.range.revenueHigh}`);
  console.log(`建议：${forecast.recommendation.label}（${forecast.confidence}）— ${forecast.recommendation.reason}`);
  console.log(`情景：${forecast.scenarios.map((scenario) => `${scenario.label}=${scenario.roi ?? "--"}`).join(" | ")}`);
  console.log(`验证点：${forecast.recommendation.checkpoints.join("；")}`);
  console.log(`回滚：${forecast.recommendation.rollback}`);
  console.log(`素材信号：${forecast.creativeSignals.signals.join("；") || "无"}`);
  console.log(`数据缺口：${forecast.dataGaps.join("；") || "无"}`);
}
