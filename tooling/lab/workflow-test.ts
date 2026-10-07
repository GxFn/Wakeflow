import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "../verification/files.js";
import type { SyntheticHost } from "./synthetic-host.js";
import {
  assertLab,
  previewApply,
  readLabConfig,
  recordAt,
  revision,
  textAt,
  type WorkflowContext,
  windowByRole,
} from "./workflow-context.js";
import {
  deliverLabTarget,
  importLabResult,
  independentCheck,
  type ProductEvidence,
  recheckProduct,
  requirementRef,
  taskContext,
} from "./workflow-target.js";

export async function testLabProducts(
  context: WorkflowContext,
  host: SyntheticHost,
  products: readonly ProductEvidence[],
) {
  const window = windowByRole(context, "test");
  const steps = products.map((product, index) => ({
    given: `The accepted synthetic ${product.product.repositoryName} implementation`,
    when: "Execute the fixed Node arithmetic sample and compare its evidence bytes",
    // biome-ignore lint/suspicious/noThenProperty: Public Given/When/Then test contract.
    then: "Count and total match the independent expected values",
    requirementRef: requirementRef(context, index),
  }));
  const planned = await context.call("wakeflow_plan_target_task", {
    root: context.root,
    demandId: context.demandId,
    idempotencyKey: "lab-test-plan",
    expectedStreamRevision: await revision(context),
    taskPackage: {
      ...taskContext(context),
      workType: "test",
      objective: "Independently execute the accepted arithmetic fixtures.",
      testContract: {
        question: "Do all accepted fixture modules return the expected result?",
        objectBoundary: "Only this lab's assigned product checkouts",
        steps,
        allowedSkills: [],
        setupPolicy: "reuse-existing",
        maxAttempts: 1,
        stopConditions: ["Any result or evidence mismatch stops the fixture."],
      },
    },
  });
  assertLab(planned.status === "committed", "lab-test-not-planned");
  const targetId = textAt(planned, "targetTask", "targetTaskId");
  assertLab(textAt(planned, "targetTask", "windowId") === window.id, "lab-test-window-mismatch");
  const permit = await deliverLabTarget(context, host, targetId, window);
  const config = readLabConfig(context.root);
  const surface = config.topology.supportSurfaces.find((entry) => entry.capability === "test");
  assertLab(surface, "lab-test-surface-missing");
  const evidence = [];
  for (const product of products) {
    recheckProduct(context, product);
    const file = `lab-check-${product.product.repositoryName}.json`;
    const bytes =
      JSON.stringify({ phase: "independent-test", actual: JSON.parse(product.observed) }) + "\n";
    writeFileSync(path.join(window.cwd, file), bytes, { flag: "wx", mode: 0o600 });
    const recorded = await previewApply(context, "wakeflow_record_evidence", {
      demandId: context.demandId,
      selection: {
        kind: "test-output",
        source: {
          kind: "managed-path",
          root: { kind: "support-surface", surfaceId: surface.surfaceId },
          path: file,
          resourceType: "file",
        },
        contentReview: "reject",
      },
    });
    assertLab(recorded.disposition === "recorded", "lab-test-evidence-not-recorded");
    evidence.push({
      ref: `artifacts/managed-evidence/${textAt(recorded, "publication", "evidenceId")}/payload/content`,
      digest: sha256(bytes),
      file,
      observed: product.observed,
    });
  }
  const inspection = await importLabResult(context, host, targetId, window, permit, {
    workType: "test",
    content: {
      outcome: "completed",
      summary: "Every synthetic product was independently executed.",
      evidenceLocators: evidence.map(({ ref, digest }) => ({ kind: "test-output", ref, digest })),
      verification: ["Executed each approved arithmetic step and retained distinct Test evidence."],
      risks: ["Synthetic environment and synthetic host observations only."],
      steps: evidence.map(({ ref, digest, observed }, index) => ({
        stepId: `ts-${index + 1}`,
        observed: observed.trim(),
        evidence: { ref, digest },
        verdict: "pass",
      })),
    },
  });
  for (const [index, item] of evidence.entries()) {
    assertLab(
      sha256(readFileSync(path.join(window.cwd, item.file))) === item.digest,
      "lab-test-evidence-changed",
    );
    const product = products[index];
    assertLab(product, "lab-test-product-missing");
    recheckProduct(context, product);
  }
  const decision = await context.call("wakeflow_record_test_review_decision", {
    root: context.root,
    demandId: context.demandId,
    idempotencyKey: "lab-test-accept",
    expectedStreamRevision: await revision(context),
    ...inspection,
    decision: "accept",
    assessment: { conclusion: "satisfied", evidenceSufficiency: "sufficient" },
    independentChecks: [
      independentCheck(
        "All product samples and Test evidence digests matched on independent re-execution.",
      ),
    ],
    rationale: "The fixed test contract is satisfied within the synthetic lab.",
    blockingReasons: [],
    residualRisks: ["Native host and real product acceptance remain unverified."],
  });
  assertLab(
    decision.status === "committed" && recordAt(decision, "target").phase === "test-accepted",
    "lab-test-not-accepted",
  );
  context.acts.push("independent-test-contract-accepted");
}
