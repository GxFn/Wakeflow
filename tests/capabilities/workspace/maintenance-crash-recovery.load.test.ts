import { deepEqual, equal, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import { startSyncCrashProcess } from "../../support/sync-crash-process.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

/**
 * 级别 2（能力），真实进程：维护 apply 在各个落盘点被 SIGKILL（open-items B9）。
 *
 * 此前真实进程的中断只覆盖追加与看板锁；维护事务的恢复只有同进程里注入的中断。这里起一个真实的 MCP 服务，
 * 在 reconfigure 的 apply 进行到维护门与事务目录的第 N 次落盘时杀掉它，然后只用公共工具收场：status 必须
 * 说出它不是 idle，一次公共调用——有可恢复的操作就 recover 它，没有就 reconcile——之后工作区回到 idle，
 * 配置要么是旧的要么是新的，原来的请求能再做一遍。逐点往后扫，直到 apply 在屏障之前就完成为止。
 *
 * 屏障落在父目录同步之后，所以"暂存已链接、尚未退役"的点是真实跑出来的；"暂存已写好、尚未链接"的点
 * 在同一处把目标名删掉得到（磁盘上的名字、字节与已死的属主都和真死在链接之前一样）。
 *
 * 这份矩阵第一次跑就找出三条没有公共出口的死路（§13.242）：journal 的暂存挡住 intent 的恢复；门锁已拿、
 * intent 未发布时没有 operation ID 可恢复；门锁自己的暂存还链接着时锁退役必然失败。
 */

// 本进程里的初始化、收场与重做不付 fsync；被杀的是另起的真实 MCP 进程，它照生产的耐久性落盘，屏障就挂在
// 它的父目录同步上。SIGKILL 不丢页缓存，所以这里验证的是各步的先后，不是掉电。
useDisposableDurability();

/** 维护门（`maintenance.lock`）与事务目录（`maintenance/transactions/`）下的每一次落盘。 */
const DURABLE_POINT_FRAGMENT = "/.wakeflow-local/runtime/maintenance";
const STAGE_PREFIX = ".wakeflow-atomic-";

function git(cwd: string, ...args: readonly string[]): void {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/** 初始化一次的基线工作区（连兄弟产品仓库）；每个落盘点复制一份，不重跑 fresh-initialize。 */
async function baselineWorkspace(t: TestContext): Promise<string> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintenance-crash-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Workspace");
  const product = path.join(base, "ProductA");
  mkdirSync(root);
  mkdirSync(product);
  git(root, "init", "--quiet");
  git(product, "init", "--quiet", "--initial-branch=main");
  git(product, "commit", "--quiet", "--allow-empty", "-m", "init");
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const request = { root, action: "fresh-initialize", request: { selection } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...request, mode: "preview" });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready fresh plan.");
  }
  await executeCodexWakeflowMaintenance({
    ...request,
    mode: "apply",
    planDigest: preview.planDigest,
  });
  return base;
}

/** 基线的一份副本；`fs.cp` 按 umask 新建目录，私有目录的权限位按源对齐。 */
function copyOfBaseline(t: TestContext, baseline: string): string {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintenance-crash-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  cpSync(baseline, base, { recursive: true, preserveTimestamps: true });
  const align = (source: string, destination: string): void => {
    chmodSync(destination, lstatSync(source).mode & 0o7777);
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        align(path.join(source, entry.name), path.join(destination, entry.name));
      }
    }
  };
  align(baseline, base);
  return path.join(base, "Workspace");
}

function displayNameOf(root: string): string {
  const config = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")) as {
    program: { displayName: string };
  };
  return config.program.displayName;
}

