// 评测默认冻结在 2026-11-06，避免 mock 数据随当天日期漂移。
// 需要跑别的日期：MOCK_TODAY=2026-11-05 node scripts/eval-policy.mjs
process.env.MOCK_TODAY = process.env.MOCK_TODAY || "2026-11-06";
