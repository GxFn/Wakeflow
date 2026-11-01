import { deepEqual, equal, match, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  executeWindowBindingRequest,
  type WindowBindingHostFacade,
  WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
} from "../../../src/capabilities/endpoint/service.js";
import { createWakeflowDurableId } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import type { Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { renderClaudeCodeWindowLaunchInstructions } from "../../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import {
  claudeCodeDesktopWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostTransportTable,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { renderCodexWindowLaunchInstructions } from "../../../src/hosts/codex/codex-window-launch-instructions.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { createWorkClaim, takeWorkClaim } from "../../../src/kernel/work-claims.js";
import { parseWakeflowWindowHostBindingId } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { wakeflowWindowHostBindingMutationLockRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 端点切片效果（第 2 级，能力；能力卡 2，open-items W1 与 W4）：一次性工作区经 Fresh 初始化后，走 inspect、
 * register、replace、relocate、decommission、release-claim 六种操作。宿主窗口本身从不被创建；会话证据由
 * `session-start` / `session-end` hook 记录提供。
 */

const CODEX: WindowBindingHostFacade = {
  hostId: "codex",
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
  renderLaunchInstructions: renderCodexWindowLaunchInstructions,
};
const CLAUDE: WindowBindingHostFacade = {
  hostId: "claude-code",
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
  renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
};
/** 桌面传输直接作为门面的 profile（ADR-0025）：端点只读选出的 profile，与配置经传输表选出的结果同形。 */
const CLAUDE_DESKTOP: WindowBindingHostFacade = {
  hostId: "claude-code",
  resourceProfile: claudeCodeDesktopWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
  renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
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
  hosts?: Record<string, unknown>,
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
  if (hosts !== undefined) (selection as Record<string, unknown>).hosts = hosts;
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
    cwd: hostId === "codex" ? rooted.absolutePath : path.resolve(rooted.absolutePath, placement),
    recordedAt,
  });
}

