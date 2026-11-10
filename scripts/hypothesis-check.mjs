import assert from "node:assert/strict";
import fs from "node:fs";
import { getHypothesisLibrary, replayHypothesis } from "../server/hypotheses.mjs";

function assertFinite(value, label) {
  assert.equal(typeof value, "number", `${label} should be a number`);
  assert.ok(Number.isFinite(value), `${label} should be finite, got ${value}`);
}

const library = await getHypothesisLibrary();
assert.equal(library.hypotheses.length, 3, "should expose 3 hypotheses");
assert.equal(library.summary.total, 3);
assert.ok(library.summary.trials >= 200, "should have replay samples");
assert.ok(library.caveat.includes("模拟"), "should label synthetic evidence");

for (const hypothesis of library.hypotheses) {
  assert.ok(hypothesis.observation.headline.length > 10, `${hypothesis.id} observation headline`);
  assert.ok(hypothesis.observation.metrics.length >= 4, `${hypothesis.id} observation metrics`);
  assert.ok(hypothesis.strategy.length >= 3, `${hypothesis.id} strategy rows`);
  assert.ok(hypothesis.test.risks.length >= 3, `${hypothesis.id} test risks`);
  assert.ok(hypothesis.productization.evalCases.length >= 3, `${hypothesis.id} eval cases`);
  assert.ok(hypothesis.trialCount > 0, `${hypothesis.id} trial count`);
}

for (const id of ["H1", "H2", "H3"]) {
  const result = await replayHypothesis(id);
  assert.equal(result.ok, true, `${id} replay should succeed`);
  const hypothesis = result.hypothesis;
  assert.ok(hypothesis, `${id} should return hypothesis`);
  const evidence = hypothesis.evidence;
  assert.ok(evidence, `${id} should have evidence`);
  assert.equal(evidence.synthetic, true, `${id} evidence must be marked synthetic`);
  assert.ok(evidence.sample.treatment > 0 && evidence.sample.control > 0, `${id} sample`);
  assert.ok(evidence.metrics.length >= 2, `${id} evidence metrics`);
  assert.ok(evidence.guardrails.length >= 1, `${id} guardrails`);
  assert.ok(evidence.summary.length > 20, `${id} summary`);
  assert.ok(!JSON.stringify(evidence).includes("null,\"unit\""), `${id} evidence should not contain empty unit`);
  assert.ok(!JSON.stringify(evidence).includes("NaN"), `${id} evidence should not contain NaN`);

  for (const metric of evidence.metrics) {
    assertFinite(metric.treatment, `${id}.${metric.key}.treatment`);
    assertFinite(metric.control, `${id}.${metric.key}.control`);
    assertFinite(metric.effect, `${id}.${metric.key}.effect`);
    if (metric.p !== null) assertFinite(metric.p, `${id}.${metric.key}.p`);
    if (metric.ci) {
      assertFinite(metric.ci[0], `${id}.${metric.key}.ci0`);
      assertFinite(metric.ci[1], `${id}.${metric.key}.ci1`);
      assert.ok(metric.ci[0] <= metric.ci[1], `${id}.${metric.key}.ci order`);
    }
  }
  for (const guardrail of evidence.guardrails) {
    assertFinite(guardrail.value, `${id}.${guardrail.label}.value`);
    assertFinite(guardrail.threshold, `${id}.${guardrail.label}.threshold`);
    assert.equal(typeof guardrail.pass, "boolean", `${id}.${guardrail.label}.pass`);
  }

  console.log(
    `${id}: ${evidence.verdictLabel} | ` +
      evidence.metrics
        .map((metric) => `${metric.label} ${metric.treatment.toFixed(1)}→${metric.control.toFixed(1)} (${metric.effect.toFixed(1)})`)
        .join(" | "),
  );
}

const h1 = (await replayHypothesis("H1")).hypothesis.evidence;
assert.ok(h1.metrics.find((metric) => metric.key === "roi").effect >= 0.2, "H1 ROI effect should be >= 0.2");
assert.equal(h1.guardrails[0].pass, true, "H1 GMV guardrail should pass");

const h2 = (await replayHypothesis("H2")).hypothesis.evidence;
assert.ok(h2.metrics.find((metric) => metric.key === "falsePause").effect <= -10, "H2 false pause effect should be negative");
assert.equal(h2.guardrails[0].pass, true, "H2 missed loss guardrail should pass");

const h3 = (await replayHypothesis("H3")).hypothesis.evidence;
assert.ok(h3.metrics.find((metric) => metric.key === "evidenceViewed").effect >= 20, "H3 evidence view lift should be >= 20pp");
assert.equal(h3.verdict, "inconclusive", "H3 should be inconclusive with the current sample");
assert.equal(h3.guardrails[0].pass, true, "H3 approval time guardrail should pass");

const persisted = JSON.parse(fs.readFileSync(".runtime/partner/hypotheses.json", "utf8"));
assert.ok(persisted.results.H1 && persisted.results.H2 && persisted.results.H3, "replay results should persist");

const libraryAfter = await getHypothesisLibrary();
assert.equal(libraryAfter.summary.validated, 2, "two hypotheses should be validated");
assert.equal(libraryAfter.summary.inconclusive, 1, "one hypothesis should need more samples");

console.log("Hypothesis check passed");
console.log("summary:", libraryAfter.summary);
