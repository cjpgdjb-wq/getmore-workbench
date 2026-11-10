import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasProvider } from "../server/llm.mjs";
import { skillById } from "../server/skills.mjs";
import { runSkillCase } from "../server/skill-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillId = process.argv[2] ?? "learning_phase_diagnosis";
const skill = skillById(skillId);
if (!skill) throw new Error(`未知 skill: ${skillId}`);
const slug = skillId.replace(/_/g, "-");
const CASE_FILE = path.join(ROOT, skill.evalCaseFile);
const OUT_JSON = path.join(ROOT, "docs", "skills", `${slug}.eval.json`);
const OUT_MD = path.join(ROOT, "docs", "skills", `${slug}.eval.md`);

function includesAll(text, items) {
  return items.map((item) => {
    if (typeof item === "string") return { keyword: item, hit: text.includes(item) };
    const alternatives = Array.isArray(item.any) ? item.any : [item.label];
    return {
      keyword: item.label ?? alternatives[0],
      hit: alternatives.some((alternative) => text.includes(alternative)),
    };
  });
}

function checkMoves(data, expectedMoves) {
  if (!expectedMoves) return { pass: true, actual: "不检查" };
  const moves = Array.isArray(data.moves) ? data.moves : [];
  const decreases = moves.filter((move) => Number(move.deltaPct) < 0).length;
  const increases = moves.filter((move) => Number(move.deltaPct) > 0).length;
  const deltasOk = !expectedMoves.deltas || expectedMoves.deltas.every((delta) => moves.some((move) => Number(move.deltaPct) === delta));
  const countOk = moves.length === expectedMoves.count;
  const directionOk =
    (expectedMoves.decrease === undefined || decreases === expectedMoves.decrease) &&
    (expectedMoves.increase === undefined || increases === expectedMoves.increase);
  return {
    pass: countOk && directionOk && deltasOk,
    actual: `moves=${moves.length}, 降=${decreases}, 加=${increases}, deltas=${moves.map((move) => move.deltaPct).join("/") || "--"}`,
  };
}

async function main() {
  if (!hasProvider()) throw new Error("未配置模型 API Key");
  const payload = JSON.parse(fs.readFileSync(CASE_FILE, "utf8"));
  const results = [];

  for (const item of payload.cases) {
    const run = await runSkillCase(payload.skillId, item.input);
    const text = `${JSON.stringify(run.data)}\n${run.text}`;
    const actionText = JSON.stringify({
      verdict: run.data.verdict,
      moves: run.data.moves,
      action: run.data.action,
      report: run.data.report,
    });
    const includes = includesAll(text, item.expected.mustInclude);
    const excludes = includesAll(actionText, item.expected.mustNotInclude);
    const moveResult = checkMoves(run.data, item.expected.moves);
    const actionHit =
      !item.expected.actionAny ||
      item.expected.actionAny.some((action) => actionText.includes(action));
    const verdictMatch = run.data.verdict === item.expected.verdict;
    const noForbidden = excludes.every((item) => !item.hit);
    const pass = verdictMatch && includes.every((item) => item.hit) && noForbidden && moveResult.pass && actionHit;
    results.push({
      id: item.id,
      name: item.name,
      expectedVerdict: item.expected.verdict,
      actualVerdict: run.data.verdict,
      verdictMatch,
      includes,
      excludes,
      moveResult,
      actionHit,
      noForbidden,
      pass,
      output: run.data,
      usage: run.usage,
    });
  }

  const summary = {
    total: results.length,
    passed: results.filter((item) => item.pass).length,
    verdictMatches: results.filter((item) => item.verdictMatch).length,
    forbiddenHits: results.filter((item) => !item.noForbidden).length,
  };

  const lines = [
    `# ${skill.name} · 真实 LLM 评测 v${skill.version}`,
    "",
    `> 生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 1. 结果",
    "",
    `- 样本：${summary.total} 个 case`,
    `- 通过：**${summary.passed} / ${summary.total}**`,
    `- verdict 一致：${summary.verdictMatches} / ${summary.total}`,
    `- 命中禁止项：${summary.forbiddenHits} 个 case`,
    "",
    "| case | 期望 | 实际 | verdict | 必含词 | 禁止词 | 动作 | 结果 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (item) =>
        `| ${item.id} ${item.name} | ${item.expectedVerdict} | ${item.actualVerdict} | ${item.verdictMatch ? "✅" : "❌"} | ${item.includes.filter((x) => !x.hit).map((x) => x.keyword).join("、") || "全中"} | ${item.excludes.filter((x) => x.hit).map((x) => x.keyword).join("、") || "无"} | ${item.moveResult.pass ? "✅" : "❌"} ${item.moveResult.actual} | ${item.pass ? "通过" : "失败"} |`,
    ),
    "",
    "## 2. 模型输出",
    "",
    ...results.flatMap((item) => [
      `### ${item.id} ${item.name}`,
      "",
      "```json",
      JSON.stringify(item.output, null, 2),
      "```",
      "",
    ]),
    "## 3. 说明",
    "",
    "- 这是 skill 级 LLM 评测：给模型 skill + case 数据，不调用工具；",
    "- 评分使用同义表达（如 budget -10% / 预算 -10%），避免把语义正确判成失败；",
    "- 禁止词只检查 verdict / moves / action，不检查 guardrail 里的“不暂停”等否定句；",
    "- 不是完整 Agent 工具链评测，也不是线上投放结果；",
    "- 通过只说明模型能按 skill 约束输出，不代表真实业务有效。",
    "",
  ];

  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: Date.now(), summary, results }, null, 2), "utf8");
  fs.writeFileSync(OUT_MD, lines.join("\n"), "utf8");

  console.log(`cases: ${summary.total} | passed: ${summary.passed} | verdict: ${summary.verdictMatches}`);
  for (const item of results) {
    console.log(`${item.id}: ${item.actualVerdict} (expect ${item.expectedVerdict}) ${item.pass ? "PASS" : "FAIL"}`);
  }
  console.log(`report: ${OUT_MD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
