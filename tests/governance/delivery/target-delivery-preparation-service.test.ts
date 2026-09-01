import { equal, rejects } from "node:assert/strict";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  TargetDeliveryPreparationService,
  TargetDeliveryPreparationServiceError,
} from "../../../src/governance/delivery/target-delivery-preparation-service.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { taskPackageProjectionRef } from "../../../src/governance/tasking/task-package-projection-paths.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import { ControllerImplementationReviewDecisionService } from "../../../src/governance/review/controller-implementation-review-decision-service.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { TargetResultImportService } from "../../../src/governance/result/target-result-import-service.js";
import { controllerImplementationReviewDecisionInput } from "../review/controller-implementation-review-decision.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
} from "../review/controller-implementation-review-decision-service.fixture.js";
import {
  cleanupTargetDeliveryPreparationWorkspaceFixture,
  createTargetDeliveryPreparationWorkspaceFixture,
  deliveryUuidFactory,
  DELIVERY_PREPARED_AT,
} from "./target-delivery-preparation-service.fixture.js";
import { PLANNING_RECORDED_AT } from "../tasking/target-task-planning-service.fixture.js";

function service(root: RootedDirectory): TargetDeliveryPreparationService {
  return new TargetDeliveryPreparationService(
    root,
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
  );
}

async function aggregate(workspacePath: string, demandId: string) {
  const rootPath = path.join(
    workspacePath,
    ...demandFinalRootRef(demandId).split("/"),
  );
  const root = await RootedDirectory.open(rootPath);
  try {
    return (await new DemandEventSourcingRepository(root).audit()).aggregate;
  } finally {
    await root.close();
  }
}

async function auditHistory(workspacePath: string, demandId: string) {
  const rootPath = path.join(
    workspacePath,
    ...demandFinalRootRef(demandId).split("/"),
  );
  const root = await RootedDirectory.open(rootPath);
  try {
    return await new DemandEventSourcingRepository(
      root,
    ).auditTargetResultHistory();
  } finally {
    await root.close();
  }
}

async function reviewSnapshot(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return await readDemandResultReviewSnapshot(root);
  } finally {
    await root.close();
  }
}

function uuidSequence(values: readonly string[]): () => string {
  let index = 0;
  return () => values[index++] ?? "invalid";
}

function rewriteConfig(workspacePath: string): void {
  const value = createMinimalWakeflowConfigV3();
  const program = value.program as Record<string, unknown>;
  program.displayName = "Changed after Delivery preview";
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(parseWakeflowConfigV3(value)),
    { mode: 0o644 },
  );
}

