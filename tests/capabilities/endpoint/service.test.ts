import { deepEqual, equal, match, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  executeWindowBindingRequest,
  WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
  type WindowBindingHostFacade,
} from "../../../src/capabilities/endpoint/service.js";
import { createWakeflowDurableId } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { createWorkClaim, takeWorkClaim } from "../../../src/kernel/work-claims.js";
import { parseWakeflowWindowHostBindingId } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";

/**
 * 端点切片测试：一次性工作区经 Fresh 初始化后，走 inspect、register、replace、
 * decommission、release-claim 五种操作。宿主窗口本身从不被创建；会话证据由
 * `session-start` / `session-end` hook 记录提供。
 */

const CODEX: WindowBindingHostFacade = {
  hostId: "codex",
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
};
const CLAUDE: WindowBindingHostFacade = {
  hostId: "claude-code",
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
};
const DIGEST = (fill: string) => `sha256:${fill.repeat(64)}` as Sha256Digest;

interface Intent {
  readonly windowId: string;
  readonly intentDigest: string;
  readonly root: { readonly configuredPlacement: string };
}

async function fixture(
  t: TestContext,
  execute: typeof executeCodexWakeflowMaintenance,
): Promise<{
  readonly root: string;
  readonly rooted: RootedDirectory;
  readonly intents: readonly Intent[];
}> {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-endpoint-slice-")));
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const preview = await execute({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  if (preview.mode !== "preview" || preview.planDigest === null)
    throw new Error("Expected a ready Fresh plan.");
  await execute({
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection },
    planDigest: preview.planDigest,
  });
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  return { root, rooted, intents: preview.launchIntents as unknown as readonly Intent[] };
}

async function sessionStart(
  rooted: RootedDirectory,
  hostId: "codex" | "claude-code",
  sessionId: string,
  placement: string,
  recordedAt: UtcInstant,
): Promise<void> {
  await writeHostHookObservation(rooted, {
    hostId,
    event: "session-start",
    sessionId,
    cwd: path.resolve(rooted.absolutePath, placement),
    recordedAt,
  });
}

async function expectFailure(
  promise: Promise<unknown>,
  code: string,
  reason: string,
): Promise<void> {
  await rejects(promise, (error: unknown) => {
    if (!(error instanceof WakeflowError)) return false;
    equal(`${error.code}/${error.reason}`, `${code}/${reason}`);
    return true;
  });
}

test("Codex：inspect 给出启动意图与执行参数，register 需要 hook 证据，重放幂等，异句柄冲突", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeCodexWakeflowMaintenance);
  const intent = intents[0];
  if (intent === undefined) throw new Error("Expected a launch intent.");
  const clock = () => parseUtcInstant("2026-09-04T10:00:00.000Z");

  const inspected = await executeWindowBindingRequest(
    CODEX,
    { root, operation: "inspect", windowId: intent.windowId },
    { clock },
  );
  if (inspected.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  equal(inspected.binding.status, "unregistered");
  equal(inspected.claim.status, "absent");
  equal(inspected.locator.status, "not-applicable");
  equal(inspected.launchIntent.intentDigest, intent.intentDigest);
  equal((inspected.launchIntent.execution as { kind: string }).kind, "codex");
  equal(inspected.next.frontier, "window-registration");
  equal(JSON.stringify(inspected).includes(root), false, "inspection leaked the workspace path");

  const handle = { kind: "codex-thread", value: "codex-host-owned-thread:opaque-7" };
  const observation = {
    handle,
    launchIntentDigest: intent.intentDigest,
    observedAt: "2026-09-04T09:59:00.000Z",
  };
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      { root, operation: "register", windowId: intent.windowId, observation },
      { clock },
    ),
    "precondition-failed",
    "hook-evidence-missing",
  );
  await sessionStart(
    rooted,
    "codex",
    handle.value,
    intent.root.configuredPlacement,
    parseUtcInstant("2026-09-04T09:58:00.000Z"),
  );
  const registered = await executeWindowBindingRequest(
    CODEX,
    { root, operation: "register", windowId: intent.windowId, observation },
    { clock, uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  );
  if (registered.kind !== "WakeflowWindowBindingMutation" || registered.binding === null)
    throw new Error("Expected a mutation.");
  equal(registered.disposition, "registered");
  equal(registered.binding.bindingId, "window_binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  equal(registered.projection === null, false);
  equal(JSON.stringify(registered).includes(handle.value), false, "raw handle leaked");
  const bindingFile = path.join(
    root,
    ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
    `${intent.windowId}.json`,
  );
  equal(statSync(bindingFile).mode & 0o777, 0o600);
  equal(readFileSync(bindingFile, "utf8").includes(handle.value), true);
  const projectionFile = path.join(
    root,
    ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
    `${intent.windowId}.json`,
  );
  match(readFileSync(projectionFile, "utf8"), /"status": "registered"/u);
  equal(readFileSync(projectionFile, "utf8").includes(handle.value), false);

  const replayed = await executeWindowBindingRequest(
    CODEX,
    { root, operation: "register", windowId: intent.windowId, observation },
    { clock },
  );
  if (replayed.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(replayed.disposition, "replayed");
  deepEqual(replayed.binding, registered.binding);

  const other = { ...handle, value: "codex-host-owned-thread:opaque-8" };
  await sessionStart(
    rooted,
    "codex",
    other.value,
    intent.root.configuredPlacement,
    parseUtcInstant("2026-09-04T09:58:30.000Z"),
  );
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "register",
        windowId: intent.windowId,
        observation: { ...observation, handle: other },
      },
      { clock },
    ),
    "precondition-failed",
    "handle-conflict",
  );
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "register",
        windowId: intent.windowId,
        observation: { ...observation, launchIntentDigest: DIGEST("9") },
      },
      { clock },
    ),
    "precondition-failed",
    "launch-intent-drift",
  );
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      { root, operation: "inspect", windowId: "window_00000000-0000-4000-8000-000000000000" },
      { clock },
    ),
    "not-found",
    "window-unknown",
  );

  const after = await executeWindowBindingRequest(
    CODEX,
    { root, operation: "inspect", windowId: intent.windowId },
    { clock },
  );
  if (after.kind !== "WakeflowWindowBindingInspection" || after.binding.status !== "registered")
    throw new Error("Expected registered.");
  equal(after.binding.bindingId, registered.binding.bindingId);
  equal(after.next.frontier, "window-registration");
  equal(after.next.blockers.length, intents.length - 1);
});

