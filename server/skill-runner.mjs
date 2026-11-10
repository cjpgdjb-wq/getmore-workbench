import { chat } from "./llm.mjs";
import { skillById } from "./skills.mjs";

function parseJson(text) {
  const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型输出不是 JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function runSkillCase(skillId, input) {
  const skill = skillById(skillId);
  if (!skill) throw new Error(`未知 skill: ${skillId}`);
  const system = [
    `你正在执行 GETmore 的「${skill.name}」技能 v${skill.version}。`,
    `技能说明：${skill.instructions}`,
    `步骤：${skill.steps.map((step, index) => `${index + 1}. ${step}`).join("；")}`,
    `失败处理：${skill.failure}`,
    "只输出 JSON，不要 Markdown，不要解释 JSON 之外的内容。",
    `JSON 结构：${JSON.stringify(skill.output)}`,
  ].join("\n");
  const user = `投放现场数据：\n${JSON.stringify(input, null, 2)}\n\n请按技能给出结论。`;
  let lastText = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await chat({
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: attempt === 1 ? user : `${user}\n\n上一次输出不是合法 JSON。这次只输出一个 JSON 对象，不要 Markdown，不要解释。`,
        },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0,
      maxTokens: 4000,
    });
    lastText = response.message?.content ?? "";
    try {
      return { text: lastText, data: parseJson(lastText), usage: response.usage, attempt };
    } catch {
      if (attempt === 2) {
        throw new Error(`模型输出不是 JSON（重试 2 次）：${lastText.slice(0, 160)}`);
      }
    }
  }
  throw new Error(`模型输出不是 JSON：${lastText.slice(0, 160)}`);
}
