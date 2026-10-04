import { materializeFixtureOperationScope } from "../../support/workspace-operation-scope.fixture.js";
import { deepEqual, equal, rejects } from "node:assert/strict";
import {
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

import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../../src/configuration/wakeflow-config-document.js";
import { materializeDirectoryPath } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createWakeflowWindowHostBindingInStore,
  WakeflowWindowHostBindingStoreError,
  withWakeflowWindowHostBindingStore,
} from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import { parseWakeflowWindowHostHandle } from "../../../src/workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import { wakeflowWindowHostBindingRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { compileWakeflowWindowLaunchIntents } from "../../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import { compileWakeflowWindowRuntimeRegisteredProjectionEntry } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-registered-projection.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { publishWakeflowWindowRuntimeProjectionDocument } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-projection-document.js";
import { WakeflowWindowRuntimeProjectionError } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-projection-inspection.js";
import {
  executeWakeflowWindowRuntimeProjectionOperation,
  ensureWakeflowWindowRuntimeSkeleton,
  planWakeflowWindowRuntimeProjectionMaintenance,
  refreshWakeflowWindowRuntimeProjections,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.js";
import {
  compileWakeflowWindowRuntimeUnregisteredProjectionSet,
  parseWakeflowWindowRuntimeUnregisteredProjectionDocument,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-unregistered-projection.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";

/**
 * 对账时的窗口运行投影：健康零操作；缺失或过期（合法 JSON、内容不同）各出一条操作，执行后
 * 逐字节复原；读不出的投影只报告 `window-runtime-projection-unsafe`；宿主运行时根未发布或
 * fresh 动作不出操作；执行时目标摘要与计划不符即拒绝。
 */

const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-projection-maintenance-")),
  );
  materializeFixtureOperationScope(absolutePath);
  const root = await RootedDirectory.open(absolutePath);
  writeFileSync(path.join(absolutePath, "wakeflow.config.json"), renderWakeflowConfig(config()), { mode: 0o644 });
  await materializeDirectoryPath(root, parsePortableResourcePath(".wakeflow-local/runtime"), {
    mode: 0o700,
  });
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({
    absolutePath,
    root,
    projections: path.join(
      absolutePath,
      ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
    ),
  });
}

function config() {
  return parseWakeflowConfig(createMinimalWakeflowConfig());
}

function request(action: "reconcile" | "reconfigure" | "fresh-initialize") {
  return {
    action,
    config: config(),
    resourceProfile: codexWorkspaceHostResourceProfile,
    identityProfile: codexWindowHostIdentityProfile,
  };
}

