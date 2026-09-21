import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeWindowBindingRequest } from "../../../src/capabilities/endpoint/service.js";
import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

/**
 * 能力级 given-when-then（能力卡 1 §1.4 自动修复）：fresh 之后删掉 Wakeflow 拥有的静态目录
 * ——支撑面 scaffold、宿主 capability 目录、活动布局与看板、ledger 固定容器——reconcile 只补齐
 * 它们，apply 后再次 reconcile 零步；scaffold 位置被文件占用时只报告不覆盖。
 */

async function fixture(t: TestContext): Promise<string> {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintain-repair-")),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  t.after(() => rmSync(absolutePath, { recursive: true, force: true }));
  return absolutePath;
}

function selection() {
  const value = createMinimalWakeflowFreshConfigSelection();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return value;
}

function stepKinds(result: unknown): readonly string[] {
  const plan = (result as { plan?: { steps?: readonly { stepKind?: string }[] } | null }).plan;
  return (plan?.steps ?? []).map((step) => step.stepKind ?? "<host-step>");
}

async function reconcilePreview(root: string) {
  return executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
}

/** 观察侧（G6）：status 里该窗口的投影新鲜度，verify 里 window-runtime-projection 门的 [status, code]。 */
async function observeProjection(root: string, windowId: string) {
  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root });
  const verify = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root });
  const gate = verify.gates.find((entry) => entry.name === "window-runtime-projection");
  return {
    window: status.windows.find((entry) => entry.windowId === windowId)?.projection ?? null,
    domain: status.domains.windowRuntime.status,
    maintenanceNext: status.nextActions.some(
      (action) => action.tool === "wakeflow_maintain_workspace",
    ),
    gate: [gate?.status ?? null, gate?.code ?? null] as const,
  };
}