async function sessionEnd(
  rooted: RootedDirectory,
  hostId: "codex" | "claude-code",
  sessionId: string,
  placement: string,
  recordedAt: UtcInstant,
): Promise<void> {
  await writeHostHookObservation(rooted, {
    hostId,
    event: "session-end",
    sessionId,
    cwd: hostId === "codex" ? rooted.absolutePath : path.resolve(rooted.absolutePath, placement),
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

test("项目聊天：所有角色在同一程序根启动，角色目录仅用于执行，子目录会话不能冒充项目聊天", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeCodexWakeflowMaintenance);
  for (const [index, intent] of intents.entries()) {
    const inspected = await executeWindowBindingRequest(CODEX, {
      root,
      operation: "inspect",
      windowId: intent.windowId,
    });
    if (inspected.kind !== "WakeflowWindowBindingInspection")
      throw new Error("Expected inspection.");
    const execution = inspected.launchIntent.execution as {
      readonly sessionRoot: string;
      readonly executionRoot: string;
      readonly target: { readonly type: string; readonly environment: { readonly type: string } };
    };
    equal(execution.sessionRoot, ".");
    equal(execution.executionRoot, intent.root.configuredPlacement);
    equal(execution.target.type, "project");
    equal(execution.target.environment.type, "local");
    equal("cwd" in execution, false, "create_thread has no arbitrary cwd parameter");
    const handle = { kind: "codex-thread", value: `project-chat-${index}` };
    const request = {
      root,
      operation: "register",
      windowId: intent.windowId,
      observation: {
        handle,
        launchIntentDigest: intent.intentDigest,
        observedAt: "2026-09-04T10:00:00.000Z",
      },
    };
    if (intent.root.configuredPlacement !== ".") {
      await writeHostHookObservation(rooted, {
        hostId: "codex",
        event: "session-start",
        sessionId: handle.value,
        cwd: path.resolve(root, intent.root.configuredPlacement),
        recordedAt: parseUtcInstant("2026-09-04T09:59:00.000Z"),
      });
      await expectFailure(
        executeWindowBindingRequest(CODEX, request),
        "precondition-failed",
        "hook-evidence-missing",
      );
    }
    await sessionStart(
      rooted,
      "codex",
      handle.value,
      ".",
      parseUtcInstant("2026-09-04T10:00:00.000Z"),
    );
    const registered = await executeWindowBindingRequest(CODEX, request);
    if (registered.kind !== "WakeflowWindowBindingMutation")
      throw new Error("Expected registration.");
    equal(registered.disposition, "registered");
  }
});

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
  // 意图里的 role 与顶层一致：宿主助手据此选许可规则（§13.182 F-L1-8）。
  equal(inspected.launchIntent.role, inspected.role);
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

test("Codex：两个窗口以同一句柄交错登记——都在锁外看到无人持有，锁内复验让后进锁的以 handle-conflict 拒绝，登记表仍可读（open-items W1）", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeCodexWakeflowMaintenance);
  const [firstIntent, secondIntent] = intents;
  if (firstIntent === undefined || secondIntent === undefined)
    throw new Error("Expected two launch intents.");
  const clock = () => parseUtcInstant("2026-09-04T10:00:00.000Z");
  const handle = { kind: "codex-thread", value: "codex-host-owned-thread:raced" };
  await sessionStart(
    rooted,
    "codex",
    handle.value,
    ".",
    parseUtcInstant("2026-09-04T09:58:00.000Z"),
  );
  const lockRef = wakeflowWindowHostBindingMutationLockRef(codexWorkspaceHostResourceProfile);
  type Lane = "first" | "second";
  const lanes: readonly Lane[] = ["first", "second"];
  const loaded: Record<Lane, boolean> = { first: false, second: false };
  const atDoor: Record<Lane, boolean> = { first: false, second: false };
  const doors = { first: Promise.withResolvers<void>(), second: Promise.withResolvers<void>() };
  const releases = { first: Promise.withResolvers<void>(), second: Promise.withResolvers<void>() };
  // 锁外加载完成（注入时钟被读到）之后的第一次锁文件观察就是绑定库的门口：停在那里，让另一个窗口也在
  // 锁外完成加载并同样看到无人持有这个句柄，再先后放行进锁。
  const inspect = RootedDirectory.prototype.inspectExistingResource;
  t.mock.method(
    RootedDirectory.prototype,
    "inspectExistingResource",
    async function (this: RootedDirectory, ...args: Parameters<typeof inspect>) {
      if (args[0] === lockRef) {
        const lane = lanes.find((candidate) => loaded[candidate] && !atDoor[candidate]);
        if (lane !== undefined) {
          atDoor[lane] = true;
          doors[lane].resolve();
          await releases[lane].promise;
        }
      }
      return inspect.apply(this, args);
    },
  );
  const register = (lane: Lane, intent: Intent) =>
    executeWindowBindingRequest(
      CODEX,
      {
        root,
        operation: "register",
        windowId: intent.windowId,
        observation: {
          handle,
          launchIntentDigest: intent.intentDigest,
          observedAt: "2026-09-04T09:59:00.000Z",
        },
      },
      {
        clock: () => {
          loaded[lane] = true;
          return clock();
        },
      },
    );
  type Settled =
    | { readonly ok: true; readonly value: Awaited<ReturnType<typeof register>> }
    | { readonly ok: false; readonly error: unknown };
  let first: ReturnType<typeof register> | undefined;
  let second: Promise<Settled> | undefined;
  try {
    first = register("first", firstIntent);
    await Promise.race([
      doors.first.promise,
      first.then(() => {
        throw new Error("The first registration skipped the store door.");
      }),
    ]);
    second = register("second", secondIntent).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await Promise.race([
      doors.second.promise,
      second.then(() => {
        throw new Error("The second registration skipped the store door.");
      }),
    ]);
    releases.first.resolve();
    const registered = await first;
    if (registered.kind !== "WakeflowWindowBindingMutation")
      throw new Error("Expected a mutation.");
    equal(registered.disposition, "registered");
    releases.second.resolve();
    const outcome = await second;
    if (outcome.ok || !(outcome.error instanceof WakeflowError))
      throw new Error("Expected the second registration to be rejected.");
    equal(`${outcome.error.code}/${outcome.error.reason}`, "precondition-failed/handle-conflict");
  } finally {
    releases.first.resolve();
    releases.second.resolve();
    await first?.catch(() => undefined);
    await second;
    t.mock.restoreAll();
  }
  // 登记表仍可读：第一个窗口已登记、第二个仍未登记，而不是整张表 io-failure/binding-inventory。
  for (const [intent, status] of [
    [firstIntent, "registered"],
    [secondIntent, "unregistered"],
  ] as const) {
    const inspected = await executeWindowBindingRequest(
      CODEX,
      { root, operation: "inspect", windowId: intent.windowId },
      { clock },
    );
    if (inspected.kind !== "WakeflowWindowBindingInspection")
      throw new Error("Expected an inspection.");
    equal(inspected.binding.status, status);
  }
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
  // tmux 传输的观察带了桌面会话 id：另一种传输的定位子，拒绝并指向多余的字段（ADR-0025 D3）。
  const tmux = { socketName: null, sessionName: "wakeflow", windowId: "@3", paneId: "%7" };
  await expectFailure(
    executeWindowBindingRequest(
      CLAUDE,
      {
        root,
        operation: "register",
        windowId: intent.windowId,
        observation: { ...base, tmux, desktop: { sessionId: `local_${sessionId}` } },
      },
      { clock },
    ),
    "invalid-request",
    "locator-kind-mismatch",
  );
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
    programId: string;
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
  equal(inspected.launchIntent.role, inspected.role);

  const pane = {
    ...tmux,
    paneWindowId: "@3",
    paneDead: false,
    currentCommand: "claude",
    options: {
      programId: locator.programId,
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

test("Claude Code：relocate 保留绑定、换定位器代际，句柄变了被拒（Codex 的 locator-provider 拒绝由 decide 测试覆盖，§13.125）", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeClaudeCodeWakeflowMaintenance);
  const intent = intents[0];
  if (intent === undefined) throw new Error("Expected a launch intent.");
  const clock = () => parseUtcInstant("2026-09-24T10:00:00.000Z");
  const sessionId = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
  const handle = { kind: "claude-session", value: sessionId };
  const base = {
    handle,
    launchIntentDigest: intent.intentDigest,
    observedAt: "2026-09-24T09:59:00.000Z",
  };
  await sessionStart(
    rooted,
    "claude-code",
    sessionId,
    intent.root.configuredPlacement,
    parseUtcInstant("2026-09-24T09:58:00.000Z"),
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
  const before = JSON.parse(readFileSync(locatorFile, "utf8")) as {
    locatorId: string;
    bindingId: string;
  };
  const moved = { ...tmux, windowId: "@9", paneId: "%21" };
  const relocated = await executeWindowBindingRequest(
    CLAUDE,
    {
      root,
      operation: "relocate",
      windowId: intent.windowId,
      observation: { ...base, tmux: moved, observedAt: "2026-09-24T10:00:30.000Z" },
      expectedBindingId: registered.binding.bindingId,
      expectedBindingDigest: registered.binding.bindingDigest,
    },
    { clock },
  );
  if (relocated.kind !== "WakeflowWindowBindingMutation" || relocated.binding === null)
    throw new Error("Expected a mutation.");
  equal(relocated.disposition, "relocated");
  equal(relocated.binding.bindingId, registered.binding.bindingId);
  equal(relocated.binding.bindingDigest, registered.binding.bindingDigest);
  const after = JSON.parse(readFileSync(locatorFile, "utf8")) as {
    locatorId: string;
    bindingId: string;
    tmux: typeof tmux;
  };
  equal(after.bindingId, before.bindingId);
  deepEqual(after.tmux, moved);
  equal(
    after.locatorId === before.locatorId,
    false,
    "the locator generation changes with the pane",
  );
  await expectFailure(
    executeWindowBindingRequest(
      CLAUDE,
      {
        root,
        operation: "relocate",
        windowId: intent.windowId,
        observation: {
          ...base,
          handle: { kind: "claude-session", value: "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f" },
          tmux: moved,
        },
        expectedBindingId: registered.binding.bindingId,
        expectedBindingDigest: registered.binding.bindingDigest,
      },
      { clock },
    ),
    "precondition-failed",
    "handle-changed",
  );
});

test("Claude Code：session-end 按最新 start/end 顺序判定——resume 之后旧的 end 不再给 release-claim 开恢复门，晚于最新 start 的 end 才算会话已结束（open-items W4）", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeClaudeCodeWakeflowMaintenance);
  const intent = intents[0];
  if (intent === undefined) throw new Error("Expected a launch intent.");
  const clock = () => parseUtcInstant("2026-09-04T10:10:00.000Z");
  const sessionId = "2e2e2e2e-2e2e-4e2e-8e2e-2e2e2e2e2e2e";
  const placement = intent.root.configuredPlacement;
  await sessionStart(
    rooted,
    "claude-code",
    sessionId,
    placement,
    parseUtcInstant("2026-09-04T09:58:00.000Z"),
  );
  const registered = await executeWindowBindingRequest(
    CLAUDE,
    {
      root,
      operation: "register",
      windowId: intent.windowId,
      observation: {
        handle: { kind: "claude-session", value: sessionId },
        launchIntentDigest: intent.intentDigest,
        observedAt: "2026-09-04T09:59:00.000Z",
        tmux: { socketName: null, sessionName: "wakeflow", windowId: "@5", paneId: "%11" },
      },
    },
    { clock },
  );
  if (registered.kind !== "WakeflowWindowBindingMutation" || registered.binding === null)
    throw new Error("Expected a mutation.");
  // 会话结束过一次，随后被 `claude --resume` 续上：同一会话 id 的新 session-start 晚于那条 end。
  await sessionEnd(
    rooted,
    "claude-code",
    sessionId,
    placement,
    parseUtcInstant("2026-09-04T10:02:00.000Z"),
  );
  await sessionStart(
    rooted,
    "claude-code",
    sessionId,
    placement,
    parseUtcInstant("2026-09-04T10:03:00.000Z"),
  );
  // Controller 向恢复后的窗口投递：一份未过期的工作声明。
  const claim = createWorkClaim({
    claimId: createWakeflowDurableId("work-claim"),
    hostId: "claude-code",
    windowId: intent.windowId as never,
    bindingId: parseWakeflowWindowHostBindingId(registered.binding.bindingId),
    holder: {
      demandId: createWakeflowDurableId("demand"),
      targetTaskId: createWakeflowDurableId("target-task"),
      deliveryId: createWakeflowDurableId("target-delivery"),
      generation: 1,
    },
    claimedAt: parseUtcInstant("2026-09-04T10:05:00.000Z"),
  });
  await takeWorkClaim(rooted, claim);
  const release = {
    root,
    operation: "release-claim",
    windowId: intent.windowId,
    expectedClaimDigest: claim.claimDigest,
    evidence: { liveness: { kind: "unobserved" } },
  };
  // 旧的 end 记录不是"持有窗口已消失"：活声明不能被它释放。
  await expectFailure(
    executeWindowBindingRequest(CLAUDE, release, { clock }),
    "precondition-failed",
    "claim-active",
  );
  // 会话再次结束，且晚于最新的 start：恢复门打开。
  await sessionEnd(
    rooted,
    "claude-code",
    sessionId,
    placement,
    parseUtcInstant("2026-09-04T10:08:00.000Z"),
  );
  const released = await executeWindowBindingRequest(CLAUDE, release, { clock });
  if (released.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(released.disposition, "claim-released");
  equal(released.claim?.claimId, claim.claimId);
});

interface DesktopExecution {
  readonly kind: string;
  readonly sessionIdPolicy: string;
  readonly arguments: readonly string[];
  readonly desktop: { readonly title: string; readonly cwd: string };
}

interface LocatorFile {
  readonly provider: string;
  readonly bindingId: string;
  readonly locatorId: string;
  readonly desktop?: { readonly sessionId: string };
  readonly tmux?: unknown;
}

test("Claude Code 桌面传输（ADR-0025 D3）：register 要桌面会话 id 并写桌面定位器，tmux 坐标报 locator-kind-mismatch，relocate 不适用，decommission 凭 desktop-sessions 清单与 session-end 证据机器核实", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeClaudeCodeWakeflowMaintenance);
  const windowId = intents[0]?.windowId;
  if (windowId === undefined) throw new Error("Expected a launch intent.");
  const clock = () => parseUtcInstant("2026-10-30T10:00:00.000Z");
  const inspected = await executeWindowBindingRequest(
    CLAUDE_DESKTOP,
    { root, operation: "inspect", windowId },
    { clock },
  );
  if (inspected.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  equal(inspected.locator.status, "absent");
  const execution = inspected.launchIntent.execution as unknown as DesktopExecution;
  equal(execution.kind, "claude-code-desktop");
  equal(execution.sessionIdPolicy, "host-assigned");
  equal(execution.arguments.includes("--session-id"), false);
  equal(execution.desktop.title, inspected.launchIntent.displayTitle);
  equal(execution.desktop.cwd, inspected.launchIntent.root.configuredPlacement);
  const placement = inspected.launchIntent.root.configuredPlacement;
  const sessionId = "3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d";
  const base = {
    handle: { kind: "claude-session", value: sessionId },
    launchIntentDigest: inspected.launchIntent.intentDigest,
    observedAt: "2026-10-30T09:59:00.000Z",
  };
  await sessionStart(
    rooted,
    "claude-code",
    sessionId,
    placement,
    parseUtcInstant("2026-10-30T09:58:00.000Z"),
  );
  const register = (observation: Record<string, unknown>) =>
    executeWindowBindingRequest(
      CLAUDE_DESKTOP,
      { root, operation: "register", windowId, observation },
      { clock },
    );
  await expectFailure(register(base), "invalid-request", "desktop-session-required");
  const tmux = { socketName: null, sessionName: "wakeflow", windowId: "@3", paneId: "%7" };
  await expectFailure(register({ ...base, tmux }), "invalid-request", "locator-kind-mismatch");
  const desktop = { sessionId: `local_${sessionId}` };
  await expectFailure(
    register({ ...base, tmux, desktop }),
    "invalid-request",
    "locator-kind-mismatch",
  );
  // 桌面 id 必须是 local_ 前缀的会话 UUID：裸会话 id 在 Schema 就被拒。
  await expectFailure(register({ ...base, desktop: { sessionId } }), "invalid-request", "schema");
  const registered = await register({ ...base, desktop });
  if (registered.kind !== "WakeflowWindowBindingMutation" || registered.binding === null)
    throw new Error("Expected a mutation.");
  equal(registered.disposition, "registered");
  equal(JSON.stringify(registered).includes(sessionId), false, "session or desktop id leaked");
  const locatorFile = path.join(
    root,
    ".wakeflow-local/runtime/hosts/claude-code/identity/window-locators",
    `${windowId}.json`,
  );
  equal(statSync(locatorFile).mode & 0o777, 0o600);
  const locator = JSON.parse(readFileSync(locatorFile, "utf8")) as LocatorFile;
  equal(locator.provider, "desktop");
  deepEqual(locator.desktop, desktop);
  equal("tmux" in locator, false);
  equal(locator.bindingId, registered.binding.bindingId);
  const present = await executeWindowBindingRequest(
    CLAUDE_DESKTOP,
    { root, operation: "inspect", windowId },
    { clock },
  );
  if (present.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  equal(present.locator.status, "present");
  equal(JSON.stringify(present).includes(desktop.sessionId), false, "desktop id leaked");
  const replayed = await register({ ...base, desktop });
  if (replayed.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(replayed.disposition, "replayed");

  await expectFailure(
    executeWindowBindingRequest(
      CLAUDE_DESKTOP,
      {
        root,
        operation: "relocate",
        windowId,
        observation: { ...base, desktop },
        expectedBindingId: registered.binding.bindingId,
        expectedBindingDigest: registered.binding.bindingDigest,
      },
      { clock },
    ),
    "precondition-failed",
    "relocate-not-applicable",
  );

  const expectation = {
    expectedBindingId: registered.binding.bindingId,
    expectedBindingDigest: registered.binding.bindingDigest,
  };
  const row = { sessionId, status: "idle", cwd: null, name: "Controller", pid: 4242 };
  const decommission = (preClose: unknown, postClose: unknown, expected = expectation) =>
    executeWindowBindingRequest(
      CLAUDE_DESKTOP,
      {
        root,
        operation: "decommission",
        windowId,
        ...expected,
        closure: { preClose, closeResult: { status: "closed" }, postClose },
      },
      { clock },
    );
  await expectFailure(
    decommission(
      { kind: "desktop-sessions", sessions: [row] },
      { kind: "desktop-sessions", sessions: [{ ...row, status: "busy" }] },
    ),
    "precondition-failed",
    "closure-blocked",
  );
  const manual = await decommission(
    { kind: "desktop-sessions", sessions: [row] },
    {
      kind: "desktop-sessions",
      sessions: [{ ...row, sessionId: "4e4e4e4e-4e4e-4e4e-8e4e-4e4e4e4e4e4e" }],
    },
  );
  if (manual.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(manual.disposition, "decommissioned");
  equal(manual.verification, "manual-host-gate", "no session-end record yet");
  equal(existsSync(locatorFile), false, "the desktop locator is retired with the binding");

  const second = "5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f";
  await sessionStart(
    rooted,
    "claude-code",
    second,
    placement,
    parseUtcInstant("2026-10-30T10:01:00.000Z"),
  );
  const again = await register({
    ...base,
    handle: { kind: "claude-session", value: second },
    desktop: { sessionId: `local_${second}` },
    observedAt: "2026-10-30T10:02:00.000Z",
  });
  if (again.kind !== "WakeflowWindowBindingMutation" || again.binding === null)
    throw new Error("Expected a mutation.");
  deepEqual((JSON.parse(readFileSync(locatorFile, "utf8")) as LocatorFile).desktop, {
    sessionId: `local_${second}`,
  });
  // tmux pane 清单对桌面定位器什么也证明不了：既不算活也不算缺席，退役走人工门而不是被挡。
  const unmatched = await decommission(
    { kind: "tmux-panes", panes: [] },
    { kind: "tmux-panes", panes: [] },
    {
      expectedBindingId: again.binding.bindingId,
      expectedBindingDigest: again.binding.bindingDigest,
    },
  );
  if (unmatched.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(unmatched.verification, "manual-host-gate");

  const third = "6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a";
  await sessionStart(
    rooted,
    "claude-code",
    third,
    placement,
    parseUtcInstant("2026-10-30T10:03:00.000Z"),
  );
  const final = await register({
    ...base,
    handle: { kind: "claude-session", value: third },
    desktop: { sessionId: `local_${third}` },
    observedAt: "2026-10-30T10:04:00.000Z",
  });
  if (final.kind !== "WakeflowWindowBindingMutation" || final.binding === null)
    throw new Error("Expected a mutation.");
  await writeHostHookObservation(rooted, {
    hostId: "claude-code",
    event: "session-end",
    sessionId: third,
    cwd: path.resolve(root, placement),
    recordedAt: parseUtcInstant("2026-10-30T10:05:00.000Z"),
  });
  const verified = await decommission(
    { kind: "desktop-sessions", sessions: [{ sessionId: third, status: "idle" }] },
    { kind: "desktop-sessions", sessions: [] },
    {
      expectedBindingId: final.binding.bindingId,
      expectedBindingDigest: final.binding.bindingDigest,
    },
  );
  if (verified.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(verified.verification, "machine-verified");
  equal(JSON.stringify(verified).includes(third), false, "session id leaked");
});

test("Claude Code 桌面传输：replace 以新会话与新桌面 id 换代并整体重写桌面定位器，缺桌面 id 的 replace 被拒", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intents } = await fixture(t, executeClaudeCodeWakeflowMaintenance);
  const windowId = intents[0]?.windowId;
  if (windowId === undefined) throw new Error("Expected a launch intent.");
  let now = parseUtcInstant("2026-10-30T10:00:00.000Z");
  const clock = () => now;
  const inspected = await executeWindowBindingRequest(
    CLAUDE_DESKTOP,
    { root, operation: "inspect", windowId },
    { clock },
  );
  if (inspected.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  const placement = inspected.launchIntent.root.configuredPlacement;
  const first = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";
  const second = "8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c";
  for (const sessionId of [first, second]) {
    await sessionStart(
      rooted,
      "claude-code",
      sessionId,
      placement,
      parseUtcInstant("2026-10-30T09:58:00.000Z"),
    );
  }
  const observation = {
    handle: { kind: "claude-session", value: first },
    launchIntentDigest: inspected.launchIntent.intentDigest,
    observedAt: "2026-10-30T09:59:00.000Z",
    desktop: { sessionId: `local_${first}` },
  };
  const registered = await executeWindowBindingRequest(
    CLAUDE_DESKTOP,
    { root, operation: "register", windowId, observation },
    { clock },
  );
  if (registered.kind !== "WakeflowWindowBindingMutation" || registered.binding === null)
    throw new Error("Expected a mutation.");
  const locatorFile = path.join(
    root,
    ".wakeflow-local/runtime/hosts/claude-code/identity/window-locators",
    `${windowId}.json`,
  );
  const before = JSON.parse(readFileSync(locatorFile, "utf8")) as LocatorFile;
  const expectation = {
    expectedBindingId: registered.binding.bindingId,
    expectedBindingDigest: registered.binding.bindingDigest,
  };
  const { desktop: _desktop, ...withoutDesktop } = observation;
  await expectFailure(
    executeWindowBindingRequest(
      CLAUDE_DESKTOP,
      {
        root,
        operation: "replace",
        windowId,
        observation: { ...withoutDesktop, handle: { kind: "claude-session", value: second } },
        ...expectation,
      },
      { clock },
    ),
    "invalid-request",
    "desktop-session-required",
  );
  now = parseUtcInstant("2026-10-30T10:01:00.000Z");
  const replaced = await executeWindowBindingRequest(
    CLAUDE_DESKTOP,
    {
      root,
      operation: "replace",
      windowId,
      observation: {
        ...observation,
        handle: { kind: "claude-session", value: second },
        desktop: { sessionId: `local_${second}` },
        observedAt: "2026-10-30T10:00:30.000Z",
      },
      ...expectation,
    },
    { clock, uuidFactory: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
  );
  if (replaced.kind !== "WakeflowWindowBindingMutation" || replaced.binding === null)
    throw new Error("Expected a mutation.");
  equal(replaced.disposition, "replaced");
  equal(replaced.binding.bindingId, "window_binding_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  const after = JSON.parse(readFileSync(locatorFile, "utf8")) as LocatorFile;
  equal(after.provider, "desktop");
  deepEqual(after.desktop, { sessionId: `local_${second}` });
  equal(after.bindingId, replaced.binding.bindingId);
  equal(after.locatorId === before.locatorId, false, "the locator generation follows the binding");
  equal(readFileSync(locatorFile, "utf8").includes(first), false, "the old desktop id is gone");
  equal(JSON.stringify(replaced).includes(second), false, "session or desktop id leaked");
});

test("Claude Code 桌面传输经配置选择（ADR-0025 D1）：hosts.claude-code.windowTransport = desktop 的工作区让带传输表的门面选出桌面 profile，缺省工作区仍是 tmux", {
  timeout: 60_000,
}, async (t) => {
  const facade: WindowBindingHostFacade = {
    ...CLAUDE,
    transports: claudeCodeWorkspaceHostTransportTable,
  };
  const desktop = await fixture(t, executeClaudeCodeWakeflowMaintenance, {
    "claude-code": { windowTransport: "desktop" },
  });
  const desktopIntent = desktop.intents[0];
  if (desktopIntent === undefined) throw new Error("Expected a launch intent.");
  const inspectedDesktop = await executeWindowBindingRequest(facade, {
    root: desktop.root,
    operation: "inspect",
    windowId: desktopIntent.windowId,
  });
  if (inspectedDesktop.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  equal((inspectedDesktop.launchIntent.execution as { kind: string }).kind, "claude-code-desktop");
  equal(
    inspectedDesktop.launchIntent.intentDigest,
    desktopIntent.intentDigest,
    "the Fresh preview and the endpoint compile the intent from the same selected profile",
  );
  const tmux = await fixture(t, executeClaudeCodeWakeflowMaintenance);
  const tmuxIntent = tmux.intents[0];
  if (tmuxIntent === undefined) throw new Error("Expected a launch intent.");
  const inspectedTmux = await executeWindowBindingRequest(facade, {
    root: tmux.root,
    operation: "inspect",
    windowId: tmuxIntent.windowId,
  });
  if (inspectedTmux.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  equal((inspectedTmux.launchIntent.execution as { kind: string }).kind, "claude-code");
  equal(inspectedTmux.launchIntent.intentDigest, tmuxIntent.intentDigest);
});
