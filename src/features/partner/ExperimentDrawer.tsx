import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  FlaskConical,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";
import { Drawer, Modal } from "../../components/ui";
import {
  dismissExperimentRecommendation,
  getExperimentLibrary,
  getExperimentUsage,
  readoutExperiment,
  rollbackExperiment,
  startExperiment,
  stopExperiment,
  trackExperimentView,
  type Experiment,
  type ExperimentLibrary,
  type ExperimentRecommendation,
  type ExperimentReadout,
  type ExperimentUsage,
} from "../../lib/partner";

type Tab = "suggested" | "running" | "concluded";

const TAB_LABEL: Record<Tab, string> = {
  suggested: "推荐",
  running: "进行中",
  concluded: "已结论",
};

const EVAL_ROWS = [
  { version: "v0.2 默认", accuracy: "61.7%", safe: "53.3%", verdict: "不采用：低于只观察 63.3%" },
  { version: "v0.3 保守", accuracy: "68.3%", safe: "60.0%", verdict: "当前默认：只降不增" },
  { version: "v0.4 防守", accuracy: "80.0%", safe: "60.0%", verdict: "暂不上线：预算撞线护栏 0/8" },
  { version: "只观察基准", accuracy: "63.3%", safe: "--", verdict: "对照组：什么都不做" },
];

