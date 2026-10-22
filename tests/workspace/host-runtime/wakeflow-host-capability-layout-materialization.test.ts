import { equal } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { materializeDirectoryPath } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  ensureWakeflowHostCapabilityLayout,
  inspectWakeflowHostCapabilityLayout,
  materializeWakeflowHostCapabilityLayout,
  WakeflowHostCapabilityLayoutMaterializationError,
  type WakeflowHostCapabilityLayoutMaterializationErrorReason,
} from "../../../src/workspace/host-runtime/wakeflow-host-capability-layout-materialization.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

async function fixture(t: TestContext, profile: unknown) {
  const absolutePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-host-capability-layout-"));
  const root = await RootedDirectory.open(absolutePath);
  await materializeDirectoryPath(root, parsePortableResourcePath(".wakeflow-local/runtime"), {
    mode: 0o700,
  });
  await publishFreshWakeflowWindowRuntime(root, createMinimalWakeflowConfig(), profile, {
    recoveringFreshPublication: false,
  });
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

async function expectLayoutError(
  action: () => Promise<unknown>,
  reason: WakeflowHostCapabilityLayoutMaterializationErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowHostCapabilityLayoutMaterializationError, true);
  if (caught instanceof WakeflowHostCapabilityLayoutMaterializationError) {
    equal(caught.reason, reason);
  }
}

test("Host capability layout creates only profile-applicable empty directories", async (t) => {
  const codex = await fixture(t, codexWorkspaceHostResourceProfile);
  const created = await materializeWakeflowHostCapabilityLayout(
    codex.root,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshLayout: false },
  );
  // 复审 J5：Codex 只有 pod 回执目录；没有 operations，也没有无人使用的 keep-live 目录。
  equal(created.createdDirectoryCount, 1);
  const codexHost = path.join(codex.absolutePath, ".wakeflow-local/runtime/hosts/codex");
  equal(readdirSync(path.join(codexHost, "pods")).length, 0);
  equal(existsSync(path.join(codexHost, "operations")), false);
  await expectLayoutError(
    () =>
      materializeWakeflowHostCapabilityLayout(codex.root, codexWorkspaceHostResourceProfile, {
        recoveringFreshLayout: false,
      }),
    "strict-absent",
  );
  equal(
    (
      await materializeWakeflowHostCapabilityLayout(codex.root, codexWorkspaceHostResourceProfile, {
        recoveringFreshLayout: true,
      })
    ).disposition,
    "current",
  );

  const claude = await fixture(t, claudeCodeWorkspaceHostResourceProfile);
  const claudeCreated = await materializeWakeflowHostCapabilityLayout(
    claude.root,
    claudeCodeWorkspaceHostResourceProfile,
    { recoveringFreshLayout: false },
  );
  // pods、operations、operations/assets；定位器目录在 identity 下，由 locator store 首次登记时创建（J5）。
  equal(claudeCreated.createdDirectoryCount, 3);
  const claudeHost = path.join(claude.absolutePath, ".wakeflow-local/runtime/hosts/claude-code");
  equal(readdirSync(path.join(claudeHost, "operations", "assets")).length, 0);
  equal(existsSync(path.join(claudeHost, "identity", "window-locators")), false);
  for (const retired of [
    "operations/window-locators",
    "operations/keep-live",
    "operations/activity-monitor",
    "operations/temp",
  ]) {
    equal(existsSync(path.join(claudeHost, retired)), false, `${retired} is not declared`);
  }
});

test("Host capability recovery fills an exact prefix and preserves foreign resources", async (t) => {
  const value = await fixture(t, codexWorkspaceHostResourceProfile);
  await materializeWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, {
    recoveringFreshLayout: false,
  });
  const hostRoot = path.join(value.absolutePath, ".wakeflow-local/runtime/hosts/codex");
  rmdirSync(path.join(hostRoot, "pods"));
  const recovered = await materializeWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshLayout: true },
  );
  equal(recovered.createdDirectoryCount, 1);

  const foreign = path.join(hostRoot, "pods", "foreign.json");
  writeFileSync(foreign, "{}\n", { mode: 0o600 });
  await expectLayoutError(
    () =>
      materializeWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, {
        recoveringFreshLayout: true,
      }),
    "prefix-conflict",
  );
  equal(readdirSync(path.dirname(foreign)).includes("foreign.json"), true);
});

