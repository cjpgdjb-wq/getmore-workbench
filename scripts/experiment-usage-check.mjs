import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clearExperimentEvents, getExperimentUsage, recordExperimentEvent } from "../server/experiment-events.mjs";

const FILE = path.join(process.cwd(), ".runtime", "partner", "experiment-events.json");
const backup = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : null;

try {
  clearExperimentEvents();
  recordExperimentEvent({ type: "view", count: 3, source: "drawer" });
  recordExperimentEvent({ type: "view", count: 2, source: "drawer" });
  recordExperimentEvent({ type: "start_action", experimentId: "exp_1", recommendationId: "rec_1", templateId: "learning_phase" });
  recordExperimentEvent({ type: "start_observe", experimentId: "exp_2", recommendationId: "rec_2", templateId: "low_roi_high_spend" });
  recordExperimentEvent({ type: "dismiss", recommendationId: "rec_3" });
  recordExperimentEvent({ type: "readout", experimentId: "exp_1", templateId: "learning_phase" });
  recordExperimentEvent({ type: "rollback", experimentId: "exp_1", templateId: "learning_phase" });
  recordExperimentEvent({ type: "cancel", experimentId: "exp_2", templateId: "low_roi_high_spend" });

  const usage = getExperimentUsage();
  assert.equal(usage.views, 2);
  assert.equal(usage.starts, 2);
  assert.equal(usage.actionStarts, 1);
  assert.equal(usage.observeStarts, 1);
  assert.equal(usage.dismisses, 1);
  assert.equal(usage.readouts, 1);
  assert.equal(usage.rollbacks, 1);
  assert.equal(usage.cancels, 1);
  assert.equal(usage.startsPerView, 1);
  assert.equal(usage.rollbackRate, 0.5);
  assert.equal(usage.byTemplate.learning_phase.starts, 1);
  assert.equal(usage.byTemplate.learning_phase.rollbacks, 1);
  assert.ok(usage.diagnosis.includes("回滚偏多"));
  assert.ok(usage.note.includes("本地"));

  console.log("usage:", {
    views: usage.views,
    starts: usage.starts,
    rollbacks: usage.rollbacks,
    startsPerView: usage.startsPerView,
    rollbackRate: usage.rollbackRate,
  });
  console.log("Experiment usage check passed");
} finally {
  if (backup !== null) {
    fs.writeFileSync(FILE, backup, "utf8");
  } else if (fs.existsSync(FILE)) {
    fs.unlinkSync(FILE);
  }
}
