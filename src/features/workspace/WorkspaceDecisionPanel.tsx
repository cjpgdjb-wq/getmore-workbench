import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, ShieldCheck } from "lucide-react";
import { Checkbox, Modal } from "../../components/ui";
import type { AdDecision } from "../../lib/partner";
import { fmtMoney } from "../../lib/format";

function fieldLabel(field: AdDecision["field"]) {
  return field === "budget" ? "日预算" : field === "bid" ? "出价" : "状态";
}

function valueLabel(decision: AdDecision, value: string | number) {
  if (decision.field === "status") return String(value);
  return `${fmtMoney(Number(value))} ${decision.unit || ""}`.trim();
}

function riskLabel(level: AdDecision["riskLevel"]) {
  return level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
}

export default function WorkspaceDecisionPanel({
  decisions,
  ask,
  busy,
  onApprove,
  onReject,
}: {
  decisions: AdDecision[];
  ask?: string;
  busy: boolean;
  onApprove: (decision: AdDecision, comment: string) => Promise<void>;
  onReject: (decision: AdDecision, comment: string) => Promise<void>;
}) {
  const [review, setReview] = useState<AdDecision | null>(null);
  const [comment, setComment] = useState("");
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setComment("");
    setAck(false);
  }, [review?.id]);

  if (decisions.length === 0 && !ask) return null;
  const pending = decisions.filter((decision) => decision.status === "pending");
  const canApprove = Boolean(review) && (review?.riskLevel !== "high" || ack);

  const submit = async (kind: "approve" | "reject") => {
    if (!review || submitting) return;
    setSubmitting(true);
    try {
      if (kind === "approve") await onApprove(review, comment);
      else await onReject(review, comment);
      setReview(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section className="ws-hitl-panel" aria-label="执行提案">
        <header className="ws-hitl-head">
          <span className="ws-hitl-icon"><ShieldCheck size={14} /></span>
          <div>
            <b>执行提案</b>
            <span>
              {decisions.length === 0
                ? "未生成执行动作"
                : pending.length > 0
                  ? `${pending.length} 个动作等待你确认`
                  : "动作已处理"}
            </span>
          </div>
          {pending.length > 0 && <span className="ws-hitl-count">{pending.length}</span>}
        </header>
        <div className="ws-hitl-list">
          {decisions.map((decision) => (
            <div
              className={`ws-hitl-item is-${decision.status} risk-${decision.riskLevel}`}
              key={decision.id}
            >
              <span className="ws-hitl-item-icon">
                {decision.status === "pending" ? <ShieldCheck size={13} /> : <Check size={13} />}
              </span>
              <div className="ws-hitl-item-main">
                <div className="ws-hitl-item-title">
                  {decision.targetName}
                  <span className="tag tag-outline">{fieldLabel(decision.field)}</span>
                  <span className={`pt-risk ${decision.riskLevel}`}>{riskLabel(decision.riskLevel)}</span>
                  {decision.status !== "pending" && (
                    <span className={`badge ${decision.status === "approved" ? "badge-green" : "badge-gray"}`}>
                      {decision.status === "approved" ? "已确认" : decision.status === "rejected" ? "已拒绝" : "已过期"}
                    </span>
                  )}
                </div>
                <div className="pt-op-change">
                  {valueLabel(decision, decision.before)}
                  <span className="pt-op-arrow">→</span>
                  <b>{valueLabel(decision, decision.after)}</b>
                </div>
                <div className="ws-hitl-reason">{decision.reason}</div>
                {decision.evidence.slice(0, 2).map((item) => (
                  <div className="ws-hitl-evidence" key={item}>{item}</div>
                ))}
                {decision.dataGaps.length > 0 && (
                  <div className="ws-hitl-gap"><AlertTriangle size={11} /> {decision.dataGaps.join("；")}</div>
                )}
              </div>
              <div className="ws-hitl-side">
                {decision.status === "pending" ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setReview(decision)} disabled={busy}>
                    查看并确认
                  </button>
                ) : (
                  <span className="pt-meta">{decision.decidedBy ?? "优化师"}</span>
                )}
              </div>
            </div>
          ))}
        </div>
        {ask && <div className="ws-hitl-ask">{ask}</div>}
      </section>

      <Modal
        open={Boolean(review)}
        onClose={() => setReview(null)}
        title="确认投放动作"
        desc="Agent 只提交提案；你确认后才会执行并写入操作审计。"
        className="decision-review-modal"
        footer={
          <>
            <button type="button" className="btn btn-default" onClick={() => setReview(null)} disabled={submitting || busy}>取消</button>
            <span className="spacer" />
            <button type="button" className="btn btn-danger" onClick={() => void submit("reject")} disabled={submitting || busy}>拒绝</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit("approve")}
              disabled={!canApprove || submitting || busy}
            >
              {submitting ? <Loader2 size={12} className="spin" /> : <Check size={12} />} 确认并执行
            </button>
          </>
        }
      >
        {review && (
          <>
            <div className="decision-review-target">{review.targetName}</div>
            <div className="decision-review-change">
              <span>{valueLabel(review, review.before)}</span>
              <b>→ {valueLabel(review, review.after)}</b>
            </div>
            <div className={`decision-risk ${review.riskLevel}`}>
              <AlertTriangle size={13} />
              <div>
                <b>{riskLabel(review.riskLevel)}动作</b>
                <p>{review.riskText || "请在确认前复核数据与范围。"}</p>
              </div>
            </div>
            <div className="decision-detail-block">
              <b>调整理由</b>
              <p>{review.reason}</p>
            </div>
            {review.evidence.length > 0 && (
              <div className="decision-detail-block">
                <b>数据依据</b>
                <ul>{review.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {review.expected?.text && (
              <div className="decision-detail-block">
                <b>预期影响</b>
                <p>{review.expected.text}</p>
              </div>
            )}
            {review.dataGaps.length > 0 && (
              <div className="decision-detail-block is-warn">
                <b>数据缺口</b>
                <p>{review.dataGaps.join("；")}</p>
              </div>
            )}
            {review.riskLevel === "high" && (
              <label className="decision-ack">
                <Checkbox checked={ack} onChange={setAck} ariaLabel="确认已核对高风险动作" />
                <span>我已核对库存、预算和计划范围，确认执行</span>
              </label>
            )}
            <label className="decision-comment">
              <span>备注（可选）</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="例如：已确认 3 天内补货"
                rows={2}
              />
            </label>
            <div className="decision-expiry">提案 30 分钟内有效；执行后可在数据看板与操作审计中撤销。</div>
          </>
        )}
      </Modal>
    </>
  );
}