test("window runtime projection maintenance repairs missing and stale projections and reports unsafe ones", async (t) => {
  const workspace = await fixture(t);
  // 宿主运行时根尚未发布：不出操作也不报告（共享预览负责 window-runtime-missing）。
  deepEqual(
    await planWakeflowWindowRuntimeProjectionMaintenance(workspace.root, request("reconcile")),
    { operations: [], blockerCodes: [] },
  );

  await publishFreshWakeflowWindowRuntime(
    workspace.root,
    config(),
    codexWorkspaceHostResourceProfile,
    { recoveringFreshPublication: false },
  );
  deepEqual(
    await planWakeflowWindowRuntimeProjectionMaintenance(workspace.root, request("reconcile")),
    { operations: [], blockerCodes: [] },
  );
  deepEqual(
    await planWakeflowWindowRuntimeProjectionMaintenance(workspace.root, request("fresh-initialize")),
    { operations: [], blockerCodes: [] },
  );

  const projectionPath = path.join(workspace.projections, `${CONTROLLER_WINDOW_ID}.json`);
  const original = readFileSync(projectionPath, "utf8");
  rmSync(projectionPath);
  const missing = await planWakeflowWindowRuntimeProjectionMaintenance(
    workspace.root,
    request("reconcile"),
  );
  deepEqual(missing.blockerCodes, []);
  equal(missing.operations.length, 1);
  const operation = missing.operations[0];
  if (operation === undefined) throw new Error("expected one operation");
  equal(operation.operationId, `window-runtime-projection:${CONTROLLER_WINDOW_ID}`);
  equal(operation.operationKind, "window-runtime-projection");
  equal(operation.targetKey, CONTROLLER_WINDOW_ID);
  equal(operation.sourceDigest, null);
  deepEqual(operation.payload, {
    windowId: CONTROLLER_WINDOW_ID,
    resourceRef: `.wakeflow-local/runtime/hosts/codex/projections/window-runtime/${CONTROLLER_WINDOW_ID}.json`,
    registered: false,
    projectionDigest: parseWakeflowWindowRuntimeUnregisteredProjectionDocument(original).projectionDigest,
  });
  const created = await executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
    ...request("reconcile"),
    operationId: operation.operationId,
    targetKey: operation.targetKey,
    targetDigest: operation.targetDigest,
  });
  equal(created.disposition, "created");
  equal(readFileSync(projectionPath, "utf8"), original);
  equal(statSync(projectionPath).mode & 0o777, 0o600);
  equal(
    (await executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
      ...request("reconcile"),
      operationId: operation.operationId,
      targetKey: operation.targetKey,
      targetDigest: operation.targetDigest,
    })).disposition,
    "current",
  );

  // 过期：合法的确定性 JSON，但不是当前权威渲染。
  writeFileSync(projectionPath, original.replace("\"unregistered\"", "\"registered\""));
  const stale = await planWakeflowWindowRuntimeProjectionMaintenance(
    workspace.root,
    request("reconfigure"),
  );
  equal(stale.operations.length, 1);
  equal(stale.operations[0]?.sourceDigest === null, false);
  const updated = await executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
    ...request("reconfigure"),
    operationId: `window-runtime-projection:${CONTROLLER_WINDOW_ID}`,
    targetKey: CONTROLLER_WINDOW_ID,
    targetDigest: stale.operations[0]?.targetDigest as never,
  });
  equal(updated.disposition, "updated");
  equal(readFileSync(projectionPath, "utf8"), original);

  // 读不出：只报告，不出操作，也不覆盖。
  writeFileSync(projectionPath, "not a projection\n");
  const unsafe = await planWakeflowWindowRuntimeProjectionMaintenance(
    workspace.root,
    request("reconcile"),
  );
  deepEqual(unsafe, { operations: [], blockerCodes: ["window-runtime-projection-unsafe"] });
  equal(readFileSync(projectionPath, "utf8"), "not a projection\n");

  // 计划与当前权威不符（错误的目标摘要）即拒绝。
  let caught: unknown;
  try {
    await executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
      ...request("reconcile"),
      operationId: `window-runtime-projection:${CONTROLLER_WINDOW_ID}`,
      targetKey: CONTROLLER_WINDOW_ID,
      targetDigest: `sha256:${"0".repeat(64)}` as never,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowWindowRuntimeProjectionError, true);
  if (caught instanceof WakeflowWindowRuntimeProjectionError) {
    equal(caught.reason, "plan");
  }
});

