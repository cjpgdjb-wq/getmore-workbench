/** 经营数据服务：把前端同一份 mock 数据整理成专家工具可查询的形态。 */
import { loadMock } from "./mock.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const r2 = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);

export async function getData() {
  const mock = await loadMock();
  return { mock };
}

export function normalizeRange(mock, input) {
  if (input && DATE_RE.test(input.start) && DATE_RE.test(input.end)) {
    const [start, end] = input.start <= input.end ? [input.start, input.end] : [input.end, input.start];
    const min = mock.DATE_KEYS[0];
    const max = mock.DATE_KEYS[mock.DATE_KEYS.length - 1];
    return {
      start: start < min ? min : start,
      end: end > max ? max : end,
      preset: input.preset,
    };
  }
  if (input?.preset) return mock.presetRange(input.preset);
  return mock.presetRange("last7");
}

export function categoryOf(account) {
  const name = account.name;
  if (/初见/.test(name)) return "美妆个护";
  if (/简味|源本|元气/.test(name)) return "食品饮料";
  if (/星野|潮玩/.test(name)) return "数码潮玩";
  if (/沐野/.test(name)) return "户外运动";
  if (/轻氧|禾颂/.test(name)) return "家居家纺";
  if (/花间集|拾光/.test(name)) return "服饰生活";
  if (/时光/.test(name)) return "本地生活";
  return "综合";
}

export function findAccount(mock, ref) {
  if (!ref) return null;
  const value = String(ref).trim();
  if (!value) return null;
  const byId = mock.accountById(value);
  if (byId) return byId;
  return (
    mock.ACCOUNTS.find((account) => account.name === value) ??
    mock.ACCOUNTS.find((account) => value.length >= 3 && (account.name.includes(value) || value.includes(account.name))) ??
    null
  );
}

export function findCampaign(mock, ref) {
  if (!ref) return null;
  const value = String(ref).trim();
  const all = [...mock.CAMPAIGNS, ...mock.BRAND_CAMPAIGNS];
  return all.find((campaign) => campaign.id === value) ?? all.find((campaign) => campaign.name === value) ?? null;
}

function totalsOf(mock, account, range) {
  return mock.sumSeries(account.daily, range);
}

function summarizeAccount(mock, account, range) {
  const totals = totalsOf(mock, account, range);
  const isBrand = account.channel === "brand";
  return {
    id: account.id,
    name: account.name,
    channel: account.channel,
    category: categoryOf(account),
    org: mock.orgName(account.orgId),
    status: account.status,
    role: account.role,
    followed: account.followed,
    budget: r2(account.budget),
    balance: r2(account.balance),
    remark: account.remark,
    cost: r2(totals.cost),
    revenue: isBrand ? null : r2(totals.revenue),
    orders: isBrand ? null : Math.round(totals.orders),
    roi: isBrand ? null : r2(mock.roiOf(totals)),
    cpa: isBrand ? null : r2(mock.cpaOf(totals)),
    shows: Math.round(totals.show),
    clicks: Math.round(totals.click),
    ctr: r2(mock.ctrOf(totals)),
    cpm: r2(mock.cpmOf(totals)),
  };
}

function resolveOrgIds(mock, needle) {
  if (!needle) return null;
  const query = String(needle).trim().toLowerCase();
  if (!query) return null;
  const match = mock.ORGS.find(
    (org) => org.id === needle || org.name.toLowerCase().includes(query) || org.id.includes(query),
  );
  if (!match) return null;
  return new Set(mock.descenders(match.id));
}

