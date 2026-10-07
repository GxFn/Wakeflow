import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "../verification/files.js";
import { snapshotLabTree, type TreeEntry } from "./inventory.js";
import { observeSyntheticHook, type SyntheticHost } from "./synthetic-host.js";
import {
  assertLab,
  type LabWindow,
  previewApply,
  recordAt,
  revision,
  textAt,
  type WorkflowContext,
  windowByRole,
} from "./workflow-context.js";

const MODULE =
  "export function summarize(values) { return { count: values.length, total: values.reduce((sum, value) => sum + value, 0) }; }\n";
const SAMPLES = {
  Alpha: { values: [1, 2, 3], total: 6 },
  Beta: { values: [-2, 5, 8], total: 11 },
} as const;

export interface ProductEvidence {
  readonly product: LabWindow;
  readonly ref: string;
  readonly digest: string;
  readonly observed: string;
  readonly checkoutInventory: readonly TreeEntry[] | null;
}

function runArithmetic(context: WorkflowContext, product: LabWindow): string {
  context.signal?.throwIfAborted();
  const name = product.repositoryName;
  assertLab(name === "Alpha" || name === "Beta", "lab-product-unknown");
  assertLab(
    readFileSync(path.join(product.cwd, "summarize.mjs"), "utf8") === MODULE,
    "lab-product-bytes-changed",
  );
  const sample = SAMPLES[name];
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { summarize } from './summarize.mjs'; console.log(JSON.stringify(summarize(${JSON.stringify(sample.values)})));`,
    ],
    {
      cwd: product.cwd,
      env: {},
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 16 * 1024,
      shell: false,
    },
  );
  assertLab(
    !result.error && result.status === 0 && result.stderr === "",
    "lab-product-execution-failed",
  );
  const actual = recordAt(JSON.parse(result.stdout));
  assertLab(
    actual.count === sample.values.length && actual.total === sample.total,
    "lab-product-output-mismatch",
  );
  context.signal?.throwIfAborted();
  return (
    JSON.stringify({
      product: name,
      values: sample.values,
      count: actual.count,
      total: actual.total,
    }) + "\n"
  );
}

export function recheckProduct(context: WorkflowContext, evidence: ProductEvidence) {
  const bytes = runArithmetic(context, evidence.product);
  assertLab(
    bytes === evidence.observed &&
      sha256(readFileSync(path.join(evidence.product.cwd, "verification.json"))) ===
        evidence.digest,
    "lab-product-evidence-mismatch",
  );
}

async function recordProductEvidence(
  context: WorkflowContext,
  product: LabWindow,
): Promise<ProductEvidence> {
  const observed = runArithmetic(context, product);
  writeFileSync(path.join(product.cwd, "verification.json"), observed, { flag: "wx", mode: 0o600 });
  const checkoutInventory = product.branch === null ? null : snapshotLabTree(product.cwd);
  const recorded = await previewApply(context, "wakeflow_record_evidence", {
    demandId: context.demandId,
    selection: {
      kind: "test-output",
      source: {
        kind: "managed-path",
        root:
          product.branch === null
            ? { kind: "repository", repositoryId: product.repositoryId }
            : { kind: "pod-worktree", podId: context.podId, repositoryId: product.repositoryId },
        path: "verification.json",
        resourceType: "file",
      },
      contentReview: "reject",
    },
  });
  assertLab(recorded.disposition === "recorded", "lab-evidence-not-recorded");
  const evidenceId = textAt(recorded, "publication", "evidenceId");
  return {
    product,
    ref: `artifacts/managed-evidence/${evidenceId}/payload/content`,
    digest: sha256(observed),
    observed,
    checkoutInventory,
  };
}

export async function deliverLabTarget(
  context: WorkflowContext,
  host: SyntheticHost,
  targetId: string,
  window: LabWindow,
) {
  const prepared = await context.call("wakeflow_prepare_delivery", {
    root: context.root,
    demandId: context.demandId,
    targetTaskId: targetId,
    idempotencyKey: `lab-prepare-${targetId}`,
    expectedStreamRevision: await revision(context),
    authored: {
      goal: "Execute the immutable synthetic fixture task.",
      focus: ["Check the task package", "Use only the assigned disposable checkout"],
      boundary: "No real host send or real product data.",
    },
    language: "en",
  });
  assertLab(prepared.status === "committed", "lab-delivery-not-prepared");
  const permit = recordAt(prepared, "permit");
  observeSyntheticHook(context, host, window, "UserPromptSubmit", textAt(permit, "prompt"));
  const deliveryId = textAt(prepared, "delivery", "deliveryId");
  const claimDigest = textAt(permit, "fence", "claimDigest");
  const outcome = await context.call("wakeflow_record_delivery_outcome", {
    root: context.root,
    demandId: context.demandId,
    deliveryId,
    claimDigest,
    idempotencyKey: `lab-outcome-${targetId}`,
    expectedStreamRevision: await revision(context),
    attempt: { status: "sent" },
    readback: { status: "pending" },
    observedAt: new Date().toISOString(),
  });
  assertLab(
    recordAt(outcome, "outcome").disposition === "accepted",
    "lab-synthetic-delivery-not-landed",
  );
  return { deliveryId, claimDigest };
}

export async function importLabResult(
  context: WorkflowContext,
  host: SyntheticHost,
  targetId: string,
  window: LabWindow,
  permit: { deliveryId: string; claimDigest: string },
  report: Record<string, unknown>,
) {
  const imported = await context.call("wakeflow_import_target_result", {
    root: context.root,
    demandId: context.demandId,
    idempotencyKey: `lab-import-${targetId}`,
    expectedStreamRevision: await revision(context),
    ...permit,
    report,
  });
  assertLab(imported.status === "committed", "lab-result-not-imported");
  const controller = windowByRole(context, "controller");
  assertLab(
    textAt(imported, "callback", "permit", "hostAction", "windowId") === controller.id,
    "lab-callback-wrong-controller",
  );
  observeSyntheticHook(context, host, window, "Stop");
  observeSyntheticHook(
    context,
    host,
    controller,
    "UserPromptSubmit",
    textAt(imported, "callback", "permit", "prompt"),
  );
  const inspection = await context.call("wakeflow_inspect_target_result_review", {
    root: context.root,
    demandId: context.demandId,
    targetTaskId: targetId,
  });
  const unit = recordAt(inspection, "reviewUnit");
  assertLab(
    recordAt(unit, "targetCompletion").status === "confirmed" &&
      recordAt(unit, "callback").status === "landed",
    "lab-target-completion-unproven",
  );
  assertLab(
    Array.isArray(unit.allowedDecisions) && unit.allowedDecisions.includes("accept"),
    "lab-accept-not-allowed",
  );
  return {
    targetResultId: textAt(unit, "targetResult", "targetResultId"),
    snapshotDigest: textAt(inspection, "snapshotDigest"),
    reviewUnitDigest: textAt(unit, "reviewUnitDigest"),
  };
}

export function taskContext(context: WorkflowContext) {
  return {
    confirmedContext: ["Only the built-in disposable arithmetic fixture is authorized."],
    selectedAuthorityMemberRefs: context.members,
    boundaries: {
      inScope: ["Assigned synthetic checkout and arithmetic evidence"],
      outOfScope: ["Real products and native host sessions"],
      forbidden: ["Writing outside the lab"],
    },
    completionExpectations: ["Arithmetic output and evidence digest independently rechecked"],
    lineage: null,
  };
}

export function requirementRef(context: WorkflowContext, index: number) {
  return {
    recordDigest: context.recordDigest,
    sectionAnchor: "acceptance-criteria",
    itemId: `ac-${index + 1}`,
  };
}

export function independentCheck(observation: string) {
  return {
    checkId: "lab-independent-arithmetic",
    method: "Re-execute the fixed arithmetic sample and compare the recorded evidence bytes.",
    outcome: "passed",
    observation,
  };
}

export async function implementLabProduct(
  context: WorkflowContext,
  host: SyntheticHost,
  product: LabWindow,
  index: number,
): Promise<ProductEvidence> {
  const anchorId = `arithmetic-${index + 1}`;
  const planned = await context.call("wakeflow_plan_target_task", {
    root: context.root,
    demandId: context.demandId,
    idempotencyKey: `lab-plan-${product.id}`,
    expectedStreamRevision: await revision(context),
    taskPackage: {
      ...taskContext(context),
      workType: "implementation",
      assignment: { repositoryId: product.repositoryId, windowId: product.id },
      objective: "Implement summarize for the fixed arithmetic fixture.",
      commitExpectation: "leave-uncommitted",
      acceptanceAnchors: [
        {
          anchorId,
          claim: "Correct count and total",
          probe: "Run the built-in Node sample",
          expected: "Matches the independent expected count and total",
          requirementRef: requirementRef(context, index),
        },
      ],
      sectionAnchors: ["goal"],
    },
  });
  assertLab(planned.status === "committed", "lab-task-not-planned");
  const targetId = textAt(planned, "targetTask", "targetTaskId");
  const permit = await deliverLabTarget(context, host, targetId, product);
  writeFileSync(path.join(product.cwd, "summarize.mjs"), MODULE, { flag: "wx", mode: 0o600 });
  const evidence = await recordProductEvidence(context, product);
  const locator = { ref: evidence.ref, digest: evidence.digest };
  const inspection = await importLabResult(context, host, targetId, product, permit, {
    workType: "implementation",
    content: {
      outcome: "completed",
      summary: "Synthetic arithmetic implementation executed successfully.",
      repositoryChange: {
        repositoryId: product.repositoryId,
        disposition: "left-uncommitted",
        branch: product.branch,
        commits: [],
      },
      evidenceLocators: [{ kind: "test-output", ...locator }],
      verification: ["Node executed the fixed arithmetic sample."],
      risks: ["Synthetic host observations do not prove native host operation."],
      anchorEvidence: [{ anchorId, evidenceRefs: [locator] }],
    },
  });
  recheckProduct(context, evidence);
  const decided = await context.call("wakeflow_record_implementation_review_decision", {
    root: context.root,
    demandId: context.demandId,
    idempotencyKey: `lab-accept-${targetId}`,
    expectedStreamRevision: await revision(context),
    ...inspection,
    decision: "accept",
    assessment: { requirementAlignment: "aligned", implementationQuality: "satisfactory" },
    independentChecks: [independentCheck(evidence.observed.trim())],
    rationale:
      "The fixed synthetic task was independently re-executed and its evidence digest matched.",
    blockingReasons: [],
    residualRisks: ["This is a fixture protocol test, not real product acceptance."],
  });
  assertLab(
    decided.status === "committed" && recordAt(decided, "target").phase === "accepted",
    "lab-implementation-not-accepted",
  );
  context.acts.push(`implementation-${product.repositoryName}-accepted`);
  return evidence;
}
