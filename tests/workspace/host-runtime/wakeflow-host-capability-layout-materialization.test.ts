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
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  materializeDirectoryPath,
} from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  ensureWakeflowHostCapabilityLayout,
  inspectWakeflowHostCapabilityLayout,
  materializeWakeflowHostCapabilityLayout,
  WakeflowHostCapabilityLayoutMaterializationError,
  type WakeflowHostCapabilityLayoutMaterializationErrorReason,
} from "../../../src/workspace/host-runtime/wakeflow-host-capability-layout-materialization.js";
import {
  publishFreshWakeflowWindowRuntime,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import {
  createMinimalWakeflowConfig,
} from "../../configuration/wakeflow-config.fixture.js";

async function fixture(
  t: TestContext,
  profile: unknown,
) {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-host-capability-layout-",
  ));
  const root = await RootedDirectory.open(absolutePath);
  await materializeDirectoryPath(
    root,
    parsePortableResourcePath(".wakeflow-local/runtime"),
    { mode: 0o700 },
  );
  await publishFreshWakeflowWindowRuntime(
    root,
    createMinimalWakeflowConfig(),
    profile,
    { recoveringFreshPublication: false },
  );
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
  equal(created.createdDirectoryCount, 4);
  const codexHost = path.join(
    codex.absolutePath,
    ".wakeflow-local/runtime/hosts/codex",
  );
  equal(readdirSync(path.join(codexHost, "pods")).length, 0);
  equal(readdirSync(path.join(
    codexHost,
    "operations",
    "keep-live",
    "leases",
  )).length, 0);
  await expectLayoutError(
    () => materializeWakeflowHostCapabilityLayout(
      codex.root,
      codexWorkspaceHostResourceProfile,
      { recoveringFreshLayout: false },
    ),
    "strict-absent",
  );
  equal((await materializeWakeflowHostCapabilityLayout(
    codex.root,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshLayout: true },
  )).disposition, "current");

  const claude = await fixture(t, claudeCodeWorkspaceHostResourceProfile);
  const claudeCreated = await materializeWakeflowHostCapabilityLayout(
    claude.root,
    claudeCodeWorkspaceHostResourceProfile,
    { recoveringFreshLayout: false },
  );
  equal(claudeCreated.createdDirectoryCount, 9);
  const claudeHost = path.join(
    claude.absolutePath,
    ".wakeflow-local/runtime/hosts/claude-code",
  );
  for (const relative of [
    "operations/window-locators",
    "operations/assets",
    "operations/activity-monitor",
    "operations/temp/prompts",
  ]) {
    equal(readdirSync(path.join(claudeHost, relative)).length, 0);
  }
});

test("Host capability recovery fills an exact prefix and preserves foreign resources", async (t) => {
  const value = await fixture(t, codexWorkspaceHostResourceProfile);
  await materializeWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshLayout: false },
  );
  const hostRoot = path.join(
    value.absolutePath,
    ".wakeflow-local/runtime/hosts/codex",
  );
  rmdirSync(path.join(hostRoot, "operations", "keep-live", "leases"));
  const recovered = await materializeWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshLayout: true },
  );
  equal(recovered.createdDirectoryCount, 1);

  const foreign = path.join(hostRoot, "pods", "foreign.json");
  writeFileSync(foreign, "{}\n", { mode: 0o600 });
  await expectLayoutError(
    () => materializeWakeflowHostCapabilityLayout(
      value.root,
      codexWorkspaceHostResourceProfile,
      { recoveringFreshLayout: true },
    ),
    "prefix-conflict",
  );
  equal(readdirSync(path.dirname(foreign)).includes("foreign.json"), true);
});

test("Host capability inspection and ensure ignore live contents and only repair missing directories", async (t) => {
  const value = await fixture(t, codexWorkspaceHostResourceProfile);
  await materializeWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshLayout: false },
  );
  const codexHost = path.join(value.absolutePath, ".wakeflow-local/runtime/hosts/codex");
  const leases = path.join(codexHost, "operations", "keep-live", "leases");
  // 运行中的工作区：租约文件与 pod 回执目录都不是冲突。
  writeFileSync(path.join(leases, "lease.json"), "{}\n", { mode: 0o600 });
  mkdirSync(path.join(codexHost, "pods", "pod_x"), { mode: 0o700 });
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

  rmSync(path.join(codexHost, "operations", "keep-live"), { recursive: true });
  const incomplete = await inspectWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
  );
  equal(incomplete.status, "incomplete");
  equal(incomplete.missingDirectoryCount, 2);
  const ensured = await ensureWakeflowHostCapabilityLayout(
    value.root,
    codexWorkspaceHostResourceProfile,
  );
  equal(ensured.disposition, "created");
  equal(ensured.createdDirectoryCount, 2);
  equal(statSync(leases).mode & 0o777, 0o700);
  equal(existsSync(path.join(codexHost, "pods", "pod_x")), true, "ensure must not touch siblings");
  equal(
    (await inspectWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile)).status,
    "current",
  );

  // 声明位置被普通文件占用：只报告，ensure 拒绝。
  rmSync(path.join(codexHost, "operations", "keep-live"), { recursive: true });
  writeFileSync(path.join(codexHost, "operations", "keep-live"), "not a directory\n");
  equal(
    (await inspectWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile)).status,
    "conflict",
  );
  await expectLayoutError(
    () => ensureWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile),
    "prefix-conflict",
  );

  // 宿主运行时根缺失：只报告前置缺失，ensure 拒绝。
  rmSync(codexHost, { recursive: true });
  equal(
    (await inspectWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile)).status,
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
    () => materializeWakeflowHostCapabilityLayout(
      value.root,
      codexWorkspaceHostResourceProfile,
      { recoveringFreshLayout: false, signal },
    ),
    "aborted",
  );
  await expectLayoutError(
    () => ensureWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, { signal }),
    "aborted",
  );
  await expectLayoutError(
    () => inspectWakeflowHostCapabilityLayout(value.root, codexWorkspaceHostResourceProfile, { signal }),
    "aborted",
  );
  const codexHost = path.join(value.absolutePath, ".wakeflow-local/runtime/hosts/codex");
  equal(existsSync(path.join(codexHost, "pods")), false, "an aborted run must not create directories");
});

test("Host capability fresh layout refuses a foreign entry under the host runtime root", async (t) => {
  const value = await fixture(t, codexWorkspaceHostResourceProfile);
  const codexHost = path.join(value.absolutePath, ".wakeflow-local/runtime/hosts/codex");
  const foreign = path.join(codexHost, "foreign");
  mkdirSync(foreign, { mode: 0o700 });
  await expectLayoutError(
    () => materializeWakeflowHostCapabilityLayout(
      value.root,
      codexWorkspaceHostResourceProfile,
      { recoveringFreshLayout: false },
    ),
    "prefix-conflict",
  );
  equal(existsSync(foreign), true, "the foreign entry must be left untouched");
  equal(existsSync(path.join(codexHost, "pods")), false);
});
