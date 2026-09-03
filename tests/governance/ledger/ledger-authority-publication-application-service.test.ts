import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import {
  createDirectoryAtomically,
} from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  createDirectoryTreeCandidateDurably,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  LedgerAuthorityPublicationApplicationService,
  LedgerAuthorityPublicationApplicationServiceError,
} from "../../../src/governance/ledger/ledger-authority-publication-application-service.js";
import { materializeLedgerAuthorityPublicationPayload } from "../../../src/governance/ledger/ledger-authority-publication-payload-materializer.js";
import { LedgerAuthorityPublicationPlanningService } from "../../../src/governance/ledger/ledger-authority-publication-planning-service.js";
import { renderLedgerAuthorityRecord } from "../../../src/governance/ledger/ledger-authority-record.js";
import { renderLedgerRecordPublicationIntent } from "../../../src/governance/ledger/ledger-record-publication-intent.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  confirmationPublicationInput,
  createLedgerAuthorityPublicationFixture,
  ledgerAuthorityPublicationContents,
  ledgerAuthorityPublicationUuidFactory,
  requirementPublicationInput,
  CONFIRMATION_UUID,
  DEMAND_UUID,
  RECORDED_AT,
  REQUIREMENT_DESIGN_PATH,
  REQUIREMENT_UUID,
} from "./ledger-authority-publication.fixture.js";

const CANDIDATE_OPTIONS = {
  directoryMode: 0o755,
  maximumDepth: 64,
  maximumEntries: 256,
  maximumFileBytes: 4 * 1024 * 1024,
  maximumFiles: 33,
  maximumTotalBytes: 16 * 1024 * 1024,
} as const;

type PlanningPreview = Awaited<ReturnType<
  LedgerAuthorityPublicationPlanningService["previewRequirement"]
>>;

async function requirementPreview(
  fixture: Awaited<ReturnType<typeof createLedgerAuthorityPublicationFixture>>,
): Promise<PlanningPreview> {
  return new LedgerAuthorityPublicationPlanningService(
    fixture.workspaceRoot,
  ).previewRequirement(requirementPublicationInput(), {
    uuidFactory: ledgerAuthorityPublicationUuidFactory(
      [REQUIREMENT_UUID],
      { value: 0 },
    ),
    clock: () => RECORDED_AT,
  });
}

async function confirmationPreview(
  fixture: Awaited<ReturnType<typeof createLedgerAuthorityPublicationFixture>>,
) {
  return new LedgerAuthorityPublicationPlanningService(
    fixture.workspaceRoot,
  ).previewConfirmation(confirmationPublicationInput(), {
    uuidFactory: ledgerAuthorityPublicationUuidFactory(
      [CONFIRMATION_UUID, DEMAND_UUID],
      { value: 0 },
    ),
    clock: () => RECORDED_AT,
  });
}

