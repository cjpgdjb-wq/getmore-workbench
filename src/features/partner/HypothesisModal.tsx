import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  FlaskConical,
  Gauge,
  GitBranch,
  ListChecks,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { Modal } from "../../components/ui";
import {
  getHypotheses,
  replayHypothesis,
  type HypothesisEvalCase,
  type HypothesisEvidence,
  type HypothesisEvidenceMetric,
  type HypothesisLibrary,
} from "../../lib/partner";

function fmtMoney(value: number): string {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function fmtMetric(value: number, unit: string): string {
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "s") return `${value.toFixed(1)}s`;
  if (unit === "分钟") return `${Math.round(value)} 分钟`;
  return Number(value).toFixed(2);
}

function fmtEffect(value: number, unit: string): string {
  const sign = value > 0 ? "+" : "";
  if (unit === "pp") return `${sign}${value.toFixed(1)}pp`;
  if (unit === "s") return `${sign}${value.toFixed(1)}s`;
  if (unit === "%") return `${sign}${value.toFixed(1)}%`;
  return `${sign}${value.toFixed(2)}`;
}

function fmtP(value: number | null): string {
  if (value === null) return "--";
  if (value < 0.001) return "<0.001";
  return value.toFixed(3);
}

function statusClass(tone: string): string {
  return `badge badge-${tone === "gray" ? "gray" : tone}`;
}

function MetricCard({ label, metric }: { label: string; metric: HypothesisEvidenceMetric }) {
  const good =
    metric.better === "higher"
      ? metric.effect > 0
      : metric.effect < 0;
  return (
    <div className="pt-hyp-metric">
      <div className="pt-hyp-metric-head">
        <span>{label}</span>
        <em className={good ? "is-good" : metric.effect === 0 ? "" : "is-bad"}>
          {fmtEffect(metric.effect, metric.effectUnit || metric.unit)}
        </em>
      </div>
      <div className="pt-hyp-metric-body">
        <div>
          <small>干预组</small>
          <b>{fmtMetric(metric.treatment, metric.unit)}</b>
        </div>
        <span className="pt-hyp-vs">vs</span>
        <div>
          <small>对照组</small>
          <b>{fmtMetric(metric.control, metric.unit)}</b>
        </div>
      </div>
      <div className="pt-hyp-metric-foot">
        p = {fmtP(metric.p)}
        {metric.ci
          ? ` · 95% CI ${metric.ci[0].toFixed(1)} ~ ${metric.ci[1].toFixed(1)}${
              metric.effectUnit === "pp" ? "pp" : metric.unit === "%" ? "%" : ""
            }`
          : ""}
      </div>
    </div>
  );
}

function EvidencePanel({
  evidence,
  replaying,
  onReplay,
}: {
  evidence: HypothesisEvidence | null;
  replaying: boolean;
  onReplay: () => void;
}) {
  if (!evidence) {
    return (
      <div className="pt-hyp-evidence-empty">
        <div className="pt-hyp-evidence-empty-icon"><FlaskConical size={20} /></div>
        <div>
          <b>还没有回放结果</b>
          <p>回放使用确定性模拟实验数据，只验证「观察 → 假设 → 对照 → 效应 → 决策」的方法与链路，不代表真实因果。</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onReplay} disabled={replaying}>
          {replaying ? <RefreshCw size={12} className="spin" /> : <Play size={12} />} 运行回放
        </button>
      </div>
    );
  }

  return (
    <div className="pt-hyp-evidence">
      <div className={`pt-hyp-verdict tone-${evidence.verdict}`}>
        <div>
          <span className="pt-hyp-verdict-kicker">回放判定</span>
          <b>{evidence.verdictLabel}</b>
        </div>
        <div className="pt-hyp-verdict-meta">
          <span><FlaskConical size={11} /> 模拟回放</span>
          <span>{evidence.sample.treatment} 干预 / {evidence.sample.control} 对照 · {evidence.sample.unit}</span>
          <span>置信 {evidence.confidence === "high" ? "高" : evidence.confidence === "medium" ? "中" : "低"}</span>
        </div>
        <button type="button" className="btn btn-default btn-sm" onClick={onReplay} disabled={replaying}>
          {replaying ? <RefreshCw size={12} className="spin" /> : <RefreshCw size={12} />} 重新回放
        </button>
      </div>

      <div className="pt-hyp-metric-grid">
        {evidence.metrics.map((metric) => (
          <MetricCard key={metric.key} label={metric.label} metric={metric} />
        ))}
      </div>

      <div className="pt-hyp-guardrails">
        {evidence.guardrails.map((guardrail) => (
          <div key={guardrail.label} className={`pt-hyp-guardrail ${guardrail.pass ? "is-pass" : "is-fail"}`}>
            {guardrail.pass ? <Check size={12} /> : <AlertTriangle size={12} />}
            <span>{guardrail.label}</span>
            <b>
              {guardrail.value.toFixed(1)}
              {guardrail.unit === "%" ? "%" : ` ${guardrail.unit}`}
            </b>
            <em>阈值 {guardrail.threshold}{guardrail.unit === "%" ? "%" : ` ${guardrail.unit}`}</em>
          </div>
        ))}
      </div>

      <p className="pt-hyp-evidence-summary">{evidence.summary}</p>
      <p className="pt-hyp-caveat"><AlertTriangle size={11} /> {evidence.caveat}</p>
    </div>
  );
}

