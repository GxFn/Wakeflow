import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { MANAGED_EVIDENCE_RECORD_EVENT_OCCUPANCY } from "../../../src/capabilities/evidence/decide.js";
import { executeRecordEvidenceRequest } from "../../../src/capabilities/evidence/service.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { readStableRootResourceTree } from "../../../src/foundation/filesystem/stable-resource-tree-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { MANAGED_EVIDENCE_PAYLOAD_LIMITS } from "../../../src/governance/evidence/managed-evidence-manifest.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { WAKEFLOW_DEMAND_TREE_CAPACITY } from "../../../src/kernel/limits.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_REPOSITORY_ID,
  type ManagedEvidenceCapturePlanningWorkspaceFixture,
} from "../../governance/evidence/managed-evidence-capture-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";

useDisposableDurability();

/**
 * 2 级（能力）、负载敏感的那一半：累计容量阻塞（open-items W10）需要一棵恰到单条记录文件上限（4095 个文件）
 * 的来源树被零写捕获两次，占机器约二十秒；快的用例留在 service.test.ts。
 */

const CLOCK = { clock: () => EVIDENCE_CAPTURED_AT };

const DEMAND_TREE_CAPACITY = {
  maximumEntries: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumEntries,
  maximumDepth: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumDepth,
  maximumFiles: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFiles,
  maximumFileBytes: parseByteCount(WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFileBytes),
  maximumTotalBytes: parseByteCount(WAKEFLOW_DEMAND_TREE_CAPACITY.maximumTotalBytes),
};

function request(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  body: Readonly<Record<string, unknown>>,
) {
  return { root: fixture.publication.workspacePath, demandId: fixture.demandId, ...body };
}

async function preview(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  selection: unknown,
) {
  const result = await executeRecordEvidenceRequest(
    request(fixture, { mode: "preview", selection }),
    CLOCK,
  );
  if (result.kind !== "WakeflowRecordEvidencePreview") throw new Error("Expected a preview.");
  return result;
}

async function demandFileCount(fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>) {
  const demandRoot = await RootedDirectory.open(
    path.join(
      fixture.publication.workspacePath,
      ...demandFinalRootRef(fixture.demandId).split("/"),
    ),
  );
  try {
    return (await readStableRootResourceTree(demandRoot, DEMAND_TREE_CAPACITY)).files.length;
  } finally {
    await demandRoot.close();
  }
}

test("累计容量（open-items W10）：恰到单条记录文件上限的目录树连同 Demand 根既有文件超出归档的文件总数，preview 以 demand-capacity:file-count 阻塞、apply 以 plan-blocked 拒绝；按既有文件与事件追加裁掉来源后恰好填满，preview 就绪", async (t) => {
  if (loadSensitive(t, "a 4095-file source tree captured twice")) return;
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    // Demand 根是封闭清单（tree-shape），只能靠记录本身逼近容量：单条记录最多 4095 个文件，归档整树最多 4096 个。
    const sourceFiles = MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFiles;
    const sourceFile = (index: number) =>
      path.join(fixture.repositoryRoot, "artifacts", "flat", `d${index % 64}`, `f${index}`);
    for (let index = 0; index < sourceFiles; index += 1) {
      mkdirSync(path.dirname(sourceFile(index)), { recursive: true, mode: 0o755 });
      writeFileSync(sourceFile(index), "ok\n", { mode: 0o644 });
    }
    const selection = {
      kind: "test-output",
      source: {
        kind: "managed-path",
        root: { kind: "repository", repositoryId: EVIDENCE_REPOSITORY_ID },
        path: "artifacts/flat",
        resourceType: "tree",
      },
      contentReview: "reject",
    };
    const blocked = await preview(fixture, selection);
    equal(blocked.status, "blocked");
    deepEqual(blocked.blockers, ["demand-capacity:file-count"]);
    equal(blocked.plan, null);
    equal(blocked.planDigest, null);
    deepEqual(blocked.next.blockers, blocked.blockers);
    await rejects(
      executeRecordEvidenceRequest(
        request(fixture, { mode: "apply", selection, planDigest: `sha256:${"0".repeat(64)}` }),
        CLOCK,
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "precondition-failed" &&
        error.reason === "plan-blocked",
    );
    // 记录新增清单一个文件，事件追加再新增 commit、index 与 snapshot：裁掉既有文件数与事件追加数后恰好 4096 个。
    const currentFiles = await demandFileCount(fixture);
    equal(currentFiles > 0, true);
    const trimmed = currentFiles + MANAGED_EVIDENCE_RECORD_EVENT_OCCUPANCY.files;
    for (let index = 0; index < trimmed; index += 1) rmSync(sourceFile(index));
    const ready = await preview(fixture, selection);
    equal(ready.status, "ready", ready.blockers.join(","));
    equal(ready.plan?.payload.fileCount, sourceFiles - trimmed);
    equal(
      currentFiles + 1 + (sourceFiles - trimmed) + MANAGED_EVIDENCE_RECORD_EVENT_OCCUPANCY.files,
      WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFiles,
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
