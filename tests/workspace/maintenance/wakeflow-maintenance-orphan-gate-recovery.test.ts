import { equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import {
  withRootedExclusiveFileLock,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  recoverWakeflowMaintenanceOrphanGate,
  WakeflowMaintenanceOrphanGateRecoveryError,
  type WakeflowMaintenanceOrphanGateRecoveryErrorReason,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-orphan-gate-recovery.js";
import {
  wakeflowMaintenanceJournalRef,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-resource-catalog.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = `maintenance_operation_${UUID}`;

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-orphan-maintenance-gate-",
  )));
  mkdirSync(path.join(absolutePath, ".wakeflow-local", "runtime"), {
    mode: 0o700,
    recursive: true,
  });
  chmodSync(path.join(absolutePath, ".wakeflow-local"), 0o700);
  chmodSync(path.join(absolutePath, ".wakeflow-local", "runtime"), 0o700);
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function gatePath(root: string): string {
  return path.join(root, ...WAKEFLOW_MAINTENANCE_GATE_REF.split("/"));
}

function writeInactiveGate(root: string, uuid = UUID): void {
  writeFileSync(gatePath(root), rootedExclusiveFileLockRecordTextForTest({
    tokenUuid: uuid,
  }), { mode: 0o600 });
}

async function expectRecoveryError(
  action: () => Promise<unknown>,
  reason: WakeflowMaintenanceOrphanGateRecoveryErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceOrphanGateRecoveryError, true);
  if (caught instanceof WakeflowMaintenanceOrphanGateRecoveryError) {
    equal(caught.code, "wakeflow-maintenance-orphan-gate-recovery");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("orphan gate recovery correlates operation and completes empty bootstrap", async (t) => {
  const workspace = await fixture(t);
  writeInactiveGate(workspace.absolutePath);
  const recovered = await recoverWakeflowMaintenanceOrphanGate(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.operationId, OPERATION_ID);
  equal(/^sha256:[0-9a-f]{64}$/u.test(recovered.retiredLockDigest), true);
  equal(existsSync(gatePath(workspace.absolutePath)), false);
  equal(existsSync(path.join(
    workspace.absolutePath,
    ".wakeflow-local/runtime/maintenance/transactions",
  )), true);
});

test("orphan gate recovery preserves mismatched, journaled or active gates", async (t) => {
  const mismatched = await fixture(t);
  writeInactiveGate(mismatched.absolutePath, OTHER_UUID);
  await expectRecoveryError(
    () => recoverWakeflowMaintenanceOrphanGate(
      mismatched.root,
      OPERATION_ID,
    ),
    "operation-mismatch",
    "$operationId",
  );
  equal(existsSync(gatePath(mismatched.absolutePath)), true);

  const journaled = await fixture(t);
  mkdirSync(path.join(
    journaled.absolutePath,
    ".wakeflow-local/runtime/maintenance/transactions",
  ), { mode: 0o700, recursive: true });
  writeInactiveGate(journaled.absolutePath);
  const journalRef = wakeflowMaintenanceJournalRef(OPERATION_ID);
  writeFileSync(
    path.join(journaled.absolutePath, ...journalRef.split("/")),
    "{}\n",
    { mode: 0o600 },
  );
  await expectRecoveryError(
    () => recoverWakeflowMaintenanceOrphanGate(journaled.root, OPERATION_ID),
    "journal-present",
    "$journal",
  );
  equal(existsSync(gatePath(journaled.absolutePath)), true);

  const active = await fixture(t);
  await withRootedExclusiveFileLock(
    active.root,
    WAKEFLOW_MAINTENANCE_GATE_REF,
    async () => {
      await expectRecoveryError(
        () => recoverWakeflowMaintenanceOrphanGate(active.root, OPERATION_ID),
        "owner-active-or-unknown",
        "$gate",
      );
    },
    { tokenUuidFactory: () => UUID },
  );
});
