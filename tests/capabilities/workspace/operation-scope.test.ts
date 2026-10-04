import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { readWakeflowConfigAuthoritySnapshot } from "../../../src/configuration/wakeflow-config-authority-snapshot.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { refreshActiveProjection } from "../../../src/governance/observation/active-projection-refresh.js";
import { withWorkspaceOperationScope } from "../../../src/kernel/workspace-operation-scope.js";
import {
  WORKSPACE_OPERATION_SCOPES_REF,
  WORKSPACE_MAINTENANCE_TRANSACTIONS_REF,
} from "../../../src/kernel/layout.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";

async function prepareFixture(signal: AbortSignal) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-operation-scope-")));
  try {
    const root = path.join(base, "Workspace");
    mkdirSync(root);
    equal(spawnSync("git", ["init", "--quiet"], { cwd: root }).status, 0);
    const selection = createMinimalWakeflowFreshConfigSelection();
    (selection.storage as { ledgerRoot: string }).ledgerRoot = "Ledger";
    const request = { root, action: "fresh-initialize", mode: "preview", request: { selection } };
    const preview = await executeCodexWakeflowMaintenance(request, { signal });
    if (preview.mode !== "preview" || preview.planDigest === null)
      throw new Error("Expected fresh preview.");
    await executeCodexWakeflowMaintenance(
      {
        ...request,
        mode: "apply",
        planDigest: preview.planDigest,
      },
      { signal },
    );
    const rooted = await RootedDirectory.open(root);
    return { base, root, rooted, config: path.join(root, "wakeflow.config.json") };
  } catch (error: unknown) {
    rmSync(base, { recursive: true, force: true });
    throw error;
  }
}

