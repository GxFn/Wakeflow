#!/usr/bin/env node

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addTask, initDemand, prepareDelivery, review, submitResult } from "../lib/wakeflow-state.mjs";

const root = mkdtempSync(path.join(tmpdir(), "wakeflow-smoke-"));
const demand = initDemand({
  root,
  demandKey: "smoke",
  title: "Smoke",
  goal: "Check Wakeflow local state loop.",
  completionDefinition: "Review reaches review-ready after a target result.",
  write: true,
});
addTask({
  root,
  stateRoot: demand.stateRoot,
  taskId: "SMOKE-T1",
  targetWindow: "Target",
  summary: "Check delivery intent generation.",
  write: true,
});
const delivery = prepareDelivery({
  root,
  stateRoot: demand.stateRoot,
  taskId: "SMOKE-T1",
  dispatchGroup: "SMOKE-G1",
  write: true,
});
if (!delivery.intent.prompt.includes("Continue current window task: Target / SMOKE-T1")) {
  throw new Error("delivery prompt did not include the target task header");
}
submitResult({
  root,
  stateRoot: demand.stateRoot,
  taskId: "SMOKE-T1",
  targetWindow: "Target",
  status: "completed",
  summary: "Smoke result.",
  evidenceRefs: ["smoke:evidence"],
  write: true,
});
const reviewed = review({ root, stateRoot: demand.stateRoot });
if (reviewed.decision !== "review-ready") {
  throw new Error(`expected review-ready, got ${reviewed.decision}`);
}
console.log(JSON.stringify({ ok: true, root, decision: reviewed.decision }, null, 2));