export function queryAccounts(mock, input = {}, defaultRange) {
  const range = normalizeRange(mock, input.range ?? defaultRange);
  const channel = input.channel === "brand" ? "brand" : "auction";
  const orgIds = resolveOrgIds(mock, input.org);
  let accounts = mock.ACCOUNTS.filter((account) => account.channel === channel);
  if (orgIds) accounts = accounts.filter((account) => orgIds.has(account.orgId));
  if (input.search) {
    const query = String(input.search).toLowerCase();
    accounts = accounts.filter(
      (account) =>
        account.name.toLowerCase().includes(query) ||
        account.id.includes(query) ||
        account.remark.toLowerCase().includes(query),
    );
  }

  let rows = accounts.map((account) => summarizeAccount(mock, account, range));
  if (typeof input.min_cost === "number") rows = rows.filter((row) => (row.cost ?? 0) >= input.min_cost);
  if (typeof input.max_roi === "number") rows = rows.filter((row) => row.roi !== null && row.roi <= input.max_roi);
  if (typeof input.min_roi === "number") rows = rows.filter((row) => row.roi !== null && row.roi >= input.min_roi);

  const sortBy = ["cost", "roi", "cpa", "orders", "balance", "ctr"].includes(input.sort_by)
    ? input.sort_by
    : "cost";
  const dir = input.order === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * dir;
  });

  const totals = rows.reduce(
    (acc, row) => ({
      cost: acc.cost + (row.cost ?? 0),
      revenue: acc.revenue + (row.revenue ?? 0),
      orders: acc.orders + (row.orders ?? 0),
      balance: acc.balance + (row.balance ?? 0),
    }),
    { cost: 0, revenue: 0, orders: 0, balance: 0 },
  );

  const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20);
  return {
    range,
    channel,
    count: rows.length,
    totals: {
      cost: r2(totals.cost),
      revenue: r2(totals.revenue),
      orders: Math.round(totals.orders),
      roi: totals.cost > 0 && channel === "auction" ? r2(totals.revenue / totals.cost) : null,
      cpa: totals.orders > 0 ? r2(totals.cost / totals.orders) : null,
      balance: r2(totals.balance),
    },
    accounts: rows.slice(0, limit),
  };
}

export function queryPlans(mock, input = {}, defaultRange) {
  const range = normalizeRange(mock, input.range ?? defaultRange);
  let account = null;
  if (input.account_id) {
    account = findAccount(mock, input.account_id);
    if (!account) return { error: `账户不存在：${input.account_id}。请使用 query_accounts 获取 account_id` };
  }
  let campaigns = [...mock.CAMPAIGNS, ...mock.BRAND_CAMPAIGNS];
  if (account) campaigns = campaigns.filter((campaign) => campaign.accountId === account.id);
  if (input.status) campaigns = campaigns.filter((campaign) => campaign.status === input.status);
  if (input.mode) campaigns = campaigns.filter((campaign) => campaign.mode === input.mode);

  let rows = campaigns.map((campaign) => {
    const totals = mock.sumSeries(campaign.daily, range);
    const owner = mock.accountById(campaign.accountId);
    const product = mock.productById?.(campaign.productId);
    const points = campaign.daily.filter((point) => point.date >= range.start && point.date <= range.end);
    const days = Math.max(1, points.length);
    const netPoints = points.filter((point) => point.netRevenue !== null && point.netRevenue !== undefined);
    const netRevenue = netPoints.length ? netPoints.reduce((sum, point) => sum + (point.netRevenue ?? 0), 0) : null;
    const netOrders = netPoints.length ? netPoints.reduce((sum, point) => sum + (point.netOrders ?? 0), 0) : null;
    const refundRate = netRevenue !== null && totals.revenue > 0 ? (totals.revenue - netRevenue) / totals.revenue : null;
    const creatives = (campaign.creativeIds ?? []).map((id) => mock.creativeById?.(id)).filter(Boolean);
    const rejectedCreatives = creatives.filter((creative) => creative.auditStatus === "拒绝");
    const stockDays = product && totals.orders > 0 ? product.stock / (totals.orders / days) : null;
    return {
      id: campaign.id,
      name: campaign.name,
      account_id: campaign.accountId,
      account: owner?.name ?? "",
      mode: campaign.mode,
      target: campaign.target,
      status: campaign.status,
      budget: r2(campaign.budget),
      bid: r2(campaign.bid),
      product: product?.name ?? "",
      product_status: product?.status ?? null,
      product_stock: product?.stock ?? null,
      stock_days: stockDays === null ? null : r2(stockDays),
      creative_count: creatives.length,
      rejected_creative_count: rejectedCreatives.length,
      rejected_creatives: rejectedCreatives.map((creative) => ({
        id: creative.id,
        title: creative.title,
        reason: creative.rejectReason,
      })),
      net_revenue: netRevenue === null ? null : r2(netRevenue),
      net_orders: netOrders === null ? null : Math.round(netOrders),
      refund_rate: refundRate === null ? null : r2(refundRate),
      cost: r2(totals.cost),
      revenue: r2(totals.revenue),
      orders: Math.round(totals.orders),
      roi: r2(mock.roiOf(totals)),
      cpa: r2(mock.cpaOf(totals)),
    };
  });

  const sortBy = ["cost", "roi", "cpa", "orders"].includes(input.sort_by) ? input.sort_by : "cost";
  const dir = input.order === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * dir;
  });
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 30);
  return { range, count: rows.length, plans: rows.slice(0, limit) };
}