test("Preparation在wall clock回拨时preview零写且exact Apply只追加Intent事件", async () => {
  const fixture = await createTargetDeliveryPreparationWorkspaceFixture();
  try {
    const preparation = service(fixture.workspaceRoot);
    const preview = await preparation.preview(
      {
        demandId: fixture.request.demandId,
        targetTaskId: fixture.targetTaskId,
      },
      {
        clock: () => DELIVERY_PREPARED_AT,
        uuidFactory: deliveryUuidFactory(),
      },
    );
    equal(preview.plan.intent.route.bindingId, fixture.bindingId);
    equal(preview.plan.intent.language, "en");
    equal(preview.plan.intent.preparedAt, DELIVERY_PREPARED_AT);
    equal(preview.plan.intent.preparedAt < PLANNING_RECORDED_AT, true);
    equal(JSON.stringify(preview).includes(fixture.rawHandle), false);
    equal(readdirSync(fixture.bindingRootPath).length, 1);
    equal(
      (await aggregate(fixture.workspacePath, fixture.request.demandId))
        .streamRevision,
      2,
    );

    const applied = await preparation.apply(preview.plan, preview.planDigest);
    equal(applied.disposition, "committed");
    equal(applied.commandResult.commit.events[0]?.eventVersion, 3);
    equal(applied.commandResult.aggregate.streamRevision, 3);
    equal(
      applied.commandResult.aggregate.state.targetTasks[0]?.phase,
      "delivery-prepared",
    );
    const replayed = await preparation.apply(preview.plan, preview.planDigest);
    equal(replayed.disposition, "idempotent");
    equal(replayed.commandResult.aggregate.streamRevision, 3);
    equal(readdirSync(fixture.bindingRootPath).length, 1);
  } finally {
    await cleanupTargetDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("Preparation Apply在提交前拒绝Config或Binding漂移", async () => {
  const configFixture = await createTargetDeliveryPreparationWorkspaceFixture();
  try {
    const preparation = service(configFixture.workspaceRoot);
    const preview = await preparation.preview(
      {
        demandId: configFixture.request.demandId,
        targetTaskId: configFixture.targetTaskId,
      },
      {
        clock: () => DELIVERY_PREPARED_AT,
        uuidFactory: deliveryUuidFactory(),
      },
    );
    rewriteConfig(configFixture.workspacePath);
    await rejects(
      preparation.apply(preview.plan, preview.planDigest),
      (error: unknown) =>
        error instanceof TargetDeliveryPreparationServiceError &&
        error.reason === "config" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      (
        await aggregate(
          configFixture.workspacePath,
          configFixture.request.demandId,
        )
      ).streamRevision,
      2,
    );
  } finally {
    await cleanupTargetDeliveryPreparationWorkspaceFixture(configFixture);
  }

  const bindingFixture =
    await createTargetDeliveryPreparationWorkspaceFixture();
  try {
    const preparation = service(bindingFixture.workspaceRoot);
    const preview = await preparation.preview(
      {
        demandId: bindingFixture.request.demandId,
        targetTaskId: bindingFixture.targetTaskId,
      },
      {
        clock: () => DELIVERY_PREPARED_AT,
        uuidFactory: deliveryUuidFactory(),
      },
    );
    const bindingFile = readdirSync(bindingFixture.bindingRootPath)[0];
    if (bindingFile === undefined) throw new Error("Expected Binding file.");
    rmSync(path.join(bindingFixture.bindingRootPath, bindingFile));
    await rejects(
      preparation.apply(preview.plan, preview.planDigest),
      (error: unknown) =>
        error instanceof TargetDeliveryPreparationServiceError &&
        error.reason === "binding" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      (
        await aggregate(
          bindingFixture.workspacePath,
          bindingFixture.request.demandId,
        )
      ).streamRevision,
      2,
    );
  } finally {
    await cleanupTargetDeliveryPreparationWorkspaceFixture(bindingFixture);
  }
});

test("并发Preparation Apply收敛为一个事件commit", async () => {
  const fixture = await createTargetDeliveryPreparationWorkspaceFixture();
  try {
    const preparation = service(fixture.workspaceRoot);
    const preview = await preparation.preview(
      {
        demandId: fixture.request.demandId,
        targetTaskId: fixture.targetTaskId,
      },
      {
        clock: () => DELIVERY_PREPARED_AT,
        uuidFactory: deliveryUuidFactory(),
      },
    );
    const settled = await Promise.allSettled([
      preparation.apply(preview.plan, preview.planDigest),
      preparation.apply(preview.plan, preview.planDigest),
    ]);
    equal(
      settled.some(
        (entry) =>
          entry.status === "fulfilled" &&
          entry.value.disposition === "committed",
      ),
      true,
    );
    for (const entry of settled) {
      if (entry.status === "fulfilled") continue;
      equal(
        entry.reason instanceof TargetDeliveryPreparationServiceError &&
          entry.reason.eventAuthority === "current",
        true,
      );
    }
    equal(
      (await preparation.apply(preview.plan, preview.planDigest)).disposition,
      "idempotent",
    );
    equal(
      (await aggregate(fixture.workspacePath, fixture.request.demandId))
        .streamRevision,
      3,
    );
  } finally {
    await cleanupTargetDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("已提交Preparation重试不依赖后来Config或TaskPackage投影", async () => {
  const fixture = await createTargetDeliveryPreparationWorkspaceFixture();
  try {
    const preparation = service(fixture.workspaceRoot);
    const preview = await preparation.preview(
      {
        demandId: fixture.request.demandId,
        targetTaskId: fixture.targetTaskId,
      },
      {
        clock: () => DELIVERY_PREPARED_AT,
        uuidFactory: deliveryUuidFactory(),
      },
    );
    await preparation.apply(preview.plan, preview.planDigest);
    rewriteConfig(fixture.workspacePath);
    const projectionPath = path.join(
      fixture.workspacePath,
      ...demandFinalRootRef(fixture.request.demandId).split("/"),
      ...taskPackageProjectionRef(fixture.taskPackageId).split("/"),
    );
    equal(existsSync(projectionPath), true);
    rmSync(projectionPath);
    const replayed = await preparation.apply(preview.plan, preview.planDigest);
    equal(replayed.disposition, "idempotent");
    equal(replayed.commandResult.aggregate.streamRevision, 3);
  } finally {
    await cleanupTargetDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("rework Decision驱动同一TaskPackage的新尝试并保留跨尝试Review历史", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const judgment = controllerImplementationReviewDecisionInput("rework");
    const decided = await new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(
      {
        ...fixture.decisionRequest,
        decision: judgment.decision,
        assessment: judgment.assessment,
        independentChecks: judgment.independentChecks,
        rationale: judgment.rationale,
        blockingReasons: judgment.blockingReasons,
        residualRisks: judgment.residualRisks,
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:15:00.000Z"),
        uuidFactory: () => "abababab-abab-4bab-8bab-abababababab",
      },
    );
    equal(decided.decision.decision, "rework");

    const preparation = service(fixture.workspaceRoot);
    await rejects(
      preparation.preview(
        {
          demandId: fixture.intent.demandId,
          targetTaskId: fixture.intent.target.targetTaskId,
        },
        {
          clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
          uuidFactory: uuidSequence([
            fixture.intent.targetDeliveryId.slice("target-delivery_".length),
            "adadadad-adad-4dad-8dad-adadadadadad",
            "aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae",
          ]),
        },
      ),
      (error: unknown) =>
        error instanceof TargetDeliveryPreparationServiceError &&
        error.reason === "identity",
    );
    const preview = await preparation.preview(
      {
        demandId: fixture.intent.demandId,
        targetTaskId: fixture.intent.target.targetTaskId,
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
        uuidFactory: uuidSequence([
          "acacacac-acac-4cac-8cac-acacacacacac",
          "adadadad-adad-4dad-8dad-adadadadadad",
          "aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae",
        ]),
      },
    );
    const rework = preview.plan.intent.rework;
    if (rework === undefined) throw new Error("Expected rework Intent.");
    equal(
      preview.plan.intent.target.taskPackageId,
      fixture.intent.target.taskPackageId,
    );
    equal(
      preview.plan.intent.target.taskPackageDigest,
      fixture.intent.target.taskPackageDigest,
    );
    equal(
      rework.decision.targetReviewDecisionId,
      decided.decision.targetReviewDecisionId,
    );
    equal(
      rework.previousResult.targetResultId,
      decided.decision.reviewed.targetResultId,
    );
    equal(rework.requiredCorrections[0].checkId, "controller-rework");
    equal(
      preview.plan.intent.targetDeliveryId === fixture.intent.targetDeliveryId,
      false,
    );

    const applied = await preparation.apply(preview.plan, preview.planDigest);
    equal(applied.commandResult.commit.events[0]?.eventVersion, 3);
    equal(applied.commandResult.aggregate.streamRevision, 8);
    equal(
      applied.commandResult.aggregate.state.targetTasks[0]?.phase,
      "delivery-prepared",
    );
    const history = await auditHistory(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    equal(history.taskPackages.length, 1);
    equal(history.targetResults.length, 1);
    equal(history.targetReviewDecisions.length, 1);
    equal(
      history.targetResults[0]?.result.targetResultId,
      decided.decision.reviewed.targetResultId,
    );
    const previousResult = history.targetResults[0]?.result;
    if (
      previousResult === undefined ||
      previousResult.workType !== "implementation"
    ) {
      throw new Error("Expected previous TargetResult history.");
    }
    const replayedPreviousResult = await new TargetResultImportService(
      fixture.workspaceRoot,
      "codex",
    ).import({
      demandId: previousResult.demandId,
      actionId: previousResult.hostEffect.actionId,
      observationDigest: previousResult.hostEffect.observationDigest,
      report: {
        workType: "implementation",
        content: {
          outcome: previousResult.report.outcome,
          summary: previousResult.report.summary,
          repositoryChange: previousResult.report.repositoryChange,
          evidenceLocators: previousResult.report.evidenceLocators,
          verification: previousResult.report.verification,
          risks: previousResult.report.risks,
          anchorEvidence: previousResult.report.anchorEvidence,
        },
      },
    });
    equal(replayedPreviousResult.status, "already-recorded");

    const observation = {
      ...fixture.claimRequest.observation,
      observedAt: parseUtcInstant("2026-08-29T12:16:30.000Z"),
    };
    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(
      {
        workType: "implementation",
        demandId: preview.plan.intent.demandId,
        targetTaskId: preview.plan.intent.target.targetTaskId,
        targetDeliveryId: preview.plan.intent.targetDeliveryId,
        intentDigest: preview.plan.intent.intentDigest,
        observation,
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:17:00.000Z"),
        uuidFactory: uuidSequence([
          "afafafaf-afaf-4faf-8faf-afafafafafaf",
          "b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0",
          "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1",
        ]),
      },
    );
    if (claimed.action === null) throw new Error("Expected rework Action.");
    equal(
      claimed.action.prompt.includes(
        "Rework basis (continue the same TaskPackage)",
      ),
      true,
    );
    equal(
      claimed.action.prompt.includes(decided.decision.targetReviewDecisionId),
      true,
    );
    equal(claimed.action.prompt.includes("controller-rework"), true);

    const secondOutcome = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record({
      demandId: preview.plan.intent.demandId,
      actionId: claimed.action.actionId,
      claimDigest: claimed.action.workClaim.claimDigest,
      attempt: {
        status: "accepted",
        evidence: { fixture: "rework-attempt" },
      },
      readback: {
        status: "pending",
        evidence: { visible: false },
      },
      observedAt: parseUtcInstant("2026-08-29T12:18:00.000Z"),
    });
    const secondResult = await new TargetResultImportService(
      fixture.workspaceRoot,
      "codex",
    ).import(
      {
        demandId: preview.plan.intent.demandId,
        actionId: claimed.action.actionId,
        observationDigest: secondOutcome.observation.observationDigest,
        report: {
          workType: "implementation",
          content: {
            outcome: previousResult.report.outcome,
            summary: previousResult.report.summary,
            repositoryChange: previousResult.report.repositoryChange,
            evidenceLocators: previousResult.report.evidenceLocators,
            verification: previousResult.report.verification,
            risks: previousResult.report.risks,
            anchorEvidence: previousResult.report.anchorEvidence,
          },
        },
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:19:00.000Z"),
      },
    );
    equal(
      secondResult.result.targetResultId === previousResult.targetResultId,
      false,
    );
    const snapshot = await reviewSnapshot(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    const reported = snapshot.targets[0];
    if (reported?.status !== "reported") {
      throw new Error("Expected second reported review target.");
    }
    equal(
      reported.targetResult.targetResultId,
      secondResult.result.targetResultId,
    );
    equal(reported.priorReviewHistory.length, 1);
    equal(reported.priorReviewHistory[0]?.kind, "decision");
    if (reported.priorReviewHistory[0]?.kind !== "decision") {
      throw new Error("Expected prior rework Decision history.");
    }
    equal(
      reported.priorReviewHistory[0].decision.targetReviewDecisionId,
      decided.decision.targetReviewDecisionId,
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});
