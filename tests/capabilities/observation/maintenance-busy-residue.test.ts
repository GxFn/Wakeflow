import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeStatusRequest } from "../../../src/capabilities/observation/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { withRootedExclusiveFileLock } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-resource-catalog.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "./observation-facade.fixture.js";

/**
 * 维护锁被活着的持有者占着（busy）时，transactions 里的条目属于正在进行的维护：status 照实列出，
 * 但不标可恢复，免得 Controller 对进行中的操作调 recover（§13.130 审查 P1-7）。锁放开后同一条目
 * 才是可恢复的残留。
 */

const CLOCK = { clock: () => parseUtcInstant("2026-09-25T12:00:00.000Z") };
const OPERATION_ID = "maintenance_operation_11111111-1111-4111-8111-111111111111";

async function initializedWorkspace(t: TestContext): Promise<string> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-busy-residue-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Workspace");
  mkdirSync(root);
  if (spawnSync("git", ["init", "--quiet"], { cwd: root, shell: false }).status !== 0) {
    throw new Error("git init failed");
  }
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const preview = await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready Fresh plan.");
  }
  await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection },
    planDigest: preview.planDigest,
  });
  return root;
}

async function residuesOf(root: string) {
  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
  return {
    protocol: status.maintenance.protocol,
    residues: status.maintenance.residues.map((residue) => ({ ...residue })),
  };
}

test("维护进行中的条目不标可恢复，锁放开后才是可恢复的残留（§13.130）", async (t) => {
  const root = await initializedWorkspace(t);
  const transactions = path.join(root, ...WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF.split("/"));
  mkdirSync(transactions, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(transactions, `${OPERATION_ID}.intent.json`), "{}\n", { mode: 0o600 });
  const expected = (recoverable: boolean) => [
    { name: `${OPERATION_ID}.intent.json`, kind: "intent", operationId: OPERATION_ID, recoverable },
  ];

  const rooted = await RootedDirectory.open(root);
  let enter: (() => void) | undefined;
  let release: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = withRootedExclusiveFileLock(rooted, WAKEFLOW_MAINTENANCE_GATE_REF, async () => {
    enter?.();
    await released;
  });
  await entered;
  try {
    deepEqual(await residuesOf(root), { protocol: "busy", residues: expected(false) });
  } finally {
    release?.();
    await holder;
    await rooted.close();
  }
  const after = await residuesOf(root);
  equal(after.protocol, "recovery-required");
  deepEqual(after.residues, expected(true));
});
