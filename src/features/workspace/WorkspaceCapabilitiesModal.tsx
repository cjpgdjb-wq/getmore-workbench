import { useEffect, useState } from "react";
import { Boxes, Check, ShieldCheck, Wrench } from "lucide-react";
import { Checkbox, Modal } from "../../components/ui";
import type { ProductThread } from "./productThreads";
import { SHARED_SKILLS, SHARED_TOOLS } from "./assistantRegistry";
import { useWorkbench } from "../../state/workbench";

export default function WorkspaceCapabilitiesModal({
  open,
  workspace,
  onClose,
}: {
  open: boolean;
  workspace: ProductThread | null;
  onClose: () => void;
}) {
  const { updateProductThread } = useWorkbench();
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !workspace) return;
    setToolIds(workspace.toolIds);
    setSkillIds(workspace.skillIds);
  }, [open, workspace?.id]);

  if (!workspace) return null;

  const toggle = (list: string[], id: string, next: boolean) =>
    next ? Array.from(new Set([...list, id])) : list.filter((item) => item !== id);

  const save = () => {
    updateProductThread(workspace.id, { toolIds, skillIds });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="工作区能力"
      desc="工具和技能来自全局共享池；工作区只做绑定，不复制定义。"
      className="workspace-capabilities-modal"
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose}>取消</button>
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={save}>
            <Check size={12} /> 保存绑定
          </button>
        </>
      }
    >
      <div className="capability-note">
        <ShieldCheck size={14} />
        <div>
          <b>当前 {workspace.permission === "read" ? "只读分析" : "分析 + 提案"}模式</b>
          <p>工具只对当前工作区生效；执行类工具仍需要后续的范围校验与审批。</p>
        </div>
      </div>

      <section className="capability-section">
        <div className="capability-head">
          <span><Wrench size={13} /> 工具池</span>
          <b>{toolIds.length} / {SHARED_TOOLS.length}</b>
        </div>
        <div className="capability-list">
          {SHARED_TOOLS.map((tool) => (
            <label className={`capability-row ${tool.risk !== "read" ? "is-write" : ""}`} key={tool.id}>
              <Checkbox
                checked={toolIds.includes(tool.id)}
                onChange={(next) => setToolIds((prev) => toggle(prev, tool.id, next))}
                ariaLabel={`绑定工具 ${tool.name}`}
              />
              <span className="capability-main">
                <b>{tool.name}</b>
                <span>{tool.description}</span>
              </span>
              <span className="capability-meta">{tool.category}</span>
              <span className={`capability-risk ${tool.risk}`}>
                {tool.risk === "read" ? "只读" : tool.risk === "write" ? "写入" : "高风险"}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="capability-section">
        <div className="capability-head">
          <span><Boxes size={13} /> 技能池</span>
          <b>{skillIds.length} / {SHARED_SKILLS.length}</b>
        </div>
        <div className="capability-list">
          {SHARED_SKILLS.map((skill) => (
            <label className="capability-row" key={skill.id}>
              <Checkbox
                checked={skillIds.includes(skill.id)}
                onChange={(next) => setSkillIds((prev) => toggle(prev, skill.id, next))}
                ariaLabel={`绑定技能 ${skill.name}`}
              />
              <span className="capability-main">
                <b>{skill.name}</b>
                <span>{skill.description}</span>
              </span>
              <span className="capability-meta">技能</span>
            </label>
          ))}
        </div>
      </section>
    </Modal>
  );
}