export function accountTrend(mock, accountId, days = 14) {
  const account = findAccount(mock, accountId);
  if (!account) return { error: `账户不存在：${accountId}` };
  const size = Math.min(Math.max(Number(days) || 14, 3), 30);
  const series = account.daily.slice(-size);
  return {
    id: account.id,
    name: account.name,
    days: size,
    series: series.map((point) => ({
      date: point.date,
      cost: r2(point.cost),
      revenue: r2(point.revenue),
      orders: Math.round(point.orders),
      roi: point.cost > 0 ? r2(point.revenue / point.cost) : null,
    })),
    summary: {
      cost: r2(series.reduce((sum, point) => sum + point.cost, 0)),
      revenue: r2(series.reduce((sum, point) => sum + point.revenue, 0)),
      orders: Math.round(series.reduce((sum, point) => sum + point.orders, 0)),
    },
  };
}

export function comparePeriods(mock, input = {}, defaultRange) {
  const current = normalizeRange(mock, input.range ?? defaultRange);
  const previous = mock.previousRange(current);
  const account = input.account_id ? findAccount(mock, input.account_id) : null;
  if (input.account_id && !account) return { error: `账户不存在：${input.account_id}` };
  const accounts = account ? [account] : mock.ACCOUNTS.filter((item) => item.channel === "auction");
  const currentTotals = mock.addTotals(accounts.map((item) => mock.sumSeries(item.daily, current)));
  const prevTotals = mock.addTotals(accounts.map((item) => mock.sumSeries(item.daily, previous)));
  const bundle = (now, before, key) => {
    const a = key(now);
    const b = key(before);
    return {
      current: r2(a),
      previous: r2(b),
      delta_pct: b ? r2(((a - b) / b) * 100) : null,
    };
  };
  return {
    scope: account ? account.name : "全部竞价账户",
    current,
    previous,
    metrics: {
      cost: bundle(currentTotals, prevTotals, (t) => t.cost),
      revenue: bundle(currentTotals, prevTotals, (t) => t.revenue),
      orders: bundle(currentTotals, prevTotals, (t) => t.orders),
      roi: bundle(currentTotals, prevTotals, (t) => mock.roiOf(t) ?? 0),
      cpa: bundle(currentTotals, prevTotals, (t) => mock.cpaOf(t) ?? 0),
    },
  };
}

