import { equal } from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { executeDemandCreationRequest } from "../../../src/capabilities/demand/service.js";
import { executePodRequest } from "../../../src/capabilities/pod/service.js";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { listRequirementClaimStates } from "../../../src/governance/ledger/requirement-board.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  demandEventSourcingPublicationAuthoredDemand,
  PUBLICATION_SECOND_REQUIREMENT_ID,
  publishPendingPackage,
} from "../../governance/demand/demand-event-sourcing-publication-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

useDisposableDurability();

const CODEX = {
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
  hosts: CODEX_OBSERVATION_FACADE.hosts,
};

for (const scenario of ["same-pod", "different-pods", "close"] as const) {
  test(`${scenario}：在首个发布已取得锁但尚未提交时交错第二个公共请求`, {
    timeout: 30_000,
  }, async (t) => {
    const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
    const root = fixture.workspacePath;
    const released = Promise.withResolvers<void>();
    const paused = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    let secondArmed = false;
    let firstPaused = false;
    let first: ReturnType<typeof executeDemandCreationRequest> | undefined;
    try {
      await publishPendingPackage(
        fixture.workspaceRoot,
        fixture.ledgerPath,
        PUBLICATION_SECOND_REQUIREMENT_ID,
      );
      mkdirSync(path.join(root, ".wakeflow-local/runtime"), { recursive: true, mode: 0o700 });
      await publishFreshWakeflowWindowRuntime(
        fixture.workspaceRoot,
        parseWakeflowConfig(
          JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")),
        ),
        codexWorkspaceHostResourceProfile,
        { recoveringFreshPublication: false },
      );
      let extraPod: string | undefined;
      if (scenario !== "same-pod") {
        const intent = { kind: "create", name: "parallel", idempotencyKey: "parallel-test" };
        const preview = await executePodRequest(CODEX, { root, mode: "preview", intent });
        if (preview.kind !== "WakeflowPodPreview") throw new Error("Expected pod preview.");
        const result = await executePodRequest(CODEX, {
          root,
          mode: "apply",
          intent,
          planDigest: preview.planDigest,
        });
        if (result.kind !== "WakeflowPodMutation" || result.pod === null)
          throw new Error("Expected pod.");
        extraPod = result.pod.podId;
      }
      const firstRequest = {
        root,
        mode: "preview" as const,
        requirementId: fixture.requirementId,
        demand: demandEventSourcingPublicationAuthoredDemand(),
        ...(scenario === "close" ? { podId: extraPod } : {}),
      };
      const firstPreview = await executeDemandCreationRequest(firstRequest);
      if (firstPreview.kind !== "WakeflowDemandCreationPreview")
        throw new Error("Expected creation preview.");
      const secondRequest = {
        root,
        mode: "preview" as const,
        requirementId: PUBLICATION_SECOND_REQUIREMENT_ID,
        demand: demandEventSourcingPublicationAuthoredDemand(),
        ...(scenario === "different-pods" ? { podId: extraPod } : {}),
      };
      const secondPreview = await executeDemandCreationRequest(secondRequest);
      if (secondPreview.kind !== "WakeflowDemandCreationPreview")
        throw new Error("Expected second preview.");
      const closeIntent = { kind: "close", podId: extraPod, branches: [] };
      const closePreview =
        scenario === "close"
          ? await executePodRequest(CODEX, { root, mode: "preview", intent: closeIntent })
          : null;
      // 取锁都经过这一个出口：首个请求拿到 Demand 发布锁之后停住（它外面还持有 pod 变更锁，并且在共享的
      // 操作作用域里）。第二个请求被拒就是它在等：创建去拿 pod 变更锁；关闭 pod 要独占的操作作用域。
      const openLockFile = filesystemMutation.openLockFile;
      t.mock.method(
        filesystemMutation,
        "openLockFile",
        async (target: string, flags: number, mode: number) => {
          let handle: Awaited<ReturnType<typeof openLockFile>>;
          try {
            handle = await openLockFile.call(filesystemMutation, target, flags, mode);
          } catch (error: unknown) {
            if (
              secondArmed &&
              (target.endsWith("/locks/pod-mutation.lock") ||
                target.endsWith("/locks/operation-scope.lock"))
            )
              waiting.resolve();
            throw error;
          }
          if (!firstPaused && target.endsWith("/locks/demand-publication.lock")) {
            firstPaused = true;
            paused.resolve();
            await released.promise;
          }
          return handle;
        },
      );
      first = executeDemandCreationRequest({
        ...firstRequest,
        mode: "apply",
        planDigest: firstPreview.planDigest,
      });
      await Promise.race([
        paused.promise,
        first.then(() => {
          throw new Error("Missing publication barrier.");
        }),
      ]);
      secondArmed = true;
      const second = (
        scenario === "close"
          ? executePodRequest(CODEX, {
              root,
              mode: "apply",
              intent: closeIntent,
              planDigest:
                closePreview?.kind === "WakeflowPodPreview" ? closePreview.planDigest : null,
            })
          : executeDemandCreationRequest({
              ...secondRequest,
              mode: "apply",
              planDigest: secondPreview.planDigest,
            })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      // 全部 pod 共用一把变更锁（ADR-0033 决定 3）：另一个 pod 的请求也排在首个之后，放开之后各自完成。
      await Promise.race([
        waiting.promise,
        second.then(() => {
          throw new Error("Second mutation did not wait for the pod mutation lock.");
        }),
      ]);
      released.resolve();
      await first;
      const outcome = await second;
      if (scenario === "different-pods") {
        equal(outcome.ok, true);
      } else {
        equal(outcome.ok, false);
        if (outcome.ok || !(outcome.error instanceof WakeflowError))
          throw new Error("Expected a typed conflict.");
        equal(outcome.error.reason, scenario === "close" ? "plan-blocked" : "pod-busy");
      }
      const claims = (await listRequirementClaimStates(fixture.workspaceRoot)).states.filter(
        (state) => state.status === "claimed",
      );
      equal(claims.length, scenario === "different-pods" ? 2 : 1);
      if (scenario === "close") {
        const config = parseWakeflowConfig(
          JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")),
        );
        equal(config.pods.find((pod) => pod.podId === extraPod)?.lifecycle, "open");
      }
    } finally {
      released.resolve();
      await first?.catch(() => undefined);
      t.mock.restoreAll();
      await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
    }
  });
}
