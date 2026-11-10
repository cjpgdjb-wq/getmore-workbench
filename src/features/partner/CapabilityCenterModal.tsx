import { useEffect, useState } from "react";
import { Boxes, Check, Plus, Trash2, Upload, Wrench } from "lucide-react";
import { Modal } from "../../components/ui";
import {
  deleteCapabilitySkill,
  deleteCapabilityTool,
  getCapabilitySkills,
  getCapabilityTools,
  importCapabilitySkill,
  importCapabilityTool,
  saveCapabilitySkill,
  saveCapabilityTool,
  type CapabilitySkill,
  type CapabilityTool,
} from "../../lib/partner";

type Tab = "skills" | "tools";

const EMPTY_SKILL: CapabilitySkill = {
  id: "new_skill",
  name: "新技能",
  version: "0.1",
  description: "",
  businessProblem: "",
  designRationale: "",
  businessMetrics: [],
  closedLoop: "",
  evidence: [],
  trigger: [],
  expertIds: ["analytics", "ads"],
  toolNames: [],
  steps: [],
  output: {},
  failure: "",
  instructions: "",
  evalCaseFile: "",
  source: "imported",
};

function splitList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function CapabilityCenterModal({
  open,
  onClose,
  onBack,
}: {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("skills");
  const [skills, setSkills] = useState<CapabilitySkill[]>([]);
  const [tools, setTools] = useState<CapabilityTool[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<CapabilitySkill | null>(null);
  const [selectedTool, setSelectedTool] = useState<CapabilityTool | null>(null);
  const [outputText, setOutputText] = useState("{}");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [skillData, toolData] = await Promise.all([getCapabilitySkills(), getCapabilityTools()]);
      setSkills(skillData.skills);
      setTools(toolData.tools);
      if (!selectedSkill && skillData.skills[0]) {
        setSelectedSkill(skillData.skills[0]);
        setOutputText(JSON.stringify(skillData.skills[0].output ?? {}, null, 2));
      }
      if (!selectedTool && toolData.tools[0]) setSelectedTool(toolData.tools[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载能力失败");
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const selectSkill = (skill: CapabilitySkill) => {
    setSelectedSkill({ ...skill });
    setOutputText(JSON.stringify(skill.output ?? {}, null, 2));
    setError(null);
  };

  const selectTool = (tool: CapabilityTool) => {
    setSelectedTool({ ...tool });
    setError(null);
  };

  const patchSkill = (patch: Partial<CapabilitySkill>) => {
    if (!selectedSkill) return;
    setSelectedSkill({ ...selectedSkill, ...patch });
  };

  const patchTool = (patch: Partial<CapabilityTool>) => {
    if (!selectedTool) return;
    setSelectedTool({ ...selectedTool, ...patch });
  };

  const saveSkill = async () => {
    if (!selectedSkill) return;
    setBusy(true);
    setError(null);
    try {
      const output = JSON.parse(outputText);
      const result = await saveCapabilitySkill({ ...selectedSkill, output });
      setSkills((prev) => {
        const index = prev.findIndex((item) => item.id === result.skill.id);
        return index >= 0 ? prev.map((item) => (item.id === result.skill.id ? result.skill : item)) : [...prev, result.skill];
      });
      setSelectedSkill(result.skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存技能失败");
    } finally {
      setBusy(false);
    }
  };

  const createSkill = () => {
    const next = { ...EMPTY_SKILL, id: `skill_${Date.now().toString(36)}` };
    setTab("skills");
    setSelectedSkill(next);
    setOutputText("{}");
    setError(null);
  };

  const removeSkill = async () => {
    if (!selectedSkill) return;
    if (!window.confirm(`删除技能「${selectedSkill.name}」？`)) return;
    setBusy(true);
    try {
      await deleteCapabilitySkill(selectedSkill.id);
      const next = skills.filter((item) => item.id !== selectedSkill.id);
      setSkills(next);
      if (next[0]) selectSkill(next[0]);
      else setSelectedSkill(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除技能失败");
    } finally {
      setBusy(false);
    }
  };

  const importSkill = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(importText) as CapabilitySkill;
      const result = await importCapabilitySkill(parsed);
      await load();
      selectSkill(result.skill);
      setImportOpen(false);
      setImportText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入技能失败");
    } finally {
      setBusy(false);
    }
  };

  const saveTool = async () => {
    if (!selectedTool) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveCapabilityTool(selectedTool.id, {
        description: selectedTool.description,
        enabled: selectedTool.enabled,
      });
      setTools((prev) => prev.map((item) => (item.id === result.tool.id ? result.tool : item)));
      setSelectedTool(result.tool);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存工具失败");
    } finally {
      setBusy(false);
    }
  };

  const importTool = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(importText) as {
        name: string;
        description: string;
        expertIds: string[];
        parameters?: Record<string, unknown>;
      };
      const result = await importCapabilityTool(parsed);
      setTools((prev) => [...prev, result.tool]);
      setSelectedTool(result.tool);
      setImportOpen(false);
      setImportText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入工具失败");
    } finally {
      setBusy(false);
    }
  };

  const removeTool = async () => {
    if (!selectedTool || selectedTool.source !== "imported") return;
    if (!window.confirm(`删除导入工具「${selectedTool.name}」？`)) return;
    setBusy(true);
    try {
      await deleteCapabilityTool(selectedTool.id);
      const next = tools.filter((item) => item.id !== selectedTool.id);
      setTools(next);
      if (next[0]) selectTool(next[0]);
      else setSelectedTool(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除工具失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      onBack={onBack}
      title="能力中心"
      desc="技能和工具分开管理：技能可编辑/导入；工具可编辑目录、导入定义，执行代码仍需研发注册。"
      className="cap-center-modal"
      footer={<button type="button" className="btn btn-default" onClick={onClose}>关闭</button>}
    >
      <div className="cap-center-tabs" role="tablist">
        <button type="button" className={tab === "skills" ? "is-active" : ""} onClick={() => setTab("skills")}>
          <Boxes size={13} /> 技能 <span>{skills.length}</span>
        </button>
        <button type="button" className={tab === "tools" ? "is-active" : ""} onClick={() => setTab("tools")}>
          <Wrench size={13} /> 工具 <span>{tools.length}</span>
        </button>
        <span className="spacer" />
        {tab === "skills" ? (
          <>
            <button type="button" className="btn btn-default btn-sm" onClick={createSkill}><Plus size={12} /> 新建</button>
            <button type="button" className="btn btn-default btn-sm" onClick={() => { setImportOpen(true); setImportText(""); }}>
              <Upload size={12} /> 导入
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-default btn-sm" onClick={() => { setImportOpen(true); setImportText(""); }}>
            <Upload size={12} /> 导入定义
          </button>
        )}
      </div>

      {error && <div className="cap-center-error">{error}</div>}

      {importOpen && (
        <div className="cap-center-import">
          <div className="cap-center-import-head">
            <b>{tab === "skills" ? "导入技能 JSON" : "导入工具定义 JSON"}</b>
            <span>{tab === "tools" ? "只导入定义，不执行；执行需研发注册 handler。" : "导入后可在左侧选择并编辑。"}</span>
          </div>
          <textarea
            className="cap-center-json"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={
              tab === "skills"
                ? '{\n  "id": "my_skill",\n  "name": "我的技能",\n  "version": "0.1",\n  "expertIds": ["analytics"],\n  "toolNames": ["query_plans"],\n  "steps": ["..."],\n  "output": {},\n  "failure": "...",\n  "instructions": "..."\n}'
                : '{\n  "name": "my_http_tool",\n  "description": "说明这个工具做什么",\n  "expertIds": ["analytics"],\n  "parameters": { "type": "object", "properties": {} }\n}'
            }
          />
          <div className="cap-center-actions">
            <button type="button" className="btn btn-default btn-sm" onClick={() => setImportOpen(false)}>取消</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !importText.trim()} onClick={() => void (tab === "skills" ? importSkill() : importTool())}>
              <Check size={12} /> 确认导入
            </button>
          </div>
        </div>
      )}

      <div className="cap-center-body">
        <aside className="cap-center-list">
          {tab === "skills" &&
            skills.map((skill) => (
              <button
                type="button"
                key={skill.id}
                className={`cap-center-item ${selectedSkill?.id === skill.id ? "is-active" : ""}`}
                onClick={() => selectSkill(skill)}
              >
                <b>{skill.name}</b>
                <span>v{skill.version} · {skill.expertIds.join(" / ")}</span>
              </button>
            ))}
          {tab === "tools" &&
            tools.map((tool) => (
              <button
                type="button"
                key={tool.id}
                className={`cap-center-item ${selectedTool?.id === tool.id ? "is-active" : ""}`}
                onClick={() => selectTool(tool)}
              >
                <b>{tool.name}</b>
                <span>{tool.source === "code" ? "代码工具" : "导入定义"} · {tool.expertNames.join(" / ") || "未绑定"}</span>
              </button>
            ))}
        </aside>

        <section className="cap-center-detail">
          {tab === "skills" && selectedSkill && (
            <>
              <div className="cap-center-detail-head">
                <div>
                  <b>{selectedSkill.name}</b>
                  <span>{selectedSkill.source === "builtin" ? "内置技能" : "导入/新建技能"} · {selectedSkill.id}</span>
                </div>
                <button type="button" className="cap-icon-btn danger" onClick={() => void removeSkill()} title="删除技能">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="cap-skill-why">
                <div>
                  <span>业务问题</span>
                  <p>{selectedSkill.businessProblem || "未填写：先说明这个技能解决什么业务问题。"}</p>
                </div>
                <div>
                  <span>设计思路</span>
                  <p>{selectedSkill.designRationale || "未填写：说明判断顺序和边界。"}</p>
                </div>
                <div>
                  <span>业务指标</span>
                  <p className="cap-metric-row">{(selectedSkill.businessMetrics ?? []).join(" · ") || "未填写"}</p>
                </div>
                <div>
                  <span>闭环</span>
                  <p>{selectedSkill.closedLoop || "未填写：说明技能如何进入执行、实验和复盘。"}</p>
                </div>
              </div>
              <div className="cap-form-grid">
                <label className="cap-field"><span>名称</span><input className="input" value={selectedSkill.name} onChange={(e) => patchSkill({ name: e.target.value })} /></label>
                <label className="cap-field"><span>版本</span><input className="input" value={selectedSkill.version} onChange={(e) => patchSkill({ version: e.target.value })} /></label>
              </div>
              <label className="cap-field"><span>描述</span><input className="input" value={selectedSkill.description} onChange={(e) => patchSkill({ description: e.target.value })} /></label>
              <label className="cap-field"><span>业务问题（为什么做）</span><textarea className="cap-textarea" rows={2} value={selectedSkill.businessProblem ?? ""} onChange={(e) => patchSkill({ businessProblem: e.target.value })} /></label>
              <label className="cap-field"><span>设计思路（怎么设计）</span><textarea className="cap-textarea" rows={3} value={selectedSkill.designRationale ?? ""} onChange={(e) => patchSkill({ designRationale: e.target.value })} /></label>
              <label className="cap-field"><span>闭环（和业务什么关系）</span><textarea className="cap-textarea" rows={2} value={selectedSkill.closedLoop ?? ""} onChange={(e) => patchSkill({ closedLoop: e.target.value })} /></label>
              <div className="cap-form-grid">
                <label className="cap-field"><span>业务指标（逗号分隔）</span><input className="input" value={(selectedSkill.businessMetrics ?? []).join(", ")} onChange={(e) => patchSkill({ businessMetrics: splitList(e.target.value) })} /></label>
                <label className="cap-field"><span>闭环证据（逗号分隔）</span><input className="input" value={(selectedSkill.evidence ?? []).join(", ")} onChange={(e) => patchSkill({ evidence: splitList(e.target.value) })} /></label>
              </div>
              <div className="cap-form-grid">
                <label className="cap-field"><span>专家（逗号分隔）</span><input className="input" value={selectedSkill.expertIds.join(", ")} onChange={(e) => patchSkill({ expertIds: splitList(e.target.value) })} /></label>
                <label className="cap-field"><span>工具（逗号分隔）</span><input className="input" value={selectedSkill.toolNames.join(", ")} onChange={(e) => patchSkill({ toolNames: splitList(e.target.value) })} /></label>
              </div>
              <label className="cap-field"><span>触发条件（每行一条）</span><textarea className="cap-textarea" rows={3} value={selectedSkill.trigger.join("\n")} onChange={(e) => patchSkill({ trigger: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} /></label>
              <label className="cap-field"><span>步骤（每行一条）</span><textarea className="cap-textarea" rows={5} value={selectedSkill.steps.join("\n")} onChange={(e) => patchSkill({ steps: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} /></label>
              <label className="cap-field"><span>Instructions</span><textarea className="cap-textarea" rows={5} value={selectedSkill.instructions} onChange={(e) => patchSkill({ instructions: e.target.value })} /></label>
              <label className="cap-field"><span>失败处理</span><textarea className="cap-textarea" rows={2} value={selectedSkill.failure} onChange={(e) => patchSkill({ failure: e.target.value })} /></label>
              <div className="cap-form-grid">
                <label className="cap-field"><span>输出 JSON</span><textarea className="cap-textarea cap-code" rows={7} value={outputText} onChange={(e) => setOutputText(e.target.value)} /></label>
                <label className="cap-field"><span>评测用例文件</span><input className="input" value={selectedSkill.evalCaseFile} onChange={(e) => patchSkill({ evalCaseFile: e.target.value })} /></label>
              </div>
              <div className="cap-center-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveSkill()}><Check size={12} /> 保存技能</button>
              </div>
            </>
          )}

          {tab === "skills" && !selectedSkill && (
            <div className="cap-center-empty"><Boxes size={18} /><b>还没有技能</b><p>新建或导入一个技能。</p></div>
          )}

          {tab === "tools" && selectedTool && (
            <>
              <div className="cap-center-detail-head">
                <div>
                  <b>{selectedTool.name}</b>
                  <span>{selectedTool.expertNames.join(" / ") || "未绑定专家"} · {selectedTool.executable ? "已注册执行" : "未注册执行"}</span>
                </div>
                {selectedTool.source === "imported" && (
                  <button type="button" className="cap-icon-btn danger" onClick={() => void removeTool()} title="删除导入工具">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="cap-tool-note">
                {selectedTool.source === "code"
                  ? "代码工具：执行逻辑在 tools.mjs；这里编辑的是目录描述和启用状态。"
                  : "导入定义：只保存元数据，不能执行；需要研发在 tools.mjs 注册 handler。"}
              </div>
              <label className="cap-field"><span>描述</span><textarea className="cap-textarea" rows={4} value={selectedTool.description} onChange={(e) => patchTool({ description: e.target.value })} /></label>
              {selectedTool.source === "code" && (
                <label className="cap-check">
                  <input type="checkbox" checked={selectedTool.enabled} onChange={(e) => patchTool({ enabled: e.target.checked })} />
                  目录启用（不影响已注册的执行代码）
                </label>
              )}
              <div className="cap-field">
                <span>参数</span>
                <pre className="cap-params">{JSON.stringify(selectedTool.parameters, null, 2)}</pre>
              </div>
              <div className="cap-center-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveTool()}><Check size={12} /> 保存工具</button>
              </div>
            </>
          )}

          {tab === "tools" && !selectedTool && (
            <div className="cap-center-empty"><Wrench size={18} /><b>还没有工具</b><p>从左侧选择一个工具。</p></div>
          )}
        </section>
      </div>
    </Modal>
  );
}
