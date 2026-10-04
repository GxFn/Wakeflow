import { deepEqual, equal, rejects } from "node:assert/strict";
import {
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
import { test, type TestContext } from "node:test";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { WakeflowError } from "../../src/kernel/error.js";
import {
  WORKSPACE_MAINTENANCE_TRANSACTIONS_REF,
  WORKSPACE_OPERATION_SCOPES_REF,
} from "../../src/kernel/layout.js";
import { withWorkspaceOperationScope } from "../../src/kernel/workspace-operation-scope.js";
import { materializeFixtureOperationScope } from "../support/workspace-operation-scope.fixture.js";

async function fixture(t: TestContext) {
  const absolute = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-scope-lifetime-")));
  materializeFixtureOperationScope(absolute);
  writeFileSync(
    path.join(absolute, "wakeflow.config.json"),
    `${JSON.stringify({ kind: "WakeflowConfig", schemaVersion: 2 }, null, 2)}\n`,
  );
  const root = await RootedDirectory.open(absolute, "$root", { durability: "none" });
  t.after(async () => {
    await root.close();
    rmSync(absolute, { recursive: true, force: true });
  });
  return root;
}

const reason = (expected: string) => (error: unknown) =>
  error instanceof WakeflowError && error.reason === expected;

test("operation scope cannot promote, cross workspaces, or outlive its callback", async (t) => {
  const root = await fixture(t);
  const other = await fixture(t);
  const release = Promise.withResolvers<void>();
  let escaped: Promise<unknown> | undefined;
  let entered = 0;
  await withWorkspaceOperationScope(root, "shared", async () => {
    await withWorkspaceOperationScope(root, "shared", async () => {
      entered++;
    });
    await rejects(
      withWorkspaceOperationScope(root, "exclusive", async () => {}),
      reason("operation-scope-promotion"),
    );
    await rejects(
      withWorkspaceOperationScope(other, "shared", async () => {}),
      reason("operation-scope-root-mismatch"),
    );
    escaped = release.promise.then(() =>
      withWorkspaceOperationScope(root, "shared", async () => {
        entered++;
      }),
    );
  });
  if (escaped === undefined) throw new Error("Expected escaped callback.");
  const refused = rejects(escaped, reason("operation-scope-expired"));
  release.resolve();
  await refused;
  equal(entered, 1);
  deepEqual(readdirSync(path.join(root.absolutePath, WORKSPACE_OPERATION_SCOPES_REF)), []);
  await withWorkspaceOperationScope(root, "exclusive", async () => {
    await withWorkspaceOperationScope(root, "shared", async () => {
      entered++;
    });
  });
  equal(entered, 2);
});

test("unfinished maintenance reserves the workspace even after its process and leases are gone", async (t) => {
  const root = await fixture(t);
  const transactions = path.join(root.absolutePath, WORKSPACE_MAINTENANCE_TRANSACTIONS_REF);
  mkdirSync(transactions, { recursive: true, mode: 0o700 });
  const intent = path.join(transactions, "unknown-intent.json");
  writeFileSync(intent, "preserve\n", { mode: 0o600 });
  let entered = false;
  for (const mode of ["shared", "exclusive"] as const) {
    await rejects(
      withWorkspaceOperationScope(root, mode, async () => {
        entered = true;
      }),
      reason("maintenance-recovery-required"),
    );
  }
  equal(entered, false);
  equal(readFileSync(intent, "utf8"), "preserve\n");
  deepEqual(readdirSync(path.join(root.absolutePath, WORKSPACE_OPERATION_SCOPES_REF)), []);
});