export function orgSummary(mock, orgId) {
  const root = mock.orgById(orgId) ?? mock.orgById(mock.ROOT_ORG_ID);
  if (!root) return null;
  const range = mock.presetRange("last7");
  const rows = root.children
    .map((id) => mock.orgById(id))
    .filter(Boolean)
    .map((org) => {
      const accounts = mock.accountsOfOrgs(mock.descenders(org.id), "auction");
      if (!accounts.length) return null;
      const totals = mock.accountTotals(accounts, range);
      return {
        id: org.id,
        name: org.name,
        accounts: accounts.length,
        cost: r2(totals.cost),
        revenue: r2(totals.revenue),
        orders: Math.round(totals.orders),
        roi: r2(mock.roiOf(totals)),
        cpa: r2(mock.cpaOf(totals)),
        balance: r2(mock.sumBalance(accounts)),
      };
    })
    .filter(Boolean);
  return { range, org: root.name, orgs: rows };
}

export function categoryTrends(category = "女装", days = 14) {
  let hash = 0;
  for (const char of category) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const base = 82 + (hash % 30);
  const growth = ((hash % 120) - 30) / 20; // -1.5% ~ +4.5% / 天
  const points = Array.from({ length: days }, (_, index) => {
    const wave = 1 + Math.sin((index + (hash % 7)) / 2.4) * 0.045;
    return {
      date: null,
      index: Math.round((base * (1 + (growth / 100) * index) * wave) * 10) / 10,
    };
  });
  const latest = points[points.length - 1].index;
  const first = points[0].index;
  const growthPct = Math.round(((latest - first) / first) * 1000) / 10;
  return {
    category,
    window_days: days,
    heat_index: latest,
    growth_pct: growthPct,
    trend: points.slice(-7),
    signals: [
      { label: "搜索热度", value: `${growthPct >= 0 ? "+" : ""}${growthPct}%（${days} 天）` },
      { label: "竞品动作", value: `${3 + (hash % 5)} 个品牌近 7 天上新或加投` },
      { label: "内容互动", value: `${(1.8 + (hash % 24) / 10).toFixed(1)}% · ${growthPct > 5 ? "上升" : "平稳"}` },
    ],
    competitor_bids: [
      { segment: "核心人群", bid_range: `${(1.4 + (hash % 9) / 10).toFixed(1)} - ${(2.1 + (hash % 13) / 10).toFixed(1)} 元` },
      { segment: "相似人群", bid_range: `${(0.9 + (hash % 7) / 10).toFixed(1)} - ${(1.6 + (hash % 8) / 10).toFixed(1)} 元` },
    ],
  };
}

export function audienceSegments(category = "女装") {
  let hash = 0;
  for (const char of category) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const segments = [
    { name: "通勤白领", size: "1,240 万", index: 118, note: "工作日 8-10 点、20-22 点活跃" },
    { name: "精致妈妈", size: "860 万", index: 106, note: "高客单、重品质与成分" },
    { name: "小镇青年", size: "2,310 万", index: 92, note: "价格敏感、直播转化高" },
    { name: "Z 世代兴趣圈", size: "1,870 万", index: 124, note: "内容种草到成交链路短" },
    { name: "高净值人群", size: "310 万", index: 138, note: "对品牌与服务要求高" },
  ];
  const offset = hash % segments.length;
  return {
    category,
    segments: segments.slice(offset).concat(segments.slice(0, offset)).map((segment, index) => ({
      ...segment,
      index: segment.index + ((hash >> (index + 1)) % 9) - 4,
      incremental_score: 60 + ((hash >> (index + 2)) % 35),
    })),
  };
}