/** 给公共调用的失败带上是哪个落盘点、哪一步。 */
async function step<Result>(label: string, call: () => Promise<Result>): Promise<Result> {
  try {
    return await call();
  } catch (error: unknown) {
    const record = (typeof error === "object" && error !== null ? error : {}) as {
      code?: unknown;
      reason?: unknown;
      cause?: { reason?: unknown; path?: unknown };
    };
    throw new Error(
      `${label}: ${JSON.stringify({
        code: record.code,
        reason: record.reason,
        cause: record.cause === undefined ? null : [record.cause.reason, record.cause.path],
      })}`,
    );
  }
}

interface KilledRun {
  readonly root: string;
  readonly before: string;
  readonly after: string;
  readonly request: Readonly<{
    root: string;
    action: "reconfigure";
    request: { desiredConfig: unknown };
  }>;
  readonly reached: boolean;
}

/** 复制一份基线，预览一次改名的 reconfigure，在第 `occurrence` 个落盘点杀掉正在 apply 的真实 MCP。 */
async function killAt(
  t: TestContext,
  baseline: string,
  occurrence: number,
  label: string,
): Promise<KilledRun> {
  const root = copyOfBaseline(t, baseline);
  const before = displayNameOf(root);
  const desired = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")) as {
    program: { displayName: string };
  };
  desired.program.displayName = `Renamed at ${label}`;
  const request = { root, action: "reconfigure", request: { desiredConfig: desired } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...request, mode: "preview" });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready reconfigure plan.");
  }
  const marker = path.join(path.dirname(root), "barrier");
  const server = await startSyncCrashProcess(marker, DURABLE_POINT_FRAGMENT, occurrence);
  let reached: boolean;
  try {
    const applying = server.client
      .callTool({
        name: "wakeflow_maintain_workspace",
        arguments: { ...request, mode: "apply", planDigest: preview.planDigest },
      })
      .catch((error: unknown) => error);
    reached = await server.paused(applying);
    if (reached) server.crash();
    await applying;
  } finally {
    await server.close();
  }
  return { root, before, after: desired.program.displayName, request, reached };
}

function runtimeDirectories(root: string): readonly string[] {
  const runtime = path.join(root, ".wakeflow-local", "runtime");
  return [runtime, path.join(runtime, "maintenance", "transactions")];
}

/** 已链接、尚未退役的暂存所对应的目标（与暂存同一个 inode 的那个名字）；没有则为空。 */
function linkedStageTargets(root: string): readonly string[] {
  const targets: string[] = [];
  for (const directory of runtimeDirectories(root)) {
    const names = readdirSync(directory);
    for (const stage of names.filter((name) => name.startsWith(STAGE_PREFIX))) {
      const node = statSync(path.join(directory, stage));
      if (node.nlink !== 2) continue;
      const target = names.find(
        (name) =>
          !name.startsWith(STAGE_PREFIX) && statSync(path.join(directory, name)).ino === node.ino,
      );
      if (target !== undefined) targets.push(path.join(directory, target));
    }
  }
  return targets;
}

/** 已经把原请求再做过一遍的收场路径。 */
const REDONE_ROUTES = new Set<string>();

/**
 * 进程死了之后只用公共工具收场，返回走的是哪条路：`recover`（有可恢复的操作）、`reconcile`（门残留，
 * 没有操作可恢复）或 `none`（死在最后一次落盘之后，什么都不欠）。
 */