function EvalCaseRow({ item }: { item: HypothesisEvalCase }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = JSON.stringify(item, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="pt-hyp-eval-row">
      <div className="pt-hyp-eval-id">{item.id}</div>
      <div className="pt-hyp-eval-main">
        <b>{item.goal}</b>
        <span>{item.expected}</span>
      </div>
      <button type="button" className="pt-hyp-copy" onClick={copy} title="复制 JSON">
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

export default function HypothesisModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [library, setLibrary] = useState<HypothesisLibrary | null>(null);
  const [activeId, setActiveId] = useState<string>("H1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getHypotheses()
      .then((data) => {
        if (cancelled) return;
        setLibrary(data);
        setActiveId((current) => (data.hypotheses.some((item) => item.id === current) ? current : data.hypotheses[0]?.id ?? "H1"));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载假设失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const active = useMemo(
    () => library?.hypotheses.find((item) => item.id === activeId) ?? library?.hypotheses[0] ?? null,
    [library, activeId],
  );

  const runReplay = async (id: string) => {
    setReplaying(id);
    setNotice(null);
    try {
      const result = await replayHypothesis(id);
      if (!result.ok) throw new Error(result.error ?? "回放失败");
      setLibrary((current) => {
        if (!current) return current;
        return {
          ...current,
          summary: result.summary,
          hypotheses: current.hypotheses.map((item) => (item.id === result.hypothesis.id ? result.hypothesis : item)),
        };
      });
      setActiveId(result.hypothesis.id);
      setNotice(`${result.hypothesis.shortTitle}：${result.hypothesis.evidence?.verdictLabel ?? "回放完成"}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "回放失败");
    } finally {
      setReplaying(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="策略假设库"
      desc={
        library
          ? `${library.summary.total} 个假设 · ${library.summary.validated} 个已验证 · ${library.summary.inconclusive} 个需扩样本 · ${library.summary.trials} 条回放样本`
          : "观察 → 假设 → 对照 → 效应 → 决策规则"
      }
      className="pt-hypothesis-modal"
    >
      {loading && (
        <div className="pt-hyp-loading">
          <RefreshCw size={16} className="spin" />
          正在计算观察与回放样本…
        </div>
      )}

      {!loading && error && (
        <div className="pt-hyp-error">
          <AlertTriangle size={16} />
          <div>
            <b>加载失败</b>
            <p>{error}</p>
            <p>请确认 `npm run partner` 已启动；如果已启动仍报 Not found，说明 5180 上还是旧进程，重启它。</p>
          </div>
        </div>
      )}

      {!loading && !error && library && active && (
        <div className="pt-hyp-grid">
          <aside className="pt-hyp-list">
            <div className="pt-hyp-list-head">
              <span>假设队列</span>
              <span className="pt-hyp-synthetic"><FlaskConical size={10} /> 模拟回放</span>
            </div>
            {library.hypotheses.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`pt-hyp-item ${item.id === active.id ? "is-active" : ""}`}
                onClick={() => setActiveId(item.id)}
              >
                <div className="pt-hyp-item-top">
                  <span className={statusClass(item.statusTone)}>{item.statusLabel}</span>
                  <span className="pt-hyp-impact">影响 {item.impact}</span>
                </div>
                <b>{item.shortTitle}</b>
                <small>{item.observation.headline}</small>
                <div className="pt-hyp-item-foot">
                  <span>置信 {item.confidenceLabel}</span>
                  <span>{item.trialCount} 条样本</span>
                </div>
              </button>
            ))}
            <div className="pt-hyp-list-caveat">
              <AlertTriangle size={11} />
              <span>{library.caveat}</span>
            </div>
          </aside>

          <section className="pt-hyp-detail">
            <header className="pt-hyp-header">
              <div className="pt-hyp-header-main">
                <div className="pt-hyp-header-meta">
                  <span className={statusClass(active.statusTone)}>{active.statusLabel}</span>
                  <span className="pt-hyp-impact"><Gauge size={11} /> 影响 {active.impact}</span>
                  <span className="pt-hyp-impact"><ShieldCheck size={11} /> 置信 {active.confidenceLabel}</span>
                  <span className="pt-hyp-impact"><FlaskConical size={11} /> 模拟回放</span>
                </div>
                <h3>{active.title}</h3>
                <p>{active.question}</p>
                <div className="pt-hyp-tags">
                  {active.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => runReplay(active.id)}
                disabled={Boolean(replaying)}
              >
                {replaying === active.id ? <RefreshCw size={12} className="spin" /> : <Play size={12} />}
                {active.evidence ? "重新回放" : "运行回放"}
              </button>
            </header>

            {notice && <div className="pt-hyp-notice">{notice}</div>}

            <section className="pt-hyp-section">
              <div className="pt-hyp-section-head">
                <Target size={14} />
                <h4>观察</h4>
                <span>来自当前 mock 数据，不是结论</span>
              </div>
              <p className="pt-hyp-observation-lead">{active.observation.headline}</p>
              <div className="pt-hyp-obs-metrics">
                {active.observation.metrics.map((metric) => (
                  <div key={metric.label} className="pt-hyp-obs-metric">
                    <span>{metric.label}</span>
                    <b>{metric.value}</b>
                    {metric.hint && <small>{metric.hint}</small>}
                  </div>
                ))}
              </div>
              {active.observation.segments.length > 0 && (
                <div className="pt-hyp-table-wrap">
                  <table className="pt-hyp-table">
                    <thead>
                      <tr>
                        <th>分层</th>
                        <th>数量</th>
                        <th>消耗</th>
                        <th>ROI</th>
                        <th>{active.observation.segmentLabel ?? "转化/信号"}</th>
                        <th>备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.observation.segments.map((segment) => (
                        <tr key={segment.label}>
                          <td>{segment.label}</td>
                          <td>{segment.count}</td>
                          <td>{fmtMoney(segment.cost)}</td>
                          <td>{segment.roi > 0 ? segment.roi.toFixed(2) : "--"}</td>
                          <td>{segment.conversions.toFixed(0)}</td>
                          <td>{segment.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="pt-hyp-observation-summary">{active.observation.summary}</p>
              {active.observation.caveat && <p className="pt-hyp-caveat"><AlertTriangle size={11} /> {active.observation.caveat}</p>}
            </section>

            <section className="pt-hyp-section">
              <div className="pt-hyp-section-head">
                <Sparkles size={14} />
                <h4>假设</h4>
                <span>可被证伪的因果陈述</span>
              </div>
              <blockquote className="pt-hyp-statement">{active.hypothesis.statement}</blockquote>
              <p className="pt-hyp-mechanism"><b>机制：</b>{active.hypothesis.mechanism}</p>
              <div className="pt-hyp-design-grid">
                <div><span>人群</span><b>{active.hypothesis.population}</b></div>
                <div><span>干预</span><b>{active.hypothesis.intervention}</b></div>
                <div><span>对照</span><b>{active.hypothesis.control}</b></div>
                <div><span>主指标</span><b>{active.hypothesis.primaryMetric}</b></div>
                <div><span>护栏</span><b>{active.hypothesis.guardrail}</b></div>
                <div><span>时间窗</span><b>{active.hypothesis.horizon}</b></div>
              </div>
              <div className="pt-hyp-decision">
                <GitBranch size={13} />
                <span><b>决策规则：</b>{active.hypothesis.decisionRule}</span>
              </div>
            </section>

            <section className="pt-hyp-section">
              <div className="pt-hyp-section-head">
                <ListChecks size={14} />
                <h4>策略</h4>
                <span>从假设落到可执行规则</span>
              </div>
              <div className="pt-hyp-table-wrap">
                <table className="pt-hyp-table pt-hyp-strategy-table">
                  <thead>
                    <tr>
                      <th>分组</th>
                      <th>条件</th>
                      <th>动作</th>
                      <th>护栏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.strategy.map((row) => (
                      <tr key={row.group}>
                        <td><b>{row.group}</b></td>
                        <td>{row.condition}</td>
                        <td>{row.action}</td>
                        <td>{row.guardrail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="pt-hyp-section">
              <div className="pt-hyp-section-head">
                <FlaskConical size={14} />
                <h4>实验</h4>
                <span>先回放，再影子，最后才 A/B</span>
              </div>
              <div className="pt-hyp-test-grid">
                <div><span>方法</span><b>{active.test.method}</b></div>
                <div><span>单元</span><b>{active.test.unit}</b></div>
                <div><span>样本</span><b>{active.test.sample}</b></div>
                <div><span>时间窗</span><b>{active.test.window}</b></div>
                <div><span>预注册</span><b>{active.test.preRegistration}</b></div>
              </div>
              <div className="pt-hyp-risks">
                {active.test.risks.map((risk) => (
                  <span key={risk}><AlertTriangle size={10} /> {risk}</span>
                ))}
              </div>
            </section>

            <section className="pt-hyp-section">
              <div className="pt-hyp-section-head">
                <Gauge size={14} />
                <h4>回放结果</h4>
                <span>{active.evidence ? `运行于 ${new Date(active.evidence.ranAt).toLocaleString("zh-CN")}` : "还没有运行"}</span>
              </div>
              <EvidencePanel
                evidence={active.evidence}
                replaying={replaying === active.id}
                onReplay={() => runReplay(active.id)}
              />
            </section>

            <section className="pt-hyp-section">
              <div className="pt-hyp-section-head">
                <ArrowUpRight size={14} />
                <h4>产品化</h4>
                <span>假设验证后，变成 Agent 能力与评测用例</span>
              </div>
              <div className="pt-hyp-productization">
                <div><span>工具</span><b>{active.productization.tool}</b></div>
                <div><span>技能</span><b>{active.productization.skill}</b></div>
              </div>
              <div className="pt-hyp-eval-list">
                {active.productization.evalCases.map((item) => (
                  <EvalCaseRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          </section>
        </div>
      )}
    </Modal>
  );
}