function fmtMoney(value: number): string {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function fmtDate(value: number | null): string {
  if (!value) return "--";
  return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function statusLabel(status: Experiment["status"]): string {
  if (status === "pending") return "待确认";
  if (status === "running") return "进行中";
  if (status === "concluded") return "已结论";
  if (status === "reverted") return "已回滚";
  return "已取消";
}

function statusTone(status: Experiment["status"]): string {
  if (status === "pending") return "orange";
  if (status === "running") return "blue";
  if (status === "concluded") return "green";
  if (status === "reverted") return "gray";
  return "gray";
}

function verdictTone(verdict: ExperimentReadout["verdict"]): string {
  if (verdict === "positive") return "green";
  if (verdict === "negative") return "red";
  if (verdict === "insufficient") return "orange";
  return "gray";
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="pt-exp-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  busy,
  onStart,
  onObserve,
  onDismiss,
}: {
  recommendation: ExperimentRecommendation;
  busy: boolean;
  onStart: () => void;
  onObserve: () => void;
  onDismiss: () => void;
}) {
  return (
    <article className="pt-exp-card pt-exp-rec">
      <header className="pt-exp-card-head">
        <span className="pt-exp-kicker">{recommendation.templateLabel}</span>
        <span className={`pt-exp-impact is-${recommendation.impact === "高" ? "high" : recommendation.impact === "中" ? "mid" : "low"}`}>
          影响 {recommendation.impact}
        </span>
        <span className="pt-exp-confidence">置信 {recommendation.confidenceLabel}</span>
      </header>

      <h3>{recommendation.title}</h3>
      <p className="pt-exp-scope">{recommendation.scopeLine}</p>

      <section className="pt-exp-block">
        <div className="pt-exp-block-head">
          <span>当前投放</span>
          <em>{recommendation.dataWindow?.label ?? "口径：近 7 天"}</em>
        </div>
        <ul className="pt-exp-situation">
          {(recommendation.situation ?? []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="pt-exp-block">
        <div className="pt-exp-block-head">
          <span>数据表现</span>
          <em>与目标对比</em>
        </div>
        <div className="pt-exp-metrics">
          {recommendation.metrics.map((metric) => (
            <MetricPill key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </div>
      </section>

      <div className="pt-exp-suggestion">
        <span>Agent 建议</span>
        <div>
          <b>{recommendation.suggestion}</b>
          <small>
            {typeof recommendation.action.before === "number" ? fmtMoney(recommendation.action.before) : String(recommendation.action.before)}
            {" → "}
            {typeof recommendation.action.after === "number" ? fmtMoney(recommendation.action.after) : String(recommendation.action.after)}
            {recommendation.action.unit ? ` ${recommendation.action.unit}` : ""} · 实验周期 {recommendation.durationDays} 天 · D3/D7 复盘
          </small>
        </div>
      </div>

      <section className="pt-exp-block">
        <div className="pt-exp-block-head">
          <span>为什么这样建议</span>
          <em>来自上方数据</em>
        </div>
        <ul className="pt-exp-why">
          {recommendation.rationale.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="pt-exp-block is-expected">
        <div className="pt-exp-block-head">
          <span>预期效果</span>
          <em>模拟预估，不是承诺</em>
        </div>
        <p className="pt-exp-expected-text">{recommendation.expected.text}</p>
        {recommendation.expected.value !== null && (
          <b className="pt-exp-expected-value">
            {recommendation.expected.label}：{recommendation.expected.value}{recommendation.expected.unit}
          </b>
        )}
      </section>

      <div className="pt-exp-rows">
        <div>
          <span>成本上限</span>
          <b>最多 {fmtMoney(recommendation.costCap)}/{recommendation.costCapUnit.replace("元/", "")} · {recommendation.durationDays} 天</b>
        </div>
        <div>
          <span>判断标准</span>
          <b>{recommendation.criteria}</b>
        </div>
        <div>
          <span>护栏</span>
          <b>{recommendation.guardrail}</b>
        </div>
      </div>

      {!recommendation.sampleAdequate && (
        <div className="pt-exp-warn">
          <AlertTriangle size={12} /> 样本不足：{recommendation.sampleNote}
        </div>
      )}
      {recommendation.dataGapDetails?.length > 0 && (
        <div className="pt-exp-gaps">
          {recommendation.dataGapDetails.map((gap) => (
            <span key={gap.code} className={`pt-exp-gap is-${gap.severity}`} title={gap.detail}>
              {gap.label}
            </span>
          ))}
        </div>
      )}
      {recommendation.dataGapDetails?.some((gap) => gap.severity === "blocking") && (
        <div className="pt-exp-warn is-block">
          <ShieldCheck size={12} /> 数据门禁：净成交/退款未授权，不能开始改投放实验；只能「只观察」或先补授权。
        </div>
      )}

      <div className="pt-exp-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onStart}
          disabled={busy || !recommendation.sampleAdequate || recommendation.canStart === false}
          title={recommendation.startBlockReason ?? undefined}
        >
          <Play size={12} /> 开始小实验
        </button>
        <button type="button" className="btn btn-default btn-sm" onClick={onObserve} disabled={busy}>
          <Timer size={12} /> 只观察
        </button>
        <button type="button" className="text-action" onClick={onDismiss} disabled={busy}>
          不感兴趣
        </button>
      </div>
    </article>
  );
}

function ReadoutBlock({ readout }: { readout: ExperimentReadout }) {
  return (
    <div className={`pt-exp-readout is-${verdictTone(readout.verdict)}`}>
      <div className="pt-exp-readout-head">
        <span className="pt-exp-verdict">{readout.verdictLabel}</span>
        <span className="pt-exp-readout-meta">
          {readout.days < 3 ? `D${readout.days} 提前复盘` : `D${readout.days}`} · 置信 {readout.confidenceLabel}
        </span>
      </div>
      <p className="pt-exp-readout-plain">{readout.plain}</p>
      <div className="pt-exp-readout-stats">
        <div><span>实验前 ROI</span><b>{readout.stats.baselineRoi.toFixed(2)}</b></div>
        <div><span>复盘 ROI</span><b>{readout.stats.currentRoi.toFixed(2)}</b></div>
        <div><span>ROI 变化</span><b>{readout.stats.roiDelta > 0 ? "+" : ""}{readout.stats.roiDelta.toFixed(2)}</b></div>
        <div><span>GMV 变化</span><b>{readout.stats.gmvDelta > 0 ? "+" : ""}{(readout.stats.gmvDelta * 100).toFixed(1)}%</b></div>
      </div>
      <p className="pt-exp-readout-note">{readout.note}</p>
    </div>
  );
}

function ExperimentCard({
  experiment,
  busy,
  onOpenPending,
  onReadout,
  onStop,
  onRollback,
}: {
  experiment: Experiment;
  busy: boolean;
  onOpenPending: (decisionId?: string) => void;
  onReadout: () => void;
  onStop: (rollback: boolean) => void;
  onRollback: () => void;
}) {
  const [showMethod, setShowMethod] = useState(false);
  const pending = experiment.status === "pending";
  const running = experiment.status === "running";
  const observing = experiment.mode === "observe";
  const finished = ["concluded", "reverted", "cancelled"].includes(experiment.status);
  const baseline = experiment.baseline;

  return (
    <article className={`pt-exp-card pt-exp-run is-${experiment.status}`}>
      <header className="pt-exp-card-head">
        <span className={`pt-exp-status is-${statusTone(experiment.status)}`}>{statusLabel(experiment.status)}</span>
        <span className="pt-exp-kicker">{experiment.templateLabel}{observing ? " · 只观察" : ""}</span>
        <span className="pt-exp-time">
          {pending
            ? "等待确认"
            : experiment.readout
              ? `D${experiment.readout.days} 复盘`
              : `D${experiment.progress.day}/${experiment.progress.total}`}
        </span>
      </header>

      <h3>{experiment.title}</h3>
      <p className="pt-exp-scope">{experiment.scopeLine}</p>

      {pending && (
        <div className="pt-exp-pending">
          <AlertTriangle size={13} />
          <div>
            <b>提案已生成，确认后才生效</b>
            <span>{experiment.proposal.suggestion}</span>
          </div>
        </div>
      )}

      {!pending && (
        <div className="pt-exp-progress" aria-label="实验进度">
          <i style={{ width: `${experiment.progress.percent}%` }} />
        </div>
      )}

      <div className="pt-exp-metrics">
        <MetricPill label="实验前 ROI" value={baseline.roi.toFixed(2)} />
        <MetricPill label="7 天消耗" value={fmtMoney(baseline.cost7d)} />
        <MetricPill label="转化/天" value={`${Math.round(baseline.conversions)}`} />
        <MetricPill label="开始" value={pending ? "待确认" : fmtDate(experiment.startedAt)} />
      </div>

      {experiment.readout ? (
        <ReadoutBlock readout={experiment.readout} />
      ) : (
        <div className="pt-exp-running-note">
          {pending
            ? "确认后会开始计时；也可以先取消。"
            : running
              ? observing
                ? `只观察，不改投放；D${experiment.progress.day} 先看数据是否正常，D3 / D7 对比基线。`
                : `动作已生效，D${experiment.progress.day} 先看数据是否正常；到 D3 / D7 再看 ROI 和 GMV。`
              : "实验已结束。"}
        </div>
      )}

      <div className="pt-exp-rows is-compact">
        <div>
          <span>判断标准</span>
          <b>{experiment.criteria}</b>
        </div>
        <div>
          <span>护栏</span>
          <b>{experiment.guardrail}</b>
        </div>
      </div>

      <div className="pt-exp-actions">
        {pending && (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenPending(experiment.decisionId ?? undefined)} disabled={busy}>
              <ArrowRight size={12} /> 去确认
            </button>
            <button type="button" className="btn btn-default btn-sm" onClick={() => onStop(false)} disabled={busy}>
              取消实验
            </button>
          </>
        )}
        {running && (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={onReadout} disabled={busy}>
              <Check size={12} /> 提前复盘
            </button>
            <button type="button" className="btn btn-default btn-sm" onClick={() => onStop(true)} disabled={busy}>
              <RotateCcw size={12} /> 回滚
            </button>
          </>
        )}
        {finished && experiment.canRollback && (
          <button type="button" className="btn btn-default btn-sm" onClick={onRollback} disabled={busy}>
            <RotateCcw size={12} /> 回滚实验动作
          </button>
        )}
        <button type="button" className="pt-exp-method-toggle" onClick={() => setShowMethod((value) => !value)}>
          {showMethod ? "收起方法" : "查看方法"} <ChevronDown size={11} className={showMethod ? "is-open" : ""} />
        </button>
      </div>

      {showMethod && (
        <div className="pt-exp-method">
          <div><span>主指标</span><b>{experiment.design.primaryMetric}</b></div>
          <div><span>方法</span><b>前后对比 + 同账户/同计划基线；不是严格 A/B</b></div>
          <div><span>样本</span><b>{experiment.design.sampleNote}</b></div>
          <div><span>检查点</span><b>{experiment.design.checkpoints.map((item) => `D${item.day} ${item.label}`).join("；")}</b></div>
          <div><span>风险</span><b>{experiment.riskText}</b></div>
        </div>
      )}
    </article>
  );
}

export default function ExperimentDrawer({
  open,
  onClose,
  onOpenPending,
  onOpenQuality,
  scope = null,
  showQualityLink = true,
}: {
  open: boolean;
  onClose: () => void;
  onOpenPending: (decisionId?: string) => void;
  onOpenQuality: () => void;
  scope?: { accountId: string; accountName: string; planId?: string; planName?: string } | null;
  showQualityLink?: boolean;
}) {
  const [library, setLibrary] = useState<ExperimentLibrary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("suggested");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localScope, setLocalScope] = useState(scope);
  const [usage, setUsage] = useState<ExperimentUsage | null>(null);
  const [evalOpen, setEvalOpen] = useState(false);
  const viewTrackedRef = useRef(false);

  useEffect(() => {
    if (open) setLocalScope(scope);
  }, [open, scope?.accountId, scope?.planId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getExperimentLibrary({
        accountId: localScope?.accountId ?? null,
        planId: localScope?.planId ?? null,
      });
      setLibrary(data);
      void getExperimentUsage().then(setUsage).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载策略实验失败");
    } finally {
      setLoading(false);
    }
  }, [localScope?.accountId, localScope?.planId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) {
      viewTrackedRef.current = false;
      return;
    }
    if (!library || viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    void trackExperimentView(library.recommendations.length)
      .then(() => getExperimentUsage().then(setUsage).catch(() => {}))
      .catch(() => {});
  }, [open, library]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const start = async (recommendation: ExperimentRecommendation, mode: "start" | "observe") => {
    setBusy(recommendation.id);
    setNotice(null);
    try {
      const result = await startExperiment(recommendation.id, mode);
      if (!result.ok) throw new Error(result.error ?? "开始实验失败");
      await load();
      setTab("running");
      setNotice(
        mode === "observe"
          ? "已加入观察；到 D3 / D7 回来复盘。"
          : "已生成提案；去「待确认动作」确认后才开始计时。",
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "开始实验失败");
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (recommendation: ExperimentRecommendation) => {
    setBusy(recommendation.id);
    try {
      await dismissExperimentRecommendation(recommendation.id);
      await load();
      setNotice("已忽略这个建议；之后不会再推荐。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const readout = async (experiment: Experiment) => {
    setBusy(experiment.id);
    try {
      const result = await readoutExperiment(experiment.id);
      if (!result.ok) throw new Error(result.error ?? "复盘失败");
      await load();
      setTab("concluded");
      setNotice("复盘完成；可以继续、回滚，或查看方法。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "复盘失败");
    } finally {
      setBusy(null);
    }
  };

  const stop = async (experiment: Experiment, rollback: boolean) => {
    setBusy(experiment.id);
    try {
      const result = await stopExperiment(experiment.id, rollback);
      if (!result.ok) throw new Error(result.error ?? "操作失败");
      await load();
      setTab("concluded");
      setNotice(rollback ? "已结束并回滚实验动作。" : "实验已结束。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (experiment: Experiment) => {
    setBusy(experiment.id);
    try {
      const result = await rollbackExperiment(experiment.id);
      if (!result.ok) throw new Error(result.error ?? "回滚失败");
      await load();
      setNotice("已回滚实验动作。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "回滚失败");
    } finally {
      setBusy(null);
    }
  };

  const recommendations = library?.recommendations ?? [];
  const experiments = library?.experiments ?? [];
  const running = experiments.filter((item) => item.status === "pending" || item.status === "running");
  const concluded = experiments.filter((item) => ["concluded", "reverted", "cancelled"].includes(item.status));
  const counts = {
    suggested: recommendations.length,
    running: running.length,
    concluded: concluded.length,
  };
  const scopeLabel = localScope
    ? localScope.planId
      ? `${localScope.planName ?? "当前计划"} · ${localScope.accountName}`
      : `${localScope.accountName} · 当前账户`
    : "全部账户";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="策略实验"
      sub={
        library
          ? `${scopeLabel} · ${counts.suggested} 个建议 · ${counts.running} 个进行中 · ${counts.concluded} 个已结论`
          : `${scopeLabel} · 推荐 · 进行中 · 已结论`
      }
      className="pt-experiment-drawer"
    >
      <div className="pt-exp">
        <div className="pt-exp-top">
          <div className="pt-exp-note">
            <FlaskConical size={12} />
            <span className="pt-exp-policy">v0.3 保守 · 只降不增</span>
            <span>{library?.note ?? "Phase 1：复盘基于模拟数据，不是真实投放结果。"}</span>
          </div>
          <button type="button" className="pt-exp-refresh" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={12} className={loading ? "spin" : ""} /> 刷新
          </button>
        </div>

        <div className="pt-exp-tabs" role="tablist">
          {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`pt-exp-tab ${tab === key ? "is-active" : ""}`}
              onClick={() => setTab(key)}
            >
              {TAB_LABEL[key]}
              <span>{counts[key]}</span>
            </button>
          ))}
        </div>

        {usage && (
          <div className="pt-exp-usage">
            {usage.views > 0 ? (
              <>
                <span>本地累计：打开 {usage.views} · 开始 {usage.starts} · 回滚 {usage.rollbacks}</span>
                <span>{usage.diagnosis}</span>
              </>
            ) : (
              <span>本地暂无使用数据；打开一次即记录。</span>
            )}
          </div>
        )}

        {notice && <div className="pt-exp-notice">{notice}</div>}

        {loading && !library && (
          <div className="pt-exp-loading">
            <RefreshCw size={14} className="spin" /> 正在生成推荐…
          </div>
        )}

        {!loading && error && (
          <div className="pt-exp-error">
            <AlertTriangle size={15} />
            <div>
              <b>加载失败</b>
              <p>{error}</p>
              <p>请确认 `npm run partner` 已启动；如果仍报 Not found，说明 5180 上还是旧进程，重启它。</p>
            </div>
          </div>
        )}

        {!error && library && tab === "suggested" && (
          <div className="pt-exp-list">
            {recommendations.map((recommendation) => (
              <RecommendationCard
                key={recommendation.id}
                recommendation={recommendation}
                busy={busy === recommendation.id}
                onStart={() => void start(recommendation, "start")}
                onObserve={() => void start(recommendation, "observe")}
                onDismiss={() => void dismiss(recommendation)}
              />
            ))}
            {recommendations.length === 0 && (
              <div className="pt-exp-empty">
                <Target size={18} />
                <b>{localScope ? `${localScope.accountName} 暂时没有建议` : "暂无新建议"}</b>
                <p>
                  {localScope
                    ? "可能样本不足、数据延迟，或这个账户暂时没有明显异常。可以先看看其他账户。"
                    : "可能样本不足、已经全部开始，或都被忽略了。去「进行中」看看，或刷新推荐。"}
                </p>
                {localScope && (
                  <div className="pt-exp-empty-actions">
                    {counts.running > 0 && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab("running")}>
                        查看进行中的 {counts.running} 个实验
                      </button>
                    )}
                    <button type="button" className="btn btn-default btn-sm" onClick={() => setLocalScope(null)}>
                      查看全部账户的建议
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!error && library && tab === "running" && (
          <div className="pt-exp-list">
            {running.map((experiment) => (
              <ExperimentCard
                key={experiment.id}
                experiment={experiment}
                busy={busy === experiment.id}
                onOpenPending={onOpenPending}
                onReadout={() => void readout(experiment)}
                onStop={(rollback) => void stop(experiment, rollback)}
                onRollback={() => void rollback(experiment)}
              />
            ))}
            {running.length === 0 && (
              <div className="pt-exp-empty">
                <Play size={18} />
                <b>还没有进行中的实验</b>
                <p>从「推荐」开始一个 3–7 天的小实验；开始后会生成待确认提案。</p>
              </div>
            )}
          </div>
        )}

        {!error && library && tab === "concluded" && (
          <div className="pt-exp-list">
            {concluded.map((experiment) => (
              <ExperimentCard
                key={experiment.id}
                experiment={experiment}
                busy={busy === experiment.id}
                onOpenPending={onOpenPending}
                onReadout={() => void readout(experiment)}
                onStop={(rollback) => void stop(experiment, rollback)}
                onRollback={() => void rollback(experiment)}
              />
            ))}
            {concluded.length === 0 && (
              <div className="pt-exp-empty">
                <Sparkles size={18} />
                <b>还没有结论</b>
                <p>实验到 D3 / D7 后，点「提前复盘」就能看到继续/回滚建议。</p>
              </div>
            )}
          </div>
        )}

        <footer className="pt-exp-footer">
          <div className="pt-exp-footer-links">
            <button type="button" className="pt-exp-quality-link" onClick={() => setEvalOpen(true)}>
              <BarChart3 size={11} /> 评测记录
            </button>
            {showQualityLink && (
              <button type="button" className="pt-exp-quality-link" onClick={onOpenQuality}>
                研究回放（产品视角）
              </button>
            )}
          </div>
          <span>Phase 1 · 复盘为模拟数据</span>
        </footer>

        <Modal
          open={evalOpen}
          onClose={() => setEvalOpen(false)}
          title="策略实验 · 评测记录"
          desc="60 个历史 T0/T+7 回放 · 离线评测，不是线上 A/B"
          className="pt-eval-modal"
          footer={
            <button type="button" className="btn btn-default" onClick={() => setEvalOpen(false)}>
              知道了
            </button>
          }
        >
          <div className="pt-eval-lead">
            <b>当前默认：v0.3 保守 · 只降不增</b>
            <span>加预算模板在回放里失效，先不自动推荐。</span>
          </div>
          <table className="pt-eval-table">
            <thead>
              <tr>
                <th>策略</th>
                <th>方向准确率</th>
                <th>安全准确率</th>
                <th>结论</th>
              </tr>
            </thead>
            <tbody>
              {EVAL_ROWS.map((row) => (
                <tr key={row.version}>
                  <td>{row.version}</td>
                  <td>{row.accuracy}</td>
                  <td>{row.safe}</td>
                  <td>{row.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pt-eval-note">
            <p><b>方向准确率</b>：建议动作和 7 天后结果是否一致。</p>
            <p><b>安全准确率</b>：方向对，且 GMV 没跌破对照 5%。</p>
            <p><b>v0.4</b> 预算撞线方向 87.5%，但 GMV 护栏 0/8，所以暂不上线。</p>
            <p>详细报告：<code>docs/eval/policy-v0.4.md</code></p>
          </div>
        </Modal>
      </div>
    </Drawer>
  );
}
