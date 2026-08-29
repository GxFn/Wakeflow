import { equal } from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  publishFreshWakeflowWindowRuntime,
  WakeflowFreshWindowRuntimePublicationError,
  type WakeflowFreshWindowRuntimePublicationErrorReason,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import {
  parseWakeflowWindowRuntimeUnregisteredProjectionDocument,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-unregistered-projection.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-window-runtime-publication-",
  ));
  mkdirSync(path.join(absolutePath, ".wakeflow-local", "runtime"), {
    mode: 0o700,
    recursive: true,
  });
  chmodSync(path.join(absolutePath, ".wakeflow-local"), 0o700);
  chmodSync(path.join(absolutePath, ".wakeflow-local", "runtime"), 0o700);
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

async function expectPublicationError(
  action: () => Promise<unknown>,
  reason: WakeflowFreshWindowRuntimePublicationErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowFreshWindowRuntimePublicationError, true);
  if (caught instanceof WakeflowFreshWindowRuntimePublicationError) {
    equal(caught.reason, reason);
  }
}

test("Fresh Window Runtime publishes exact empty identity and unregistered projections", async (t) => {
  const value = await fixture(t);
  const config = createMinimalWakeflowConfigV3();
  const created = await publishFreshWakeflowWindowRuntime(
    value.root,
    config,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshPublication: false },
  );
  equal(created.disposition, "created");
  equal(created.createdDirectoryCount, 6);
  equal(created.createdProjectionCount, 4);

  const hostRoot = path.join(
    value.absolutePath,
    ".wakeflow-local",
    "runtime",
    "hosts",
    "codex",
  );
  const bindings = path.join(hostRoot, "identity", "window-bindings");
  const projections = path.join(hostRoot, "projections", "window-runtime");
  equal(readdirSync(bindings).length, 0);
  equal(readdirSync(projections).length, 4);
  for (const fileName of readdirSync(projections)) {
    const file = path.join(projections, fileName);
    equal(statSync(file).mode & 0o777, 0o600);
    const projection = parseWakeflowWindowRuntimeUnregisteredProjectionDocument(
      readFileSync(file, "utf8"),
    );
    equal(`${projection.windowId}.json`, fileName);
    equal(projection.identity.status, "unregistered");
  }

  await expectPublicationError(
    () => publishFreshWakeflowWindowRuntime(
      value.root,
      config,
      codexWorkspaceHostResourceProfile,
      { recoveringFreshPublication: false },
    ),
    "strict-absent",
  );
  const recovered = await publishFreshWakeflowWindowRuntime(
    value.root,
    config,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshPublication: true },
  );
  equal(recovered.disposition, "current");
  equal(recovered.createdDirectoryCount, 0);
  equal(recovered.createdProjectionCount, 0);
});

test("Fresh Window Runtime recovery fills missing exact files and rejects foreign identity", async (t) => {
  const value = await fixture(t);
  const config = createMinimalWakeflowConfigV3();
  await publishFreshWakeflowWindowRuntime(
    value.root,
    config,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshPublication: false },
  );
  const hostRoot = path.join(
    value.absolutePath,
    ".wakeflow-local",
    "runtime",
    "hosts",
    "codex",
  );
  const projections = path.join(hostRoot, "projections", "window-runtime");
  const removed = readdirSync(projections)[0];
  if (removed === undefined) throw new Error("Expected one projection.");
  rmSync(path.join(projections, removed));
  const recovered = await publishFreshWakeflowWindowRuntime(
    value.root,
    config,
    codexWorkspaceHostResourceProfile,
    { recoveringFreshPublication: true },
  );
  equal(recovered.createdProjectionCount, 1);
  equal(readdirSync(projections).length, 4);

  const bindingRoot = path.join(hostRoot, "identity", "window-bindings");
  writeFileSync(path.join(bindingRoot, "foreign.json"), "{}\n", {
    mode: 0o600,
  });
  await expectPublicationError(
    () => publishFreshWakeflowWindowRuntime(
      value.root,
      config,
      codexWorkspaceHostResourceProfile,
      { recoveringFreshPublication: true },
    ),
    "prefix-conflict",
  );
  equal(readdirSync(projections).length, 4);

  rmSync(path.join(bindingRoot, "foreign.json"));
  writeFileSync(path.join(projections, "foreign.json"), "{}\n", {
    mode: 0o600,
  });
  await expectPublicationError(
    () => publishFreshWakeflowWindowRuntime(
      value.root,
      config,
      codexWorkspaceHostResourceProfile,
      { recoveringFreshPublication: true },
    ),
    "prefix-conflict",
  );
  equal(readdirSync(projections).includes("foreign.json"), true);
});
