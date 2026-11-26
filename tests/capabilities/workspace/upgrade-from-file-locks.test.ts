import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { withWorkspaceOperationScope } from "../../../src/kernel/workspace-operation-scope.js";
import { createWakeflowGitignoreBodyAuthority } from "../../../src/workspace/managed-integration/wakeflow-gitignore-body-authority.js";
import { recomposeWakeflowManagedTextEnvelope } from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import { WAKEFLOW_GITIGNORE_BODY_HISTORY } from "../../../src/workspace/managed-integration/wakeflow-managed-text-history.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

/**
 * 级别 2（能力）：从文件锁的版本（1.4.3 及之前）更新上来的工作区（ADR-0033 决定 10）。
 *
 * 那些版本把锁放在工作区各处：私有运行目录里的准入目录与 pod 锁目录、看板与 Demand 发布各自的 `locks/`、
 * 工作区根上的四个锁文件；托管的 `.gitignore` 块逐一忽略根上的那四个。这里把一个初始化好的工作区摆回
 * 那个样子，钉住更新的路径：维护之前别的命令指向维护，一次 reconcile 之后旧的目录与文件都不在了。
 */

useDisposableDurability();

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

const LEGACY_DIRECTORIES = [
  ".wakeflow-local/runtime/operation-admission",
  ".wakeflow-local/runtime/pod-mutations",
  ".wakeflow-active/current/board/locks",
  ".wakeflow-active/current/demand-publication/locks",
] as const;

/** 只在持有者死掉之后才会留下的旧锁文件。 */
const LEGACY_FILES = [
  ".wakeflow-local/runtime/operation-admission/latch.lock",
  ".wakeflow-local/runtime/pod-mutations/main.lock",
  ".wakeflow-local/runtime/maintenance.lock",
  ".wakeflow-local/runtime/hosts/codex/identity/window-bindings/.registration.lock",
  ".wakeflow-active/projector.lock",
  ".wakeflow-active/current/board/locks/index.lock",
  ".wakeflow-active/current/demand-publication/locks/demand_00000000-0000-4000-8000-000000000000.lock",
  ".wakeflow-config-authority.lock",
  ".wakeflow-gitignore-recomposition.lock",
  ".wakeflow-program-instruction-codex.lock",
] as const;

function git(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

async function initializedWorkspace(t: TestContext): Promise<string> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-upgrade-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Workspace");
  mkdirSync(root);
  git(root, "init", "--quiet");
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
  return root;
}

/** 一份维护结果的计划里各步的标识；公共结果是冻结的空原型对象，先归一成普通 JSON。 */
function stepIds(result: unknown): readonly string[] {
  const plain = JSON.parse(JSON.stringify(result)) as {
    plan?: { steps?: readonly { stepId: string }[] } | null;
  };
  return (plain.plan?.steps ?? []).map((step) => step.stepId);
}

/** 把工作区摆回文件锁版本留下的样子。 */
function rewindToFileLocks(root: string): void {
  rmSync(path.join(root, ".wakeflow-local", "runtime", "locks"), { recursive: true });
  for (const directory of LEGACY_DIRECTORIES) {
    mkdirSync(path.join(root, directory), { recursive: true, mode: 0o700 });
  }
  for (const file of LEGACY_FILES) {
    writeFileSync(path.join(root, file), "{}\n", { mode: 0o600 });
  }
  const gitignorePath = path.join(root, ".gitignore");
  const current = createWakeflowGitignoreBodyAuthority(PROFILES);
  const body = WAKEFLOW_GITIGNORE_BODY_HISTORY[0]?.render(PROFILES);
  if (typeof body !== "string") throw new Error("Expected the file-lock era render.");
  const rewound = recomposeWakeflowManagedTextEnvelope(readFileSync(gitignorePath), {
    ...current.envelopeTarget,
    body,
  });
  equal(rewound.disposition, "updated");
  writeFileSync(gitignorePath, rewound.bytes, { mode: 0o644 });
}

test("文件锁版本留下的工作区：维护之前状态与拒绝都指向维护，一次 reconcile 补上锁目录并删掉旧的锁目录与锁文件", {
  timeout: 120_000,
}, async (t) => {
  const root = await initializedWorkspace(t);
  rewindToFileLocks(root);
  const gitignoreBefore = readFileSync(path.join(root, ".gitignore"), "utf8");
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  const enterScope = () => withWorkspaceOperationScope(rooted, "shared", async () => "entered");

  // 只读的观察照常回答并指向维护；要进操作作用域的命令被拒绝，原因也指向维护。
  const before = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root });
  deepEqual(
    [before.maintenance.protocol, before.next.frontier, before.next.suggestedTool],
    ["bootstrap-prefix", "workspace-maintenance", "wakeflow_maintain_workspace"],
  );
  const verified = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root });
  deepEqual(
    verified.gates.filter((gate) => gate.status === "fail").map((gate) => [gate.name, gate.code]),
    [["local-layout", "local:blocked,step:materialize-local-protocol"]],
  );
  await rejects(
    enterScope(),
    (error: unknown) => isWakeflowError(error) && error.reason === "operation-scope-missing",
  );

  const preview = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready reconcile plan.");
  }
  // 计划里只有补齐协议目录这一步，Controller 自己应用；预览不写盘。
  deepEqual(stepIds(preview), ["core:local-protocol"]);
  equal(preview.next.owner, "controller");
  equal(existsSync(path.join(root, ".wakeflow-local", "runtime", "locks")), false);
  await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    planDigest: preview.planDigest,
    request: {},
  });

  deepEqual(
    [...LEGACY_DIRECTORIES, ...LEGACY_FILES].filter((entry) => existsSync(path.join(root, entry))),
    [],
  );
  equal(git(root, "status", "--porcelain", "--", ".wakeflow-*").trim(), "");
  // 旧的托管块仍然满足今天的规则（多出四条忽略已经不存在的文件），所以不重写。
  equal(readFileSync(path.join(root, ".gitignore"), "utf8"), gitignoreBefore);
  const after = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root });
  equal(after.maintenance.protocol, "idle");
  equal(await enterScope(), "entered");
  // 清完之后再做一次对账：没有步骤。
  const again = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  deepEqual(stepIds(again), []);
});
