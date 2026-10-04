import { equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { createClaudeCodeWakeflowMcpServer } from "../../src/entrypoints/claude-code-wakeflow-mcp.js";
import { executeCodexWakeflowMaintenance } from "../../src/entrypoints/codex-wakeflow-maintenance.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parsePortableResourcePath } from "../../src/foundation/filesystem/portable-resource-path.js";
import { withRootedExclusiveFileLock } from "../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { WakeflowError } from "../../src/kernel/error.js";
import { readRequirementClaimState } from "../../src/kernel/requirement-board.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
} from "../governance/demand/demand-event-sourcing-publication-service.fixture.js";
import { connectWakeflowMcpServerForTest } from "./wakeflow-public-mcp-server.fixture.js";

for (const [host, createServer, maintain] of [
  ["codex", createCodexWakeflowMcpServer, executeCodexWakeflowMaintenance],
  ["claude-code", createClaudeCodeWakeflowMcpServer, executeClaudeCodeWakeflowMaintenance],
] as const) {
  test(`${host} MCP 的真实取消通知中止 claim 锁等待，释放锁后也不提交`, {
    timeout: 20_000,
  }, async (t) => {
    const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
    const { client, close } = await connectWakeflowMcpServerForTest(createServer("1.0.0-test"));
    const lockRef = parsePortableResourcePath(
      `.wakeflow-active/current/board/locks/${fixture.requirementId}.lock`,
    );
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    let armed = false;
    const inspect = RootedDirectory.prototype.inspectExistingResource;
    const closeRoot = RootedDirectory.prototype.close;
    t.mock.method(
      RootedDirectory.prototype,
      "inspectExistingResource",
      async function (this: RootedDirectory, ...args: Parameters<typeof inspect>) {
        const result = await inspect.apply(this, args);
        if (
          armed &&
          this.absolutePath === fixture.workspaceRoot.absolutePath &&
          args[0] === lockRef
        ) {
          waiting.resolve();
        }
        return result;
      },
    );
    t.mock.method(RootedDirectory.prototype, "close", async function (this: RootedDirectory) {
      await closeRoot.call(this);
      if (
        armed &&
        this !== fixture.workspaceRoot &&
        this.absolutePath === fixture.workspaceRoot.absolutePath
      ) {
        finished.resolve();
      }
    });
    let holder: Promise<void> | undefined;
    try {
      const request = {
        root: fixture.workspacePath,
        mode: "preview",
        action: "withdraw",
        requirementId: fixture.requirementId,
        expectedStateDigest: fixture.initialClaimStateDigest,
        reason: "Cancelled operation must leave the requirement pending.",
      };
      const preview = await client.callTool({
        name: "wakeflow_publish_requirement",
        arguments: request,
      });
      equal(preview.isError, undefined);
      const plan = preview.structuredContent as { status: string; planDigest: string };
      equal(plan.status, "ready");
      holder = withRootedExclusiveFileLock(fixture.workspaceRoot, lockRef, async () => {
        held.resolve();
        await release.promise;
      });
      await held.promise;
      armed = true;
      const controller = new AbortController();
      const cancelled = rejects(
        client.callTool(
          {
            name: "wakeflow_publish_requirement",
            arguments: { ...request, mode: "apply", planDigest: plan.planDigest },
          },
          { signal: controller.signal },
        ),
      );
      await waiting.promise;
      controller.abort();
      await cancelled;
      // 请求上下文必须在锁仍被持有时关闭，证明不是等到释放后才忽略回复。
      await finished.promise;
      release.resolve();
      await holder;
      const state = await readRequirementClaimState(fixture.workspaceRoot, fixture.requirementId);
      equal(state?.state.status, "pending");
      equal(state?.state.revision, 1);
      equal(state?.digest, fixture.initialClaimStateDigest);
      await rejects(
        maintain(
          {
            root: fixture.workspacePath,
            mode: "preview",
            action: "reconcile",
            request: {},
          },
          { signal: AbortSignal.abort() },
        ),
        (error: unknown) => error instanceof WakeflowError && error.reason === "aborted",
      );
    } finally {
      release.resolve();
      await holder;
      await close();
      t.mock.restoreAll();
      await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
    }
  });
}