export function opportunityScan(mock, input = {}, defaultRange) {
  const range = normalizeRange(mock, input.range ?? defaultRange);
  const channel = input.channel === "brand" ? "brand" : "auction";
  const accounts = mock.ACCOUNTS.filter((account) => account.channel === channel);
  const rows = accounts.map((account) => ({
    account,
    totals: mock.sumSeries(account.daily, range),
  }));
  const totalCost = rows.reduce((sum, row) => sum + row.totals.cost, 0) || 1;

  const opportunities = [];
  for (const { account, totals } of rows) {
    const share = totals.cost / totalCost;
    const roi = mock.roiOf(totals);
    const ctr = mock.ctrOf(totals);
    const cpm = mock.cpmOf(totals);

    if (channel === "auction" && roi !== null && roi >= 4.2 && share < 0.08 && account.status === "投放中") {
      opportunities.push({
        type: "scale",
        title: "高 ROI 账户预算未打满",
        account: account.name,
        account_id: account.id,
        evidence: `ROI ${roi.toFixed(2)}，消耗占比仅 ${(share * 100).toFixed(1)}%，余额 ${Math.round(account.balance)} 元`,
        expected: "预算上调 15% 预计带来 8%–12% 增量支付金额，ROI 仍可高于 4.0",
        confidence: 0.78,
        score: roi * (1 - share) * 100,
      });
    }
    if (channel === "auction" && roi !== null && roi < 3.0 && share > 0.06) {
      opportunities.push({
        type: "fix",
        title: "高消耗低 ROI，存在预算浪费",
        account: account.name,
        account_id: account.id,
        evidence: `消耗占比 ${(share * 100).toFixed(1)}%，ROI ${roi.toFixed(2)}，订单成本 ${Math.round(mock.cpaOf(totals) ?? 0)} 元`,
        expected: "收缩低效计划 10% 预算，预计 ROI 回升 0.3–0.6",
        confidence: 0.72,
        score: (4 - roi) * share * 100,
      });
    }
    if (account.balance < 5000) {
      opportunities.push({
        type: "risk",
        title: "余额不足，有断投风险",
        account: account.name,
        account_id: account.id,
        evidence: `总余额 ${Math.round(account.balance)} 元，按近 7 天日均消耗仅可支撑 ${Math.max(0, Math.round(account.balance / Math.max(1, totals.cost / 7)))} 天`,
        expected: "及时充值可避免曝光断档，保护账户模型稳定性",
        confidence: 0.9,
        score: 120,
      });
    }
    if (channel === "brand" && ctr !== null && ctr >= 2.4 && share < 0.1) {
      opportunities.push({
        type: "scale",
        title: "品牌点击率高于均值，可扩量测试",
        account: account.name,
        account_id: account.id,
        evidence: `点击率 ${ctr.toFixed(2)}%，千次展现费用 ${(cpm ?? 0).toFixed(2)} 元，预算占比 ${(share * 100).toFixed(1)}%`,
        expected: "加投 10%–15% 曝光测试，CTR 每提升 0.2pt 可降低有效点击成本约 8%",
        confidence: 0.68,
        score: ctr * 20,
      });
    }
  }

  opportunities.sort((a, b) => b.score - a.score);
  const top = opportunities.slice(0, 6).map((item, index) => ({ id: `opp-${index + 1}`, ...item }));
  return {
    range,
    channel,
    total_cost: r2(totalCost),
    count: top.length,
    opportunities: top,
  };
}

export function budgetPacing(mock, accountId) {
  const account = findAccount(mock, accountId);
  if (!account) return { error: `账户不存在：${accountId}` };
  const todayKey = mock.DATE_KEYS[mock.DATE_KEYS.length - 1];
  const today = account.daily.find((point) => point.date === todayKey);
  const last7 = account.daily.slice(-7);
  const cost7 = last7.reduce((sum, point) => sum + point.cost, 0);
  const avgDaily = cost7 / Math.max(1, last7.length);
  const todayCost = today?.cost ?? 0;
  const runway = avgDaily > 0 ? account.balance / avgDaily : null;
  return {
    account: account.name,
    account_id: account.id,
    daily_budget: r2(account.budget),
    today_cost: r2(todayCost),
    today_pacing_pct: account.budget > 0 ? r2((todayCost / account.budget) * 100) : null,
    last7_cost: r2(cost7),
    avg_daily_cost: r2(avgDaily),
    balance: r2(account.balance),
    runway_days: runway === null ? null : r2(runway),
    status: account.status,
  };
}