test("Codex：replace 以 CAS 换代，decommission 走人工宿主门，声明持有时都被拒绝并可强制释放", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeCodexWakeflowMaintenance);
  const intent = intents[0];
  if (intent === undefined) throw new Error("Expected a launch intent.");
  let now = parseUtcInstant("2026-09-04T10:00:00.000Z");
  const clock = () => now;
  const first = { kind: "codex-thread", value: "codex-host-owned-thread:gen-1" };
  const second = { kind: "codex-thread", value: "codex-host-owned-thread:gen-2" };
  for (const handle of [first, second]) {
    await sessionStart(
      rooted,
      "codex",
      handle.value,
      intent.root.configuredPlacement,
      parseUtcInstant("2026-09-04T09:58:00.000Z"),
    );
  }
  const observation = {
    handle: first,
    launchIntentDigest: intent.intentDigest,
    observedAt: "2026-09-04T09:59:00.000Z",
  };
  const registered = await executeWindowBindingRequest(
    CODEX,
    { root, operation: "register", windowId: intent.windowId, observation },
    { clock },
  );
  if (registered.kind !== "WakeflowWindowBindingMutation" || registered.binding === null)
    throw new Error("Expected a mutation.");
  const expectation = {
    expectedBindingId: registered.binding.bindingId,
    expectedBindingDigest: registered.binding.bindingDigest,
  };

  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "replace",
        windowId: intent.windowId,
        observation: { ...observation, handle: second },
        ...expectation,
        expectedBindingDigest: DIGEST("0"),
      },
      { clock },
    ),
    "precondition-failed",
    "binding-drift",
  );
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      { root, operation: "replace", windowId: intent.windowId, observation, ...expectation },
      { clock },
    ),
    "precondition-failed",
    "handle-unchanged",
  );

  // 一份真实工作声明：持有期间替换与退役都被拒绝；两小时后可强制释放。
  const bindingId = parseWakeflowWindowHostBindingId(registered.binding.bindingId);
  const claim = createWorkClaim({
    claimId: createWakeflowDurableId("work-claim"),
    hostId: "codex",
    windowId: intent.windowId as never,
    bindingId,
    holder: {
      demandId: createWakeflowDurableId("demand"),
      targetTaskId: createWakeflowDurableId("target-task"),
      deliveryId: createWakeflowDurableId("target-delivery"),
      generation: 1,
    },
    claimedAt: parseUtcInstant("2026-09-04T10:01:00.000Z"),
  });
  await takeWorkClaim(rooted, claim);
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "replace",
        windowId: intent.windowId,
        observation: { ...observation, handle: second },
        ...expectation,
      },
      { clock },
    ),
    "precondition-failed",
    "claim-held",
  );
  const held = await executeWindowBindingRequest(
    CODEX,
    { root, operation: "inspect", windowId: intent.windowId },
    { clock },
  );
  if (held.kind !== "WakeflowWindowBindingInspection" || held.claim.status !== "held")
    throw new Error("Expected a held claim.");
  equal(held.claim.expired, false);
  equal(
    held.claim.expiresAt,
    new Date(
      Date.parse("2026-09-04T10:01:00.000Z") + WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
    ).toISOString(),
  );
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "release-claim",
        windowId: intent.windowId,
        expectedClaimDigest: claim.claimDigest,
        evidence: { liveness: { kind: "codex-thread", status: "active" } },
      },
      { clock },
    ),
    "precondition-failed",
    "claim-active",
  );
  now = parseUtcInstant("2026-09-04T12:01:00.000Z");
  const expired = await executeWindowBindingRequest(
    CODEX,
    { root, operation: "inspect", windowId: intent.windowId },
    { clock },
  );
  if (expired.kind !== "WakeflowWindowBindingInspection" || expired.claim.status !== "held")
    throw new Error("Expected a held claim.");
  equal(expired.claim.expired, true);
  equal(expired.next.frontier, "work-claim-recovery");
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "release-claim",
        windowId: intent.windowId,
        expectedClaimDigest: DIGEST("4"),
        evidence: { liveness: { kind: "unobserved" } },
      },
      { clock },
    ),
    "precondition-failed",
    "claim-drift",
  );
  const released = await executeWindowBindingRequest(
    CODEX,
    {
      root,
      operation: "release-claim",
      windowId: intent.windowId,
      expectedClaimDigest: claim.claimDigest,
      evidence: { liveness: { kind: "unobserved" } },
    },
    { clock },
  );
  if (released.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(released.disposition, "claim-released");
  equal(released.claim?.claimId, claim.claimId);
  equal(
    existsSync(
      path.join(
        root,
        ".wakeflow-local/runtime/hosts/codex/observations/claim-releases",
        `${claim.claimId}.json`,
      ),
    ),
    true,
  );
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "release-claim",
        windowId: intent.windowId,
        expectedClaimDigest: claim.claimDigest,
        evidence: { liveness: { kind: "unobserved" } },
      },
      { clock },
    ),
    "not-found",
    "claim-absent",
  );

  const replaced = await executeWindowBindingRequest(
    CODEX,
    {
      root,
      operation: "replace",
      windowId: intent.windowId,
      observation: { ...observation, handle: second, observedAt: "2026-09-04T12:00:00.000Z" },
      ...expectation,
    },
    { clock, uuidFactory: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  );
  if (replaced.kind !== "WakeflowWindowBindingMutation" || replaced.binding === null)
    throw new Error("Expected a mutation.");
  equal(replaced.disposition, "replaced");
  equal(replaced.binding.bindingId, "window_binding_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  equal(replaced.binding.registeredAt, "2026-09-04T12:01:00.000Z");
  const bindingFile = path.join(
    root,
    ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
    `${intent.windowId}.json`,
  );
  equal(readFileSync(bindingFile, "utf8").includes(second.value), true);
  equal(readFileSync(bindingFile, "utf8").includes(first.value), false);
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "decommission",
        windowId: intent.windowId,
        ...expectation,
        closure: {
          preClose: { kind: "unobserved" },
          closeResult: { status: "closed" },
          postClose: { kind: "unobserved" },
        },
      },
      { clock },
    ),
    "precondition-failed",
    "binding-drift",
  );
  const current = {
    expectedBindingId: replaced.binding.bindingId,
    expectedBindingDigest: replaced.binding.bindingDigest,
  };
  await expectFailure(
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "decommission",
        windowId: intent.windowId,
        ...current,
        closure: {
          preClose: { kind: "codex-thread", status: "active" },
          closeResult: { status: "failed" },
          postClose: { kind: "codex-thread", status: "active" },
        },
      },
      { clock },
    ),
    "precondition-failed",
    "closure-blocked",
  );
  const decommissioned = await executeWindowBindingRequest(
    CODEX,
    {
      root,
      operation: "decommission",
      windowId: intent.windowId,
      ...current,
      closure: {
        preClose: { kind: "codex-thread", status: "active" },
        closeResult: { status: "closed" },
        postClose: { kind: "codex-thread", status: "archived" },
      },
    },
    { clock },
  );
  if (decommissioned.kind !== "WakeflowWindowBindingMutation")
    throw new Error("Expected a mutation.");
  equal(decommissioned.disposition, "decommissioned");
  equal(decommissioned.verification, "manual-host-gate");
  equal(decommissioned.binding, null);
  equal(existsSync(bindingFile), false);
  const projectionFile = path.join(
    root,
    ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
    `${intent.windowId}.json`,
  );
  match(readFileSync(projectionFile, "utf8"), /"status": "unregistered"/u);
  equal(decommissioned.next.frontier, "window-registration");
});