test("maintain_workspace reconcile repairs missing Wakeflow-owned static directories and stays no-op afterwards", async (t) => {
  const root = await fixture(t);
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
  equal(preview.status, "ready");
  const applied = await executeCodexWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });
  equal(applied.status, "completed");

  const drafts = path.join(root, "Design", "drafts");
  const harnesses = path.join(root, "Test", "harnesses");
  const fixtures = path.join(root, "Test", "fixtures");
  const leases = path.join(
    root,
    ".wakeflow-local",
    "runtime",
    "hosts",
    "codex",
    "operations",
    "keep-live",
    "leases",
  );
  const boardIndex = path.join(root, ".wakeflow-active", "current", "board", "index.md");
  const archives = path.join(root, "Ledger", "archives");
  for (const directory of [drafts, harnesses, fixtures, leases, archives]) {
    equal(statSync(directory).isDirectory(), true, `fresh must create ${path.basename(directory)}`);
  }
  equal(existsSync(boardIndex), true);
  equal(statSync(drafts).mode & 0o777, 0o755);
  // Wakeflow 管理的支撑面根各有一份只含宿主本机设置路径的 .gitignore 托管块。
  const designIgnore = path.join(root, "Design", ".gitignore");
  const designIgnoreText = readFileSync(designIgnore, "utf8");
  equal(
    designIgnoreText.includes("component=support-ignore owner=workspace-ignore-integration"),
    true,
  );
  equal(designIgnoreText.includes("/.claude/settings.local.json"), true);
  equal(existsSync(path.join(root, "Test", ".gitignore")), true);

  // 健康工作区：零步。
  const healthy = await reconcilePreview(root);
  equal(healthy.status, "ready");
  deepEqual(stepKinds(healthy), []);

  rmSync(drafts, { recursive: true });
  rmSync(harnesses, { recursive: true });
  rmSync(leases, { recursive: true });
  rmSync(path.join(root, ".wakeflow-active", "current"), { recursive: true });
  rmSync(archives, { recursive: true });
  rmSync(designIgnore);
  const repair = await reconcilePreview(root);
  equal(repair.status, "ready");
  deepEqual([...repair.next.blockers], []);
  deepEqual(stepKinds(repair), [
    "materialize-active-layout",
    "initialize-requirement-board",
    "materialize-ledger-layout",
    "materialize-host-capability-layout",
    "materialize-support-root",
    "materialize-support-root",
    "recompose-support-gitignore",
  ]);
  equal(existsSync(drafts), false, "preview must not write");
  equal(existsSync(designIgnore), false, "preview must not write");

  const repaired = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: repair.planDigest as string,
  });
  equal(repaired.status, "completed");
  for (const directory of [drafts, harnesses, fixtures, leases, archives]) {
    equal(
      statSync(directory).isDirectory(),
      true,
      `reconcile must restore ${path.basename(directory)}`,
    );
    equal(statSync(directory).mode & 0o777, directory === leases ? 0o700 : 0o755);
  }
  equal(existsSync(boardIndex), true);
  equal(readFileSync(designIgnore, "utf8"), designIgnoreText);
  equal(
    readFileSync(path.join(root, "wakeflow.config.json"), "utf8").includes('"programId"'),
    true,
  );

  const again = await reconcilePreview(root);
  equal(again.status, "ready");
  deepEqual(stepKinds(again), []);
  const noop = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: again.planDigest as string,
  });
  equal(noop.status, "no-op");

  // 支撑面 .gitignore 托管块被手改：只报告，不覆盖。
  writeFileSync(
    designIgnore,
    designIgnoreText.replace(
      "/.claude/settings.local.json",
      "/.claude/settings.local.json\n/edited",
    ),
  );
  const tampered = await reconcilePreview(root);
  equal(tampered.status, "blocked");
  equal(tampered.next.blockers.includes("support-gitignore-envelope"), true);
  writeFileSync(designIgnore, designIgnoreText);

  // scaffold 位置被普通文件占用：只报告，不覆盖。
  rmSync(drafts, { recursive: true });
  writeFileSync(drafts, "not a directory\n");
  const conflict = await reconcilePreview(root);
  equal(conflict.status, "blocked");
  equal(conflict.next.blockers.includes("support-root-conflict"), true);
  equal(readFileSync(drafts, "utf8"), "not a directory\n");
});

const CODEX_FACADE = {
  hostId: "codex",
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
} as const;

function projectionSteps(result: unknown): readonly string[] {
  const plan = (
    result as {
      plan?: { steps?: readonly { operationKind?: string; targetKey?: string }[] } | null;
    }
  ).plan;
  return (plan?.steps ?? [])
    .filter((step) => step.operationKind === "window-runtime-projection")
    .map((step) => step.targetKey ?? "");
}

