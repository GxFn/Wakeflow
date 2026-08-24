import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as delivery from "../core/scripts/lib/wakeflow-delivery-orchestration.mjs";
import * as review from "../core/scripts/lib/wakeflow-result-review-orchestration.mjs";
import * as transport from "../core/scripts/lib/wakeflow-transport-store.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("delivery uses the v3 transport, result-review, and target orchestration owners", () => {
  for (const name of [
    "planTargetDelivery",
    "applyTargetDeliveryPlan",
    "claimTargetDelivery",
    "recordTargetDeliveryOutcome",
    "rearmTargetDelivery",
  ]) assert.equal(typeof delivery[name], "function", name);
  for (const name of [
    "recordTargetResultFromTransport",
    "inspectDispatchGroupReview",
    "createDispatchGroupReviewCandidate",
    "decideDispatchGroupReviewCandidate",
    "planControllerReturnDelivery",
    "recordControllerReturnOutcome",
  ]) assert.equal(typeof review[name], "function", name);
  for (const name of [
    "publishDispatchGroup",
    "publishDispatchPacket",
    "publishDeliveryEnvelope",
    "appendDeliveryRun",
  ]) assert.equal(typeof transport[name], "function", name);
});

test("the normal MCP facade cannot dispatch the retired delivery CLI", () => {
  for (const root of ["core", "plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    assert.equal(existsSync(path.join(repositoryRoot, root, "scripts/wakeflow-delivery.mjs")), false);
  }
  for (const artifact of ["plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    const source = readFileSync(path.join(repositoryRoot, artifact, "lib/wakeflow-mcp-tools.mjs"), "utf8");
    assert.doesNotMatch(source, /script:\s*["']wakeflow-delivery["']/u, artifact);
    assert.match(source, /createWakeflowPublicV3DomainHandlers/u, artifact);
  }
});