test("Claude Code：register 需要 tmux 坐标并写定位器，decommission 凭 pane 与 session-end 证据机器核实", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeClaudeCodeWakeflowMaintenance);
  const intent = intents[0];
  if (intent === undefined) throw new Error("Expected a launch intent.");
  const clock = () => parseUtcInstant("2026-09-04T10:00:00.000Z");
  const sessionId = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
  const handle = { kind: "claude-session", value: sessionId };
  const base = {
    handle,
    launchIntentDigest: intent.intentDigest,
    observedAt: "2026-09-04T09:59:00.000Z",
  };
  await sessionStart(
    rooted,
    "claude-code",
    sessionId,
    intent.root.configuredPlacement,
    parseUtcInstant("2026-09-04T09:58:00.000Z"),
  );
  await expectFailure(
    executeWindowBindingRequest(
      CLAUDE,
      { root, operation: "register", windowId: intent.windowId, observation: base },
      { clock },
    ),
    "invalid-request",
    "tmux-coordinates-required",
  );
  const tmux = { socketName: null, sessionName: "wakeflow", windowId: "@3", paneId: "%7" };
  const registered = await executeWindowBindingRequest(
    CLAUDE,
    { root, operation: "register", windowId: intent.windowId, observation: { ...base, tmux } },
    { clock },
  );
  if (registered.kind !== "WakeflowWindowBindingMutation" || registered.binding === null)
    throw new Error("Expected a mutation.");
  const locatorFile = path.join(
    root,
    ".wakeflow-local/runtime/hosts/claude-code/identity/window-locators",
    `${intent.windowId}.json`,
  );
  equal(statSync(locatorFile).mode & 0o777, 0o600);
  const locator = JSON.parse(readFileSync(locatorFile, "utf8")) as {
    bindingId: string;
    tmux: typeof tmux;
    locatorId: string;
  };
  equal(locator.bindingId, registered.binding.bindingId);
  deepEqual(locator.tmux, tmux);
  const inspected = await executeWindowBindingRequest(
    CLAUDE,
    { root, operation: "inspect", windowId: intent.windowId },
    { clock },
  );
  if (inspected.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  equal(inspected.locator.status, "present");
  equal((inspected.launchIntent.execution as { kind: string }).kind, "claude-code");

  const pane = {
    ...tmux,
    paneWindowId: "@3",
    paneDead: false,
    currentCommand: "claude",
    options: {
      programId:
        locator.locatorId.length > 0
          ? (JSON.parse(readFileSync(locatorFile, "utf8")) as { programId: string }).programId
          : "",
      hostId: "claude-code",
      windowId: intent.windowId,
      bindingId: registered.binding.bindingId,
      locatorId: locator.locatorId,
    },
  };
  const expectation = {
    expectedBindingId: registered.binding.bindingId,
    expectedBindingDigest: registered.binding.bindingDigest,
  };
  await expectFailure(
    executeWindowBindingRequest(
      CLAUDE,
      {
        root,
        operation: "decommission",
        windowId: intent.windowId,
        ...expectation,
        closure: {
          preClose: { kind: "tmux-panes", panes: [pane] },
          closeResult: { status: "closed" },
          postClose: { kind: "tmux-panes", panes: [pane] },
        },
      },
      { clock },
    ),
    "precondition-failed",
    "closure-blocked",
  );
  const manual = await executeWindowBindingRequest(
    CLAUDE,
    {
      root,
      operation: "decommission",
      windowId: intent.windowId,
      ...expectation,
      closure: {
        preClose: { kind: "tmux-panes", panes: [pane] },
        closeResult: { status: "closed" },
        postClose: { kind: "tmux-panes", panes: [] },
      },
    },
    { clock },
  );
  if (manual.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(manual.disposition, "decommissioned");
  equal(manual.verification, "manual-host-gate", "no session-end record yet");
  equal(existsSync(locatorFile), false);

  const again = await executeWindowBindingRequest(
    CLAUDE,
    { root, operation: "register", windowId: intent.windowId, observation: { ...base, tmux } },
    { clock },
  );
  if (again.kind !== "WakeflowWindowBindingMutation" || again.binding === null)
    throw new Error("Expected a mutation.");
  await writeHostHookObservation(rooted, {
    hostId: "claude-code",
    event: "session-end",
    sessionId,
    cwd: path.resolve(root, intent.root.configuredPlacement),
    recordedAt: parseUtcInstant("2026-09-04T10:05:00.000Z"),
  });
  const verified = await executeWindowBindingRequest(
    CLAUDE,
    {
      root,
      operation: "decommission",
      windowId: intent.windowId,
      expectedBindingId: again.binding.bindingId,
      expectedBindingDigest: again.binding.bindingDigest,
      closure: {
        preClose: {
          kind: "tmux-panes",
          panes: [
            {
              ...pane,
              options: {
                ...pane.options,
                bindingId: again.binding.bindingId,
                locatorId: (JSON.parse(readFileSync(locatorFile, "utf8")) as { locatorId: string })
                  .locatorId,
              },
            },
          ],
        },
        closeResult: { status: "closed" },
        postClose: { kind: "tmux-panes", panes: [] },
      },
    },
    { clock },
  );
  if (verified.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(verified.verification, "machine-verified");
  equal(JSON.stringify(verified).includes(sessionId), false, "session id leaked");
});