async function closeOut(run: Readonly<KilledRun>, label: string): Promise<string> {
  // 配置非旧即新，从不是半份。
  const current = displayNameOf(run.root);
  ok(current === run.before || current === run.after, `config at ${label}`);
  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root: run.root });
  const residues = status.maintenance.residues as readonly {
    readonly operationId: string | null;
    readonly recoverable: boolean;
  }[];
  const recoverable = residues.find((entry) => entry.recoverable && entry.operationId !== null);
  let route = "none";
  if (recoverable?.operationId != null) {
    const operationId = recoverable.operationId;
    const recovered = await step(`recover at ${label}`, () =>
      executeCodexWakeflowMaintenance({ root: run.root, mode: "recover", operationId }),
    );
    equal(recovered.mode, "recover", `recover at ${label}`);
    route = "recover";
  } else if (status.maintenance.protocol !== "idle") {
    equal(status.next.frontier, "workspace-maintenance", `status at ${label}`);
    const reconcile = { root: run.root, action: "reconcile", request: {} } as const;
    const plan = await step(`reconcile preview at ${label}`, () =>
      executeCodexWakeflowMaintenance({ ...reconcile, mode: "preview" }),
    );
    if (plan.mode !== "preview" || plan.planDigest === null) {
      throw new Error(`reconcile at ${label} is blocked: ${JSON.stringify(plan)}`);
    }
    equal(
      (plan.plan as { kind?: string } | null)?.kind,
      "WakeflowMaintenanceGateResiduePlan",
      `reconcile plan at ${label}`,
    );
    const planDigest = plan.planDigest;
    await step(`reconcile apply at ${label}`, () =>
      executeCodexWakeflowMaintenance({ ...reconcile, mode: "apply", planDigest }),
    );
    route = "reconcile";
  }
  const settled = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root: run.root });
  equal(settled.maintenance.protocol, "idle", `protocol after ${route} at ${label}`);
  deepEqual(settled.maintenance.residues, [], `residues after ${route} at ${label}`);
  for (const directory of runtimeDirectories(run.root)) {
    deepEqual(
      readdirSync(directory).filter((name) => name.startsWith(STAGE_PREFIX)),
      [],
      `stages after ${route} at ${label}`,
    );
  }
  // 原来的请求能再预览出一份就绪的计划；每条收场的路各把它真的再做一遍并做一次严格读（local-layout 门与
  // 上面逐点断言的协议状态出自同一份核心布局检查）。
  const again = await step(`re-preview at ${label}`, () =>
    executeCodexWakeflowMaintenance({ ...run.request, mode: "preview" }),
  );
  if (again.mode !== "preview") throw new Error("Expected a preview.");
  equal(again.status, "ready", `re-preview at ${label}: ${again.blockerCodes.join(",")}`);
  if (REDONE_ROUTES.has(route)) return route;
  REDONE_ROUTES.add(route);
  if (again.planDigest !== null) {
    const planDigest = again.planDigest;
    await step(`re-apply at ${label}`, () =>
      executeCodexWakeflowMaintenance({ ...run.request, mode: "apply", planDigest }),
    );
  }
  equal(displayNameOf(run.root), run.after, `config after redo at ${label}`);
  const verified = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root: run.root });
  equal(
    verified.gates.find((gate) => gate.name === "local-layout")?.status,
    "pass",
    `local-layout after ${label}`,
  );
  return route;
}

test("真实 MCP 在维护 apply 的各个落盘点死亡：status 说出残留，一次公共调用回到 idle，配置非旧即新，原请求可重做", {
  timeout: 600_000,
}, async (t) => {
  if (loadSensitive(t, "real MCP server processes killed at successive durable points")) return;
  const outcomes: string[] = [];
  const baseline = await baselineWorkspace(t);
  // 落盘点逐个扫；apply 在到达屏障之前就完成，说明后面已经没有这样的点了。
  for (let occurrence = 1; occurrence <= 40; occurrence += 1) {
    const run = await killAt(t, baseline, occurrence, `point ${occurrence}`);
    if (!run.reached) {
      equal(displayNameOf(run.root), run.after);
      outcomes.push(`${occurrence}:completed`);
      break;
    }
    const linked = linkedStageTargets(run.root).length > 0;
    outcomes.push(`${occurrence}:${await closeOut(run, `point ${occurrence}`)}`);
    if (!linked) continue;
    // 同一个点的另一半：暂存已写好、尚未链接到目标。
    const label = `point ${occurrence} before its link`;
    const rewound = await killAt(t, baseline, occurrence, label);
    equal(rewound.reached, true, label);
    const targets = linkedStageTargets(rewound.root);
    equal(targets.length > 0, true, label);
    for (const target of targets) unlinkSync(target);
    outcomes.push(`${occurrence}-:${await closeOut(rewound, label)}`);
  }
  t.diagnostic(`maintenance kill points: ${outcomes.join(" ")}`);
  // 扫到了"完整做完"，并且两条收场的路都真的走过。
  equal(outcomes.at(-1)?.endsWith(":completed"), true, outcomes.join(" "));
  for (const route of ["recover", "reconcile"]) {
    ok(
      outcomes.some((outcome) => outcome.endsWith(`:${route}`)),
      `${route}: ${outcomes.join(" ")}`,
    );
  }
});