test("Host capability inspection and ensure ignore live contents and only repair missing directories", async (t) => {
  const value = await fixture(t, codexWorkspaceHostResourceProfile);
  await materializeWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, {
    recoveringFreshLayout: false,
  });
  const codexHost = path.join(value.absolutePath, ".wakeflow-local/runtime/hosts/codex");
  const pods = path.join(codexHost, "pods");
  // 运行中的工作区：pod 回执目录与其中的文件都不是冲突；检查只看声明的目录本身。
  mkdirSync(path.join(pods, "pod_x"), { mode: 0o700 });
  writeFileSync(path.join(pods, "pod_x", "receipt.json"), "{}\n", { mode: 0o600 });
  const live = await inspectWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
  );
  equal(live.status, "current");
  equal(live.missingDirectoryCount, 0);
  equal(
    (await ensureWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile))
      .disposition,
    "current",
  );

  rmSync(pods, { recursive: true });
  const incomplete = await inspectWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
  );
  equal(incomplete.status, "incomplete");
  equal(incomplete.missingDirectoryCount, 1);
  const ensured = await ensureWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
  );
  equal(ensured.disposition, "created");
  equal(ensured.createdDirectoryCount, 1);
  equal(statSync(pods).mode & 0o777, 0o700);
  equal(
    readdirSync(path.join(codexHost, "identity")).length > 0,
    true,
    "ensure must not touch siblings",
  );
  equal(
    (await inspectWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile))
      .status,
    "current",
  );

  // 声明位置被普通文件占用：只报告，ensure 拒绝。
  rmSync(pods, { recursive: true });
  writeFileSync(pods, "not a directory\n");
  equal(
    (await inspectWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile))
      .status,
    "conflict",
  );
  await expectLayoutError(
    () => ensureWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile),
    "prefix-conflict",
  );

  // 宿主运行时根缺失：只报告前置缺失，ensure 拒绝。
  rmSync(codexHost, { recursive: true });
  equal(
    (await inspectWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile))
      .status,
    "prerequisite-missing",
  );
  await expectLayoutError(
    () => ensureWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile),
    "prerequisite",
  );
});

test("Host capability layout maps an already-aborted signal to aborted", async (t) => {
  const value = await fixture(t, codexWorkspaceHostResourceProfile);
  const controller = new AbortController();
  controller.abort();
  const { signal } = controller;
  await expectLayoutError(
    () =>
      materializeWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, {
        recoveringFreshLayout: false,
        signal,
      }),
    "aborted",
  );
  await expectLayoutError(
    () =>
      ensureWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, { signal }),
    "aborted",
  );
  await expectLayoutError(
    () =>
      inspectWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, {
        signal,
      }),
    "aborted",
  );
  const codexHost = path.join(value.absolutePath, ".wakeflow-local/runtime/hosts/codex");
  equal(
    existsSync(path.join(codexHost, "pods")),
    false,
    "an aborted run must not create directories",
  );
});

test("Host capability fresh layout refuses a foreign entry under the host runtime root", async (t) => {
  const value = await fixture(t, codexWorkspaceHostResourceProfile);
  const codexHost = path.join(value.absolutePath, ".wakeflow-local/runtime/hosts/codex");
  const foreign = path.join(codexHost, "foreign");
  mkdirSync(foreign, { mode: 0o700 });
  await expectLayoutError(
    () =>
      materializeWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, {
        recoveringFreshLayout: false,
      }),
    "prefix-conflict",
  );
  equal(existsSync(foreign), true, "the foreign entry must be left untouched");
  equal(existsSync(path.join(codexHost, "pods")), false);
});
