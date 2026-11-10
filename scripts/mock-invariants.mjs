/**
 * 校验素材日数据能否精确汇总回计划：
 * - 每条素材的 cost/show/click/orders/revenue/netRevenue/netOrders/refundAmount
 *   按日相加必须等于计划日数据；
 * - 基本漏斗约束：click <= show、orders <= click、refund <= revenue。
 *
 * 用法：node scripts/mock-invariants.mjs
 */
import { loadMock } from "../server/mock.mjs";

const mock = await loadMock();
const campaigns = [...mock.CAMPAIGNS, ...mock.BRAND_CAMPAIGNS];
const fields = ["cost", "show", "click", "orders", "revenue", "netRevenue", "netOrders", "refundAmount"];
let failures = 0;
let checkedDays = 0;
let creativeCount = 0;

for (const campaign of campaigns) {
  const creatives = campaign.creativeIds.map((id) => mock.creativeById(id)).filter(Boolean);
  if (!creatives.length) continue;
  creativeCount += creatives.length;
  for (let day = 0; day < campaign.daily.length; day += 1) {
    const plan = campaign.daily[day];
    const sums = { cost: 0, show: 0, click: 0, orders: 0, revenue: 0, netRevenue: 0, netOrders: 0, refundAmount: 0 };
    let hasNet = false;
    let hasNetOrders = false;
    let hasRefund = false;
    let dayFailure = null;
    for (const creative of creatives) {
      const point = creative.daily[day];
      if (!point) {
        dayFailure = `素材 ${creative.id} 缺少 ${plan.date} 的数据`;
        break;
      }
      sums.cost += point.cost;
      sums.show += point.show;
      sums.click += point.click;
      sums.orders += point.orders;
      sums.revenue += point.revenue;
      if (point.netRevenue != null) {
        sums.netRevenue += point.netRevenue;
        hasNet = true;
      }
      if (point.netOrders != null) {
        sums.netOrders += point.netOrders;
        hasNetOrders = true;
      }
      if (point.refundAmount != null) {
        sums.refundAmount += point.refundAmount;
        hasRefund = true;
      }
      if (point.click > point.show) dayFailure = `素材 ${creative.id} click > show`;
      if (point.orders > point.click) dayFailure = `素材 ${creative.id} orders > click`;
      if (point.refundAmount != null && point.refundAmount > point.revenue) {
        dayFailure = `素材 ${creative.id} refund > revenue`;
      }
    }
    if (dayFailure) {
      failures += 1;
      if (failures <= 5) console.log(`[FAIL] ${campaign.name} ${plan.date}: ${dayFailure}`);
      continue;
    }
    const expected = {
      cost: plan.cost,
      show: plan.show,
      click: plan.click,
      orders: plan.orders,
      revenue: plan.revenue,
      netRevenue: plan.netRevenue == null ? null : plan.netRevenue,
      netOrders: plan.netOrders == null ? null : plan.netOrders,
      refundAmount: plan.refundAmount == null ? null : plan.refundAmount,
    };
    const actual = {
      cost: sums.cost,
      show: sums.show,
      click: sums.click,
      orders: sums.orders,
      revenue: sums.revenue,
      netRevenue: hasNet ? sums.netRevenue : null,
      netOrders: hasNetOrders ? sums.netOrders : null,
      refundAmount: hasRefund ? sums.refundAmount : null,
    };
    for (const field of fields) {
      if (expected[field] !== actual[field]) {
        failures += 1;
        if (failures <= 5) {
          console.log(`[FAIL] ${campaign.name} ${plan.date} ${field}: plan=${expected[field]} creative=${actual[field]}`);
        }
        break;
      }
    }
    checkedDays += 1;
  }
}

const allCreatives = campaigns.flatMap((campaign) => campaign.creativeIds.map((id) => mock.creativeById(id)).filter(Boolean));
let accountFailures = 0;
for (const channel of ["auction", "brand"]) {
  const accounts = mock.ACCOUNTS.filter((account) => account.channel === channel);
  const channelCampaigns = channel === "auction" ? mock.CAMPAIGNS : mock.BRAND_CAMPAIGNS;
  for (const account of accounts) {
    const list = channelCampaigns.filter((campaign) => campaign.accountId === account.id);
    if (list.length === 0) continue;
    for (const day of account.daily) {
      for (const field of fields) {
        const target = day[field];
        if (target == null) continue;
        const sum = list.reduce((total, campaign) => {
          const point = campaign.daily.find((item) => item.date === day.date);
          return total + (point?.[field] ?? 0);
        }, 0);
        if (sum !== target) {
          accountFailures += 1;
          if (accountFailures <= 5) console.log(`[FAIL] ${account.name} ${day.date} ${field}: account=${target} plan=${sum}`);
        }
      }
    }
  }
}

const statusCount = allCreatives.reduce((acc, creative) => {
  acc[creative.auditStatus] = (acc[creative.auditStatus] ?? 0) + 1;
  return acc;
}, {});
const hookCount = allCreatives.reduce((acc, creative) => {
  acc[creative.hook] = (acc[creative.hook] ?? 0) + 1;
  return acc;
}, {});
console.log(`\n素材一致性：${creativeCount} 条素材，${checkedDays} 个计划日，${failures} 处不一致`);
console.log(`计划→账户：${accountFailures} 处不一致`);
console.log(`审核状态：${JSON.stringify(statusCount)}；原型分布：${JSON.stringify(hookCount)}`);
if (failures > 0 || accountFailures > 0) process.exit(1);

const sample = campaigns.find(
  (campaign) =>
    campaign.channel === "auction" &&
    campaign.creativeIds.length >= 3 &&
    campaign.daily.at(-1)?.cost > 0 &&
    campaign.daily.at(-1)?.netRevenue != null,
);
if (sample) {
  const rangeStart = mock.DATE_KEYS[mock.DATE_KEYS.length - 7];
  const rangeEnd = mock.DATE_KEYS[mock.DATE_KEYS.length - 1];
  const range = { start: rangeStart, end: rangeEnd };
  console.log(`\n示例：${sample.name}（${sample.id}），近 7 天`);
  for (const creative of sample.creativeIds.map((id) => mock.creativeById(id)).filter(Boolean)) {
    const metrics = mock.creativeMetrics(creative, range);
    console.log(
      `- ${creative.type} ${creative.hook} ${creative.auditStatus} | 消耗 ${metrics.cost} | 净成交 ${metrics.netRevenue ?? "--"} | ROI ${metrics.roi?.toFixed(2) ?? "--"} | 净ROI ${metrics.netRoi?.toFixed(2) ?? "--"} | CTR ${metrics.ctr?.toFixed(2) ?? "--"}% | CVR ${metrics.cvr?.toFixed(2) ?? "--"}% | 5s完播 ${metrics.completion5s == null ? "--" : `${(metrics.completion5s * 100).toFixed(1)}%`} | 退款率 ${metrics.refundRate?.toFixed(2) ?? "--"}%`,
    );
  }
}