test("window runtime projection publish reports an abort as aborted, not as a read or write failure", async (t) => {
  const workspace = await fixture(t);
  await publishFreshWakeflowWindowRuntime(
    workspace.root,
    config(),
    codexWorkspaceHostResourceProfile,
    { recoveringFreshPublication: false },
  );
  const entry = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    config(),
    codexWorkspaceHostResourceProfile,
  ).entries[0];
  if (entry === undefined) throw new Error("expected one projection entry");
  const controller = new AbortController();
  controller.abort();
  let caught: unknown;
  try {
    await publishWakeflowWindowRuntimeProjectionDocument(
      workspace.root,
      {
        resourceRef: entry.resourceRef,
        document: entry.document,
        documentDigest: entry.documentDigest,
        projectionDigest: entry.projection.projectionDigest,
      },
      controller.signal,
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(isWakeflowError(caught) && caught.reason, "aborted");
});

test("window runtime projection refresh keeps unavailable-root errors at the projection boundary", async (t) => {
  const workspace = await fixture(t);
  await workspace.root.close();
  await rejects(refreshWakeflowWindowRuntimeProjections(workspace.root, request("reconcile")),
    (error: unknown) => error instanceof WakeflowWindowRuntimeProjectionError && error.reason === "input");
});

test("runtime projection refresh derives its config from authority, ignoring a delayed caller snapshot", async (t) => {
  const workspace = await fixture(t);
  const delayed = request("reconcile");
  await publishFreshWakeflowWindowRuntime(workspace.root, delayed.config, delayed.resourceProfile, {
    recoveringFreshPublication: false,
  });
  const raw = createMinimalWakeflowConfig();
  const topology = raw.topology as { supportSurfaces: { capability: string; path: string }[] };
  const surface = topology.supportSurfaces.find((entry) => entry.capability === "test");
  if (surface === undefined) throw new Error("Expected a test surface.");
  surface.path = "NewTest";
  const current = parseWakeflowConfig(raw);
  writeFileSync(path.join(workspace.absolutePath, "wakeflow.config.json"), renderWakeflowConfig(current));
  await refreshWakeflowWindowRuntimeProjections(workspace.root, delayed);
  deepEqual(await planWakeflowWindowRuntimeProjectionMaintenance(workspace.root, {
    ...delayed, config: current,
  }), { operations: [], blockerCodes: [] });
});

for (const [resourceProfile, identityProfile] of [
  [codexWorkspaceHostResourceProfile, codexWindowHostIdentityProfile],
  [claudeCodeWorkspaceHostResourceProfile, claudeCodeWindowHostIdentityProfile],
] as const) {
  for (const operation of ["refresh", "execute", "skeleton"] as const) {
    test(`${resourceProfile.hostId} projection ${operation} cannot overwrite a concurrent registration`, {
      timeout: 15_000,
    }, async (t) => {
      const workspace = await fixture(t);
      const model = config();
      await publishFreshWakeflowWindowRuntime(workspace.root, model, resourceProfile, {
        recoveringFreshPublication: false,
      });
      const source = compileWakeflowWindowRuntimeUnregisteredProjectionSet(model, resourceProfile).entries[0];
      const intent = compileWakeflowWindowLaunchIntents(model, resourceProfile).intents[0];
      if (source === undefined || intent === undefined) throw new Error("Expected a window.");
      const authority = compileWakeflowWindowHostBindingStoreAuthority(model, resourceProfile, identityProfile);
      const projectionPath = path.join(workspace.absolutePath, source.resourceRef);
      rmSync(projectionPath);
      const paused = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const waitingForLock = Promise.withResolvers<void>();
      let intercepted = false;
      let registering = false;
      const inspect = RootedDirectory.prototype.inspectExistingResource;
      t.mock.method(RootedDirectory.prototype, "inspectExistingResource", async function (
        this: RootedDirectory,
        ...args: Parameters<typeof inspect>
      ) {
        let result: Awaited<ReturnType<typeof inspect>>;
        try {
          result = await inspect.apply(this, args);
        } catch (error: unknown) {
          if (this === workspace.root && !intercepted && args[0] === source.resourceRef) {
            intercepted = true;
            paused.resolve();
            await release.promise;
          }
          throw error;
        }
        if (this === workspace.root && registering && args[0] === authority.lockRef) {
          waitingForLock.resolve();
        }
        return result;
      });
      const inputs = { config: model, resourceProfile, identityProfile };
      const maintenance = operation === "refresh"
        ? refreshWakeflowWindowRuntimeProjections(workspace.root, inputs)
        : operation === "skeleton"
          ? ensureWakeflowWindowRuntimeSkeleton(workspace.root, inputs)
          : executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
            ...inputs,
            operationId: `window-runtime-projection:${source.windowId}`,
            targetKey: source.windowId,
            targetDigest: source.documentDigest,
          });
      let registration: Promise<string | WakeflowWindowHostBindingStoreError> | undefined;
      try {
        await paused.promise;
        registering = true;
        const register = () => withWakeflowWindowHostBindingStore(workspace.root, authority, {}, async (store) => {
          const binding = await createWakeflowWindowHostBindingInStore(workspace.root, {
            ...authority,
            windowId: source.windowId,
            bindingRef: wakeflowWindowHostBindingRef(resourceProfile, source.windowId),
            launchIntentDigest: intent.intentDigest,
            handle: parseWakeflowWindowHostHandle(identityProfile, {
              kind: identityProfile.handleKind, value: "test-registration-session",
            }),
            observedAt: parseUtcInstant("2026-09-01T00:00:00.000Z"),
          }, store);
          const entry = compileWakeflowWindowRuntimeRegisteredProjectionEntry(
            resourceProfile, identityProfile, source.projection, binding,
          );
          await publishWakeflowWindowRuntimeProjectionDocument(workspace.root, {
            ...entry,
            projectionDigest: entry.projection.projectionDigest,
          }, undefined);
          return entry.document;
        });
        registration = register().catch((error: unknown) => {
          if (!(error instanceof WakeflowWindowHostBindingStoreError)) throw error;
          equal(error.reason, "lock");
          return error;
        });
        // On the old implementation registration finishes while maintenance is paused.
        // With the fix the existing store either waits or rejects an active lock for retry.
        await Promise.race([registration, waitingForLock.promise]);
        release.resolve();
        await maintenance;
        const firstAttempt = await registration;
        const registered = typeof firstAttempt === "string" ? firstAttempt : await register();
        equal(readFileSync(projectionPath, "utf8"), registered);
        deepEqual(await planWakeflowWindowRuntimeProjectionMaintenance(workspace.root, {
          ...inputs, action: "reconcile",
        }), { operations: [], blockerCodes: [] });
      } finally {
        release.resolve();
        await Promise.allSettled([maintenance, ...(registration === undefined ? [] : [registration])]);
      }
    });
  }
}
