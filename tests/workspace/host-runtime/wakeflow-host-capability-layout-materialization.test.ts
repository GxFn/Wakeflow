import { equal } from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  rmdirSync,
  rmSync,
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
  materializeWakeflowHostCapabilityLayout,
  WakeflowHostCapabilityLayoutMaterializationError,
  type WakeflowHostCapabilityLayoutMaterializationErrorReason,
} from "../../../src/workspace/host-runtime/wakeflow-host-capability-layout-materialization.js";
import {
  publishFreshWakeflowWindowRuntime,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

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
    createMinimalWakeflowConfigV3(),
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
  equal(created.createdDirectoryCount, 5);
  const codexHost = path.join(
    codex.absolutePath,
    ".wakeflow-local/runtime/hosts/codex",
  );
  equal(readdirSync(path.join(codexHost, "evidence", "pods")).length, 0);
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
  equal(claudeCreated.createdDirectoryCount, 10);
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

  const foreign = path.join(hostRoot, "evidence", "pods", "foreign.json");
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