export function simulateBudgetChange(mock, input = {}, defaultRange) {
  const account = findAccount(mock, input.account_id);
  if (!account) return { error: `账户不存在：${input.account_id}` };
  const deltaPct = Math.max(-30, Math.min(30, Number(input.delta_pct) || 0));
  const range = normalizeRange(mock, input.range ?? defaultRange);
  const totals = mock.sumSeries(account.daily, range);
  const currentRoi = mock.roiOf(totals) ?? 0;
  const direction = deltaPct >= 0 ? 1 : -1;
  const efficiency = deltaPct > 0 ? 1 - Math.min(0.28, (deltaPct / 100) * 0.55) : 1 + Math.min(0.12, Math.abs(deltaPct) / 100 / 3);
  const projectedCost = totals.cost * (1 + deltaPct / 100);
  const projectedRevenue = totals.revenue * (1 + (deltaPct / 100) * efficiency);
  const projectedRoi = projectedCost > 0 ? projectedRevenue / projectedCost : null;
  const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
  const projectedOrders = aov > 0 ? projectedRevenue / aov : 0;
  return {
    account: account.name,
    account_id: account.id,
    range,
    baseline: {
      cost: r2(totals.cost),
      revenue: r2(totals.revenue),
      roi: r2(currentRoi),
      cpa: r2(mock.cpaOf(totals)),
    },
    change_pct: deltaPct,
    projected: {
      cost: r2(projectedCost),
      revenue: r2(projectedRevenue),
      roi: r2(projectedRoi),
      cpa: projectedOrders > 0 ? r2(projectedCost / projectedOrders) : null,
      incremental_revenue: r2(projectedRevenue - totals.revenue),
    },
    assumptions: [
      `边际效率系数 ${efficiency.toFixed(2)}（${deltaPct >= 0 ? "加预算边际 ROI 递减" : "降预算边际 ROI 改善"}）`,
      "假设素材与人群不发生结构性变化",
    ],
    feasibility: {
      within_budget_cap: Math.abs(deltaPct) <= 20,
      meets_roi_floor: projectedRoi !== null && projectedRoi >= 2.5,
      balance_ok: account.balance > 1000,
    },
  };
}

export function portfolioBrief(mock, rangeInput) {
  const range = normalizeRange(mock, rangeInput);
  const auction = mock.ACCOUNTS.filter((account) => account.channel === "auction");
  const brand = mock.ACCOUNTS.filter((account) => account.channel === "brand");
  const auctionTotals = mock.accountTotals(auction, range);
  const brandTotals = mock.accountTotals(brand, range);
  return {
    range,
    auction: {
      accounts: auction.length,
      cost: r2(auctionTotals.cost),
      revenue: r2(auctionTotals.revenue),
      orders: Math.round(auctionTotals.orders),
      roi: r2(mock.roiOf(auctionTotals)),
      cpa: r2(mock.cpaOf(auctionTotals)),
      low_balance: mock.lowBalanceCount(auction),
      active_today: mock.activeTodayCount(auction),
    },
    brand: {
      accounts: brand.length,
      cost: r2(brandTotals.cost),
      shows: Math.round(brandTotals.show),
      ctr: r2(mock.ctrOf(brandTotals)),
      cpm: r2(mock.cpmOf(brandTotals)),
      low_balance: mock.lowBalanceCount(brand),
    },
    top_accounts: [...auction]
      .map((account) => ({ id: account.id, name: account.name, totals: mock.sumSeries(account.daily, range) }))
      .sort((a, b) => b.totals.cost - a.totals.cost)
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        name: row.name,
        cost: r2(row.totals.cost),
        roi: r2(mock.roiOf(row.totals)),
        cpa: r2(mock.cpaOf(row.totals)),
        balance: r2(mock.accountById(row.id)?.balance ?? 0),
      })),
  };
}
