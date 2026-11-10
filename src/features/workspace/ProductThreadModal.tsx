import { useMemo } from "react";
import { Building2, CircleAlert, Package, ShieldCheck, Sparkles } from "lucide-react";
import {
  ACCOUNTS,
  BRAND_CAMPAIGNS,
  CAMPAIGNS,
  PRODUCTS,
  TODAY,
  addDays,
  dataHealthOf,
  orgById,
  roiOf,
  sumSeries,
  toDateKey,
} from "../../data/mock";
import { Modal } from "../../components/ui";
import { useWorkbench } from "../../state/workbench";
import { fmtMoney, fmtRoi } from "../../lib/format";

export default function ProductThreadModal() {
  const {
    threadCandidateProductId,
    productThreads,
    createProductThread,
    clearThreadCandidate,
    openProductThread,
    snapshot,
  } = useWorkbench();

  const info = useMemo(() => {
    if (!threadCandidateProductId) return null;
    const product = PRODUCTS.find((item) => item.id === threadCandidateProductId);
    if (!product) return null;
    const account = ACCOUNTS.find((item) => item.id === product.accountId);
    if (!account) return null;
    const campaigns = [...CAMPAIGNS, ...BRAND_CAMPAIGNS].filter((item) => item.productId === product.id);
    const range = snapshot?.range ?? { start: toDateKey(addDays(TODAY, -6)), end: toDateKey(TODAY) };
    const totals = campaigns.reduce(
      (acc, campaign) => {
        const value = sumSeries(campaign.daily, range);
        acc.cost += value.cost;
        acc.revenue += value.revenue;
        acc.orders += value.orders;
        acc.show += value.show;
        acc.click += value.click;
        return acc;
      },
      { cost: 0, revenue: 0, orders: 0, show: 0, click: 0 },
    );
    const existing = productThreads.find((thread) => thread.productId === product.id);
    return {
      product,
      account,
      orgName: orgById(account.orgId)?.name ?? account.orgId,
      campaigns,
      totals,
      range,
      health: dataHealthOf(account),
      existing,
    };
  }, [threadCandidateProductId, productThreads, snapshot?.range.start, snapshot?.range.end]);

  if (!info) {
    return (
      <Modal open={Boolean(threadCandidateProductId)} onClose={clearThreadCandidate} title="智能助手">
        <p className="drawer-hint">商品或账户不存在。</p>
      </Modal>
    );
  }

  const { product, account, orgName, campaigns, totals, range, health, existing } = info;
  const canCreate = campaigns.length > 0;
  const canSubmit = Boolean(existing) || canCreate;

  const handleCreate = () => {
    if (existing) {
      openProductThread(existing.id);
      return;
    }
    if (!canCreate) return;
    createProductThread({ productId: product.id, permission: "suggest" });
  };

  return (
    <Modal
      open={Boolean(threadCandidateProductId)}
      onClose={clearThreadCandidate}
      title={existing ? "进入智能助手" : "建立智能助手？"}
      desc="一个助手只负责一个商品的投放，其他商品不会进入这个对话。"
      className="product-thread-modal"
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={clearThreadCandidate}>
            取消
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={handleCreate}>
            <Sparkles size={12} /> {existing ? "进入助手" : "建立助手"}
          </button>
        </>
      }
    >
      <div className="thread-create-scope">
        <div className="thread-create-product">
          <span className="prod-thumb" aria-hidden="true">{product.emoji}</span>
          <div>
            <b>{product.name}</b>
            <span>{orgName} / {account.name}</span>
          </div>
          <span className={`thread-create-status ${product.status === "在售" ? "ok" : "warn"}`}>
            {product.status}
          </span>
        </div>
        <div className="thread-create-grid">
          <div><span>账户</span><b>{account.name}</b></div>
          <div><span>计划</span><b>{campaigns.length} 条</b></div>
          <div><span>近 7 天消耗</span><b>{fmtMoney(totals.cost)}</b></div>
          <div><span>近 7 天 ROI</span><b>{fmtRoi(totals.cost > 0 ? roiOf(totals) : null)}</b></div>
        </div>
      </div>

      <div className="thread-create-note">
        <ShieldCheck size={14} />
        <div>
          <b>建立后</b>
          <p>
            对话固定为「{product.name}」的 {campaigns.length} 条计划，只使用该商品、账户和计划的数据；
            默认只分析、给建议，不自动修改预算/出价；可提交执行提案，优化师确认后执行。
          </p>
        </div>
      </div>

      <div className="thread-create-note">
        <Building2 size={14} />
        <div>
          <b>数据范围</b>
          <p>
            统计周期 {range.start} ~ {range.end}；数据完整度 {(health.completeness * 100).toFixed(0)}%；
            缺失 {health.missing.join("、") || "无"}；延迟 {health.lagMinutes} 分钟。
          </p>
        </div>
      </div>

      {!canSubmit && (
        <p className="thread-create-warning">
          <CircleAlert size={13} />
          该商品暂无推广计划，不能建立智能助手。
        </p>
      )}
      {existing && (
        <p className="thread-create-warning">
          <CircleAlert size={13} />
          该商品已经有助手，继续将直接进入已有对话。
        </p>
      )}
      <p className="drawer-hint">
        <Package size={11} /> 一个商品只能有一个活跃助手；其他商品需要单独建立。
      </p>
    </Modal>
  );
}