const prepared: Awaited<ReturnType<typeof prepareFixture>>[] = [];
let fixtureIndex = 0;
// Bound expensive, durable setup separately; operation deadlines and real fsync remain intact.
before(
  async (context) => {
    for (let i = 0; i < 3; i += 1) prepared.push(await prepareFixture(context.signal));
  },
  { timeout: 60_000 },
);
after(async () => {
  for (const fixture of prepared) {
    await fixture.rooted.close();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
function fixture() {
  const value = prepared[fixtureIndex++];
  if (value === undefined) throw new Error("Missing isolated scope fixture.");
  return value;
}

async function until(predicate: () => boolean): Promise<void> {
  const end = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() > end) throw new Error("Checkpoint timed out.");
    await delay(10);
  }
}

test("maintenance waits for an in-flight projection before activating a new config", {
  timeout: 20000,
}, async (t) => {
  const f = fixture();
  const old = await readWakeflowConfigAuthoritySnapshot(f.rooted);
  const paused = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = RootedDirectory.open;
  let intercepted = false;
  t.mock.method(RootedDirectory, "open", async function (...args: Parameters<typeof original>) {
    const opened = await original.apply(RootedDirectory, args);
    if (!intercepted && args[0] === old.ledgerRoot) {
      intercepted = true;
      paused.resolve();
      await release.promise;
    }
    return opened;
  });
  const refresh = refreshActiveProjection(f.rooted);
  let mutation: Promise<unknown> | undefined;
  try {
    await paused.promise;
    const desired = JSON.parse(readFileSync(f.config, "utf8")) as {
      program: { displayName: string };
    };
    desired.program.displayName = "After the scope boundary";
    const request = {
      root: f.root,
      action: "reconfigure",
      mode: "preview",
      request: { desiredConfig: desired },
    };
    const preview = await executeCodexWakeflowMaintenance(request);
    if (preview.mode !== "preview" || preview.planDigest === null)
      throw new Error("Expected reconfigure preview.");
    mutation = executeCodexWakeflowMaintenance({
      ...request,
      mode: "apply",
      planDigest: preview.planDigest,
    });
    await Promise.race([
      until(() => existsSync(path.join(f.root, WORKSPACE_OPERATION_SCOPES_REF, "writer.lock"))),
      mutation.then(() => {
        throw new Error("Maintenance bypassed the reader.");
      }),
    ]);
    equal((await readWakeflowConfigAuthoritySnapshot(f.rooted)).configDigest, old.configDigest);
    release.resolve();
    await Promise.all([refresh, mutation]);
    const current = await readWakeflowConfigAuthoritySnapshot(f.rooted);
    const projected = readFileSync(
      path.join(f.root, ".wakeflow-active/current/workspace-current-status.md"),
      "utf8",
    );
    equal(projected.includes(current.configDigest), true);
    equal(projected.includes(old.configDigest), false);
  } finally {
    release.resolve();
    await Promise.allSettled([refresh, ...(mutation === undefined ? [] : [mutation])]);
  }
});

test("unsupported config cannot enter a writer scope or be silently upgraded", {
  timeout: 20000,
}, async () => {
  const f = fixture();
  const desired = JSON.parse(readFileSync(f.config, "utf8")) as Record<string, unknown>;
  await rejects(
    executeCodexWakeflowMaintenance({
      root: f.root,
      action: "reconfigure",
      mode: "preview",
      request: { desiredConfig: desired, quiescenceConfirmed: true },
    }),
    (error: unknown) => error instanceof WakeflowError && error.code === "invalid-request",
  );
  const unsupported = `${JSON.stringify({ ...desired, $schema: "urn:wakeflow:config:v1", schemaVersion: 1 }, null, 2)}\n`;
  writeFileSync(f.config, unsupported);
  await rejects(
    withWorkspaceOperationScope(f.rooted, "shared", async () => {}),
    (error: unknown) =>
      error instanceof WakeflowError && error.reason === "writer-protocol-unsupported",
  );
  const preview = await executeCodexWakeflowMaintenance({
    root: f.root,
    action: "reconfigure",
    mode: "preview",
    request: { desiredConfig: desired },
  });
  if (preview.mode !== "preview") throw new Error("Expected preview.");
  equal(preview.status, "blocked");
  equal(readFileSync(f.config, "utf8"), unsupported);
});

test("an interrupted reconfigure reserves all writers until public recovery completes", {
  timeout: 25000,
}, async (t) => {
  const f = fixture();
  const desired = JSON.parse(readFileSync(f.config, "utf8")) as Record<string, unknown>;
  (desired.program as { displayName: string }).displayName = "After interrupted maintenance";
  const request = {
    root: f.root,
    action: "reconfigure",
    mode: "preview",
    request: { desiredConfig: desired },
  };
  const preview = await executeCodexWakeflowMaintenance(request);
  if (preview.mode !== "preview" || preview.planDigest === null)
    throw new Error("Expected reconfigure preview.");
  const abort = new AbortController();
  const transactions = path.join(f.root, WORKSPACE_MAINTENANCE_TRANSACTIONS_REF);
  const original = RootedDirectory.prototype.inspectExistingResource;
  let interrupted = false;
  t.mock.method(
    RootedDirectory.prototype,
    "inspectExistingResource",
    async function (this: RootedDirectory, ...args: Parameters<typeof original>) {
      const result = await original.apply(this, args);
      if (
        !interrupted &&
        this.absolutePath === f.root &&
        args[0] === "wakeflow.config.json" &&
        JSON.parse(readFileSync(f.config, "utf8")).program.displayName ===
          "After interrupted maintenance" &&
        readdirSync(transactions).length > 0
      ) {
        interrupted = true;
        abort.abort();
      }
      return result;
    },
  );
  await rejects(
    executeCodexWakeflowMaintenance(
      { ...request, mode: "apply", planDigest: preview.planDigest },
      { signal: abort.signal },
    ),
  );
  equal(interrupted, true);
  equal((await readWakeflowConfigAuthoritySnapshot(f.rooted)).model.schemaVersion, 2);
  await rejects(
    withWorkspaceOperationScope(f.rooted, "shared", async () => {}),
    (error: unknown) =>
      error instanceof WakeflowError && error.reason === "maintenance-recovery-required",
  );
  const operationId = readdirSync(transactions)
    .map((name) => name.match(/maintenance_operation_[0-9a-f-]+/u)?.[0])
    .find((value) => value !== undefined);
  if (operationId === undefined) throw new Error("Missing durable maintenance operation.");
  const recovered = await executeCodexWakeflowMaintenance({
    root: f.root,
    mode: "recover",
    operationId,
  });
  equal(recovered.status, "recovered");
  deepEqual(readdirSync(transactions), []);
  await withWorkspaceOperationScope(f.rooted, "shared", async () => {});
});