function physicalPath(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

function writeIntent(
  ledgerPath: string,
  plan: PlanningPreview["plan"],
): void {
  const target = physicalPath(ledgerPath, plan.intent.intentRef);
  writeFileSync(target, renderLedgerRecordPublicationIntent(plan.intent), {
    mode: 0o600,
  });
  chmodSync(target, 0o600);
}

async function createStage(
  fixture: Awaited<ReturnType<typeof createLedgerAuthorityPublicationFixture>>,
  preview: PlanningPreview,
  complete: boolean,
): Promise<void> {
  const payload = await materializeLedgerAuthorityPublicationPayload(
    fixture.workspaceRoot,
    preview.plan,
  );
  writeIntent(fixture.ledgerPath, preview.plan);
  const ledgerRoot = await RootedDirectory.open(fixture.ledgerPath);
  try {
    if (complete) {
      await createDirectoryTreeCandidateDurably(
        ledgerRoot,
        preview.plan.intent.stageRef,
        [{
          path: "record.json",
          bytes: encodeUtf8(
            renderLedgerAuthorityRecord(preview.plan.intent.record),
          ),
          mode: 0o644,
        }, ...payload.map((member) => ({
          path: member.path,
          bytes: member.bytes,
          mode: 0o644,
        }))].sort((left, right) => (
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0
        )),
        CANDIDATE_OPTIONS,
      );
      return;
    }
    await createDirectoryAtomically(
      ledgerRoot,
      parsePortableResourcePath(preview.plan.intent.stageRef),
      { mode: 0o755 },
    );
    await createFileCandidateDurably(
      ledgerRoot,
      parsePortableResourcePath(
        `${preview.plan.intent.stageRef}/record.json`,
      ),
      encodeUtf8(renderLedgerAuthorityRecord(preview.plan.intent.record)),
      { mode: 0o644 },
    );
  } finally {
    await ledgerRoot.close();
  }
}

function expectApplicationError(
  reason: LedgerAuthorityPublicationApplicationServiceError["reason"],
  authority: LedgerAuthorityPublicationApplicationServiceError[
    "publicationAuthority"
  ],
) {
  return (error: unknown) =>
    error instanceof LedgerAuthorityPublicationApplicationServiceError
    && error.reason === reason
    && error.publicationAuthority === authority;
}

test("Ledger authority Application owns exact apply and forward recovery", async (t) => {
  await t.test("Apply publishes once and returns current on exact retry", async () => {
    const fixture = await createLedgerAuthorityPublicationFixture();
    try {
      const preview = await requirementPreview(fixture);
      const service = new LedgerAuthorityPublicationApplicationService(
        fixture.workspaceRoot,
      );
      const published = await service.apply(preview.plan, preview.planDigest);
      equal(published.operation, "apply");
      equal(published.disposition, "published");
      equal(published.wroteAuthority, true);
      equal(published.planDigest, preview.planDigest);
      equal(published.memberReferences.length, 2);
      equal(
        published.memberReferences[0]?.memberPath,
        "authority/original-plan.md",
      );
      equal(
        existsSync(
          physicalPath(fixture.ledgerPath, preview.plan.intent.finalRootRef),
        ),
        true,
      );
      deepEqual(ledgerAuthorityPublicationContents(fixture).transactions, []);

      const current = await service.apply(preview.plan, preview.planDigest);
      equal(current.disposition, "current");
      equal(current.wroteAuthority, false);
      equal(current.loaded.recordDigest, published.loaded.recordDigest);
    } finally {
      await cleanupLedgerAuthorityPublicationFixture(fixture);
    }
  });

  await t.test("Confirmation checks future Demand only before first write", async () => {
    const fixture = await createLedgerAuthorityPublicationFixture();
    try {
      const preview = await confirmationPreview(fixture);
      const service = new LedgerAuthorityPublicationApplicationService(
        fixture.workspaceRoot,
      );
      const futureDemandPath = physicalPath(
        fixture.workspacePath,
        demandFinalRootRef(`demand_${DEMAND_UUID}`),
      );
      mkdirSync(futureDemandPath, { recursive: true, mode: 0o700 });
      await rejects(
        service.apply(preview.plan, preview.planDigest),
        expectApplicationError("conflict", "unchanged"),
      );
      deepEqual(ledgerAuthorityPublicationContents(fixture).confirmations, []);
      rmSync(path.join(fixture.workspacePath, ".wakeflow-active"), {
        recursive: true,
        force: true,
      });

      const published = await service.apply(preview.plan, preview.planDigest);
      equal(published.disposition, "published");
      equal(published.loaded.record.artifactKind, "wakeflow-confirmation-record");
    } finally {
      await cleanupLedgerAuthorityPublicationFixture(fixture);
    }
  });

  await t.test("Recover completes an exact stage without Design source", async () => {
    const fixture = await createLedgerAuthorityPublicationFixture();
    try {
      const preview = await requirementPreview(fixture);
      await createStage(fixture, preview, true);
      rmSync(path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH));
      const service = new LedgerAuthorityPublicationApplicationService(
        fixture.workspaceRoot,
      );
      const recovered = await service.recover(
        preview.plan,
        preview.planDigest,
      );
      equal(recovered.operation, "recover");
      equal(recovered.disposition, "recovered");
      equal(recovered.wroteAuthority, true);
      equal(
        existsSync(
          physicalPath(fixture.ledgerPath, preview.plan.intent.stageRef),
        ),
        false,
      );
      const current = await service.recover(
        preview.plan,
        preview.planDigest,
      );
      equal(current.disposition, "current");
      equal(current.wroteAuthority, false);
    } finally {
      await cleanupLedgerAuthorityPublicationFixture(fixture);
    }
  });

  await t.test("partial stage requires input, then Apply resumes it", async () => {
    const fixture = await createLedgerAuthorityPublicationFixture();
    try {
      const preview = await requirementPreview(fixture);
      await createStage(fixture, preview, false);
      const service = new LedgerAuthorityPublicationApplicationService(
        fixture.workspaceRoot,
      );
      await rejects(
        service.recover(preview.plan, preview.planDigest),
        expectApplicationError("input-required", "recoverable"),
      );
      equal(
        existsSync(
          physicalPath(fixture.ledgerPath, preview.plan.intent.stageRef),
        ),
        true,
      );
      const resumed = await service.apply(preview.plan, preview.planDigest);
      equal(resumed.disposition, "recovered");
      equal(resumed.wroteAuthority, true);
      deepEqual(ledgerAuthorityPublicationContents(fixture).transactions, []);
    } finally {
      await cleanupLedgerAuthorityPublicationFixture(fixture);
    }
  });

  await t.test("invalid digest and stale Config remain unchanged", async () => {
    const fixture = await createLedgerAuthorityPublicationFixture();
    try {
      const preview = await requirementPreview(fixture);
      const service = new LedgerAuthorityPublicationApplicationService(
        fixture.workspaceRoot,
      );
      await rejects(
        service.apply(
          preview.plan,
          `sha256:${"f".repeat(64)}`,
        ),
        expectApplicationError("plan", "unchanged"),
      );
      const changedConfig = createMinimalWakeflowConfigV3();
      (changedConfig.presentation as Record<string, unknown>).language =
        "zh-Hans";
      writeFileSync(
        path.join(fixture.workspacePath, "wakeflow.config.json"),
        renderWakeflowConfigV3(parseWakeflowConfigV3(changedConfig)),
        { mode: 0o644 },
      );
      await rejects(
        service.recover(preview.plan, preview.planDigest),
        expectApplicationError("config", "unchanged"),
      );
      deepEqual(ledgerAuthorityPublicationContents(fixture), {
        requirements: [],
        confirmations: [],
        transactions: [],
      });
    } finally {
      await cleanupLedgerAuthorityPublicationFixture(fixture);
    }
  });

  await t.test("Recover distinguishes absent operation from orphan stage", async () => {
    const fixture = await createLedgerAuthorityPublicationFixture();
    try {
      const preview = await requirementPreview(fixture);
      const service = new LedgerAuthorityPublicationApplicationService(
        fixture.workspaceRoot,
      );
      await rejects(
        service.recover(preview.plan, preview.planDigest),
        expectApplicationError("not-found", "unchanged"),
      );
      const ledgerRoot = await RootedDirectory.open(fixture.ledgerPath);
      try {
        await createDirectoryAtomically(
          ledgerRoot,
          parsePortableResourcePath(preview.plan.intent.stageRef),
          { mode: 0o755 },
        );
      } finally {
        await ledgerRoot.close();
      }
      await rejects(
        service.recover(preview.plan, preview.planDigest),
        expectApplicationError("recovery-required", "unknown"),
      );
      equal(
        existsSync(
          physicalPath(fixture.ledgerPath, preview.plan.intent.stageRef),
        ),
        true,
      );
    } finally {
      await cleanupLedgerAuthorityPublicationFixture(fixture);
    }
  });
});