test("首次初始化的 apply 死在协议根还没建好的那几步：没有配置也能由 reconcile 退役门残留，然后把初始化做完", {
  timeout: 300_000,
}, async (t) => {
  if (loadSensitive(t, "real MCP server processes killed during the first initialization")) return;
  // 前四个落盘点：门锁的链接、门锁暂存的退役、`maintenance` 与 `transactions` 两级目录的建立——都在 intent 之前。
  for (let occurrence = 1; occurrence <= 4; occurrence += 1) {
    const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintenance-crash-")));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const root = path.join(base, "Workspace");
    mkdirSync(root);
    git(root, "init", "--quiet");
    const selection = createMinimalWakeflowFreshConfigSelection();
    (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
    const fresh = { root, action: "fresh-initialize", request: { selection } } as const;
    const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
    if (preview.mode !== "preview" || preview.planDigest === null) {
      throw new Error("Expected a ready fresh plan.");
    }
    const label = `first-run point ${occurrence}`;
    const server = await startSyncCrashProcess(
      path.join(base, "barrier"),
      DURABLE_POINT_FRAGMENT,
      occurrence,
    );
    try {
      const applying = server.client
        .callTool({
          name: "wakeflow_maintain_workspace",
          arguments: { ...fresh, mode: "apply", planDigest: preview.planDigest },
        })
        .catch((error: unknown) => error);
      equal(await server.paused(applying), true, label);
      server.crash();
      await applying;
    } finally {
      await server.close();
    }
    // 什么权威内容都还没写下：没有配置，事务目录里没有 intent。
    equal(existsSync(path.join(root, "wakeflow.config.json")), false, label);
    const blocked = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
    if (blocked.mode !== "preview") throw new Error("Expected a preview.");
    equal(blocked.status, "blocked", label);
    const reconcile = { root, action: "reconcile", request: {} } as const;
    const plan = await step(`reconcile preview at ${label}`, () =>
      executeCodexWakeflowMaintenance({ ...reconcile, mode: "preview" }),
    );
    if (plan.mode !== "preview" || plan.planDigest === null) {
      throw new Error(`reconcile at ${label} is blocked: ${JSON.stringify(plan)}`);
    }
    equal(
      (plan.plan as { kind?: string } | null)?.kind,
      "WakeflowMaintenanceGateResiduePlan",
      label,
    );
    const planDigest = plan.planDigest;
    await step(`reconcile apply at ${label}`, () =>
      executeCodexWakeflowMaintenance({ ...reconcile, mode: "apply", planDigest }),
    );
    const again = await step(`fresh re-preview at ${label}`, () =>
      executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" }),
    );
    if (again.mode !== "preview" || again.planDigest === null) {
      throw new Error(`fresh-initialize at ${label} is still blocked: ${JSON.stringify(again)}`);
    }
    const freshDigest = again.planDigest;
    await step(`fresh re-apply at ${label}`, () =>
      executeCodexWakeflowMaintenance({ ...fresh, mode: "apply", planDigest: freshDigest }),
    );
    equal(existsSync(path.join(root, "wakeflow.config.json")), true, label);
    const settled = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root });
    equal(settled.maintenance.protocol, "idle", label);
  }
});
