import assert from "node:assert/strict";
import { getRecommendations, startExperiment } from "../server/experiments.mjs";

const { recommendations } = await getRecommendations({ limit: 20 });
const blocked = recommendations.find(
  (item) => item.dataGapDetails?.some((gap) => gap.code === "net_unauthorized"),
);

assert.ok(blocked, "expected a recommendation with net_unauthorized gap");
assert.equal(blocked.canStart, false, "net unauthorized must block start");
assert.ok(String(blocked.startBlockReason).includes("商品交易"), "blocked reason should say 商品交易");
assert.equal(new Set(blocked.dataGaps).size, blocked.dataGaps.length, "dataGaps must be deduped");
assert.equal(
  blocked.dataGapDetails.filter((gap) => gap.code === "net_unauthorized").length,
  1,
  "net_unauthorized must appear once",
);
assert.equal(
  blocked.dataGapDetails.some((gap) => gap.code === "partial_auth"),
  false,
  "partial_auth should be folded into net_unauthorized when net is missing",
);

const attempted = await startExperiment({ recommendationId: blocked.id, mode: "start" });
assert.equal(attempted.ok, false, "startExperiment must reject blocked recommendation");
assert.ok(String(attempted.error).includes("商品交易"), "error should explain the missing data");

console.log(`blocked: ${blocked.title} | ${blocked.scopeLine}`);
console.log(`gaps: ${blocked.dataGapDetails.map((gap) => `${gap.severity}:${gap.label}`).join(" | ")}`);
console.log(`canStart: ${blocked.canStart}`);
console.log(`start error: ${attempted.error}`);
console.log("Data gap gate check passed");
