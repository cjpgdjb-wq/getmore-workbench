import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  dismissRecommendation,
  getExperimentLibrary,
  getRecommendations,
  readoutExperiment,
  rollbackExperiment,
  startExperiment,
  stopExperiment,
} from "../server/experiments.mjs";
import { approveDecision } from "../server/decisions.mjs";

const FILE = path.join(process.cwd(), ".runtime", "partner", "experiments.json");
const backup = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : null;

function assertFinite(value, label) {
  assert.equal(typeof value, "number", `${label} should be a number`);
  assert.ok(Number.isFinite(value), `${label} should be finite, got ${value}`);
}

function reset() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ experiments: [], dismissed: [] }, null, 2), "utf8");
}

try {
  reset();

  const { recommendations, total } = await getRecommendations({ limit: 10 });
  assert.ok(total >= 3, "should generate at least 3 recommendations");
  assert.ok(recommendations.length >= 3, "should return at least 3 recommendations");
  for (const rec of recommendations) {
    assert.ok(rec.id && rec.templateId && rec.title, "recommendation identity");
    assert.ok(rec.scope.accountId, "recommendation scope");
    assert.ok(rec.rationale.length >= 2, "recommendation rationale");
    assert.ok(rec.criteria && rec.guardrail, "recommendation criteria/guardrail");
    assertFinite(rec.costCap, "recommendation cost cap");
    assert.equal(typeof rec.sampleAdequate, "boolean", "sampleAdequate");
  }
  console.log("recommendations:", recommendations.map((rec) => `${rec.templateId}:${rec.impact}`).join(" | "));

  // observe → running → readout → concluded
  const target = recommendations[0];
  const observed = await startExperiment({ recommendationId: target.id, mode: "observe" });
  assert.equal(observed.ok, true, "observe should start");
  assert.equal(observed.experiment.status, "running", "observe starts running");
  assert.equal(observed.experiment.decisionId, null, "observe creates no decision");
  const readout = await readoutExperiment(observed.experiment.id);
  assert.equal(readout.ok, true, "observe readout");
  assert.equal(readout.experiment.status, "concluded");
  assert.ok(readout.experiment.readout?.plain.length > 10, "readout plain language");
  assertFinite(readout.experiment.readout?.stats.roiDelta, "readout roiDelta");
  assertFinite(readout.experiment.readout?.stats.gmvDelta, "readout gmvDelta");

  // start action → pending → approve → running → readout → rollback
  const actionRec = recommendations.find((rec) => rec.sampleAdequate);
  assert.ok(actionRec, "need an actionable recommendation");
  const started = await startExperiment({ recommendationId: actionRec.id, mode: "start" });
  assert.equal(started.ok, true, "action experiment should start");
  assert.equal(started.experiment.status, "pending", "action experiment waits for approval");
  assert.ok(started.experiment.decisionId, "action experiment creates a decision");

  const pendingReadout = await readoutExperiment(started.experiment.id);
  assert.equal(pendingReadout.ok, false, "pending experiment cannot be read out");

  const approved = approveDecision(started.experiment.decisionId, { comment: "experiment check" });
  assert.equal(approved.ok, true, "decision should approve");

  const afterApprove = await getExperimentLibrary();
  const running = afterApprove.experiments.find((item) => item.id === started.experiment.id);
  assert.equal(running?.status, "running", "approved experiment becomes running");
  assert.ok(running?.operationId, "running experiment has operation");

  const concluded = await readoutExperiment(started.experiment.id);
  assert.equal(concluded.ok, true, "running readout");
  assert.equal(concluded.experiment.status, "concluded");

  const rolledBack = await rollbackExperiment(started.experiment.id);
  assert.equal(rolledBack.ok, true, "rollback");
  assert.equal(rolledBack.experiment.status, "reverted");
  assert.equal(rolledBack.experiment.operationUndone, true);

  // pending cancel
  const fresh = await getRecommendations({ limit: 10 });
  const pendingRec = fresh.recommendations.find((rec) => rec.sampleAdequate) ?? fresh.recommendations[0];
  const pendingExp = await startExperiment({ recommendationId: pendingRec.id, mode: "start" });
  assert.equal(pendingExp.ok, true);
  const cancelled = await stopExperiment(pendingExp.experiment.id, { rollback: false });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.experiment.status, "cancelled");

  // dismiss
  const beforeDismiss = await getRecommendations({ limit: 10 });
  const dismissRec = beforeDismiss.recommendations[0];
  assert.ok(dismissRec, "need a recommendation to dismiss");
  await dismissRecommendation(dismissRec.id);
  const afterDismiss = await getRecommendations({ limit: 10 });
  assert.ok(!afterDismiss.recommendations.some((rec) => rec.id === dismissRec.id), "dismissed rec should disappear");

  const library = await getExperimentLibrary();
  assert.ok(library.summary.total >= 3, "experiments persisted");
  assert.ok(["suggested", "pending", "running", "concluded"].every((key) => typeof library.summary[key] === "number"));
  assert.ok(library.note.includes("模拟"), "simulation note");

  console.log("summary:", library.summary);
  console.log("Experiment check passed");
} finally {
  if (backup !== null) {
    fs.writeFileSync(FILE, backup, "utf8");
  } else if (fs.existsSync(FILE)) {
    fs.unlinkSync(FILE);
  }
}