test("maintain_workspace reconcile rebuilds a missing or stale registered window projection and only reports an unsafe one", async (t) => {
  const root = await fixture(t);
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
  await executeCodexWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });
  const intent = (
    preview.launchIntents as unknown as readonly {
      windowId: string;
      intentDigest: string;
      root: { configuredPlacement: string };
    }[]
  )[0];
  if (intent === undefined) throw new Error("Expected a launch intent.");
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  const handle = { kind: "codex-thread", value: "codex-host-owned-thread:opaque-repair" };
  await writeHostHookObservation(rooted, {
    hostId: "codex",
    event: "session-start",
    sessionId: handle.value,
    cwd: path.resolve(root, intent.root.configuredPlacement),
    recordedAt: parseUtcInstant("2026-09-21T09:58:00.000Z"),
  });
  const registered = await executeWindowBindingRequest(
    CODEX_FACADE,
    {
      root,
      operation: "register",
      windowId: intent.windowId,
      observation: {
        handle,
        launchIntentDigest: intent.intentDigest,
        observedAt: "2026-09-21T09:59:00.000Z",
      },
    },
    {
      clock: () => parseUtcInstant("2026-09-21T10:00:00.000Z"),
      uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  );
  if (registered.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(registered.disposition, "registered");
  const projectionPath = path.join(
    root,
    ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
    `${intent.windowId}.json`,
  );
  const registeredDocument = readFileSync(projectionPath, "utf8");
  equal(registeredDocument.includes('"registered"'), true);

  // 登记后的健康工作区：零步；观察侧投影 current、门 pass、下一步不指向维护。
  const healthy = await reconcilePreview(root);
  equal(healthy.status, "ready");
  deepEqual(stepKinds(healthy), []);
  deepEqual(await observeProjection(root, intent.windowId), {
    window: "current",
    domain: "observed",
    maintenanceNext: false,
    gate: ["pass", null],
  });

  // 投影缺失：一条宿主操作，apply 后逐字节复原为 registered 投影；
  // 观察侧（G6，§13.111）逐窗口报 missing、门 fail 点名窗口、下一步指向维护。
  rmSync(projectionPath);
  const missing = await reconcilePreview(root);
  equal(missing.status, "ready");
  deepEqual(projectionSteps(missing), [intent.windowId]);
  equal(existsSync(projectionPath), false, "preview must not write");
  deepEqual(await observeProjection(root, intent.windowId), {
    window: "missing",
    domain: "observed",
    maintenanceNext: true,
    gate: ["fail", `codex:${intent.windowId}:missing`],
  });
  const restored = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: missing.planDigest as string,
  });
  equal(restored.status, "completed");
  equal(readFileSync(projectionPath, "utf8"), registeredDocument);
  equal(statSync(projectionPath).mode & 0o777, 0o600);

  // 投影过期（合法 JSON、内容不同）：同样重建。
  writeFileSync(projectionPath, registeredDocument.replace('"registered"', '"unregistered"'));
  const stale = await reconcilePreview(root);
  deepEqual(projectionSteps(stale), [intent.windowId]);
  const refreshed = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: stale.planDigest as string,
  });
  equal(refreshed.status, "completed");
  equal(readFileSync(projectionPath, "utf8"), registeredDocument);
  deepEqual(stepKinds(await reconcilePreview(root)), []);

  // 投影读不出：只报告，不覆盖；观察侧报 unsafe、门 fail，但下一步不指向维护（reconcile 修不了）。
  writeFileSync(projectionPath, "not a projection\n");
  const unsafe = await reconcilePreview(root);
  equal(unsafe.status, "blocked");
  equal(
    unsafe.next.blockers.includes("host:codex:codex-maintenance:window-runtime-projection-unsafe"),
    true,
  );
  equal(readFileSync(projectionPath, "utf8"), "not a projection\n");
  deepEqual(await observeProjection(root, intent.windowId), {
    window: "unsafe",
    domain: "observed",
    maintenanceNext: false,
    gate: ["fail", `codex:${intent.windowId}:unsafe`],
  });
});

test("maintain_workspace reconcile rebuilds a missing ledger root but only reports a missing host runtime root", async (t) => {
  const root = await fixture(t);
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
  await executeCodexWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });

  rmSync(path.join(root, "Ledger"), { recursive: true });
  const missingLedger = await reconcilePreview(root);
  equal(missingLedger.status, "ready");
  deepEqual(stepKinds(missingLedger), ["materialize-ledger-layout"]);
  const rebuilt = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: missingLedger.planDigest as string,
  });
  equal(rebuilt.status, "completed");
  for (const container of ["requirements", "transactions", "archives"]) {
    equal(statSync(path.join(root, "Ledger", container)).isDirectory(), true);
  }

  rmSync(path.join(root, ".wakeflow-local", "runtime", "hosts"), { recursive: true });
  const missingRuntime = await reconcilePreview(root);
  equal(missingRuntime.status, "blocked");
  equal(missingRuntime.next.blockers.includes("window-runtime-missing"), true);
  equal(existsSync(path.join(root, ".wakeflow-local", "runtime", "hosts")), false);
});
