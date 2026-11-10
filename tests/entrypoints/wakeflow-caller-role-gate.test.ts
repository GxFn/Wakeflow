import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME } from "../../src/capabilities/delivery/contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/workspace/maintain-workspace.js";
import { parseWakeflowConfig } from "../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../src/configuration/wakeflow-config-document.js";
import { WAKEFLOW_ROLE_TOOL_ACCESS } from "../../src/contracts/vocabulary/wakeflow-role-tool-access.js";
import {
  createWakeflowCallerRoleGate,
  type WakeflowWindowExecutionRoot,
} from "../../src/entrypoints/wakeflow-caller-role-gate.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "../../src/entrypoints/wakeflow-public-mcp-catalog.js";
import { claudeCodeWindowExecutionPlacement } from "../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowExecutionPlacement } from "../../src/hosts/codex/codex-window-launch-instructions.js";
import { fail, isWakeflowError } from "../../src/kernel/error.js";
import { compileWakeflowWindowLaunchIntents } from "../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import { createMinimalWakeflowConfig } from "../configuration/wakeflow-config.fixture.js";
import {
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

/**
 * 级别 1（组件）：按窗口角色的运行时工具校验（ADR-0020 决定 3 与 6，open-items F1）。
 *
 * 门从服务进程的工作目录认出调用方窗口的角色：目录恰好是某一种角色的窗口的执行根时，归属表之外的工具被
 * 拒绝；认不出就不收窄。这里在一次性目录上钉住两面——每个角色只拿得到自己的工具，根目录、无关目录、读不出
 * 的配置与一个目录多种角色都照常放行——以及它在公共 MCP 入口里的位置：先于任何执行器与 beforeMutation。
 */

const TOOLS = WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.map((tool) => tool.name);

interface Fixture {
  readonly parent: string;
  readonly root: string;
  readonly design: string;
  readonly test: string;
  readonly product: string;
  readonly elsewhere: string;
}

function fixture(t: TestContext): Fixture {
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-caller-role-")));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "workspace");
  const directories = {
    root,
    design: path.join(root, "Design"),
    test: path.join(root, "Test"),
    product: path.join(parent, "ProductA"),
    elsewhere: path.join(parent, "elsewhere"),
  };
  for (const directory of Object.values(directories)) mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(root, "wakeflow.config.json"),
    renderWakeflowConfig(parseWakeflowConfig(createMinimalWakeflowConfig())),
  );
  return { parent, ...directories };
}

/** 与 Claude Code 组合根同一种取法：每个窗口的角色与它的启动目录。 */
function claudeExecutionRoots(
  model: Parameters<typeof compileWakeflowWindowLaunchIntents>[0],
): readonly WakeflowWindowExecutionRoot[] {
  return compileWakeflowWindowLaunchIntents(
    model,
    claudeCodeWorkspaceHostResourceProfile,
  ).intents.map((intent) => ({
    role: intent.role,
    placement: claudeCodeWindowExecutionPlacement(intent),
  }));
}

async function allowed(
  gate: ReturnType<typeof createWakeflowCallerRoleGate>,
  root: string,
): Promise<readonly string[]> {
  const passed: string[] = [];
  for (const tool of TOOLS) {
    try {
      await gate(tool, { root });
      passed.push(tool);
    } catch (error: unknown) {
      if (!isWakeflowError(error) || error.reason !== "tool-not-for-role") throw error;
    }
  }
  return passed;
}

test("每个角色的执行根只拿得到归属表里的工具：产品、Design、Test 各自收窄，拒绝带着角色与工具名", async (t) => {
  const current = fixture(t);
  for (const [directory, role] of [
    [current.product, "product"],
    [current.design, "design"],
    [current.test, "test"],
  ] as const) {
    const gate = createWakeflowCallerRoleGate({
      cwd: directory,
      executionRoots: claudeExecutionRoots,
    });
    deepEqual(
      [...(await allowed(gate, current.root))].sort(),
      [...WAKEFLOW_ROLE_TOOL_ACCESS[role]].sort(),
      role,
    );
    await rejects(
      gate(WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, { root: current.root }),
      (error: unknown) => {
        if (!isWakeflowError(error)) return false;
        equal(error.code, "precondition-failed");
        equal(error.reason, "tool-not-for-role");
        equal(error.path, "$caller");
        deepEqual(error.details, { role, tool: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME });
        return true;
      },
    );
  }
});

test("认不出就不收窄：工作区根、无关目录、读不出的配置、没有根的请求、一个目录多种角色都放行全部工具", async (t) => {
  const current = fixture(t);
  const everything = [...TOOLS];
  // 工作区根：Controller，或所有窗口都从根启动的宿主。
  const atRoot = createWakeflowCallerRoleGate({
    cwd: current.root,
    executionRoots: claudeExecutionRoots,
  });
  deepEqual(await allowed(atRoot, current.root), everything);
  // 不是任何窗口的执行根：维护者工具、引导会话、测试。
  const outside = createWakeflowCallerRoleGate({
    cwd: current.elsewhere,
    executionRoots: claudeExecutionRoots,
  });
  deepEqual(await allowed(outside, current.root), everything);

  const product = createWakeflowCallerRoleGate({
    cwd: current.product,
    executionRoots: claudeExecutionRoots,
  });
  // 请求没有根、根不是绝对路径、根不存在、根里没有配置：那是工具自己要报的错，门不抢着拒绝。
  await product(WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, {});
  await product(WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, null);
  await product(WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, { root: "workspace" });
  await product(WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, {
    root: path.join(current.parent, "missing"),
  });
  await product(WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, { root: current.elsewhere });
  // 宿主给不出执行根（抛错）时同样不收窄。
  const broken = createWakeflowCallerRoleGate({
    cwd: current.product,
    executionRoots: () => {
      throw new Error("no profile");
    },
  });
  deepEqual(await allowed(broken, current.root), everything);
  // 同一个目录属于不止一种角色：认不出是谁。
  const shared = createWakeflowCallerRoleGate({
    cwd: current.product,
    executionRoots: () => [
      { role: "product", placement: "../ProductA" },
      { role: "test", placement: "../ProductA" },
    ],
  });
  deepEqual(await allowed(shared, current.root), everything);
  // Codex：每个窗口都从项目根启动，所以任何目录上都认不出角色。
  const codex = createWakeflowCallerRoleGate({
    cwd: current.product,
    executionRoots: (model) =>
      compileWakeflowWindowLaunchIntents(model, claudeCodeWorkspaceHostResourceProfile).intents.map(
        (intent) => ({ role: intent.role, placement: codexWindowExecutionPlacement() }),
      ),
  });
  deepEqual(await allowed(codex, current.root), everything);
});

test("pod 的产品窗口在检出里启动、符号链接的工作目录按真实路径比较：两者都认作产品窗口", async (t) => {
  const current = fixture(t);
  const productIntent = compileWakeflowWindowLaunchIntents(
    parseWakeflowConfig(createMinimalWakeflowConfig()),
    claudeCodeWorkspaceHostResourceProfile,
  ).intents.find((intent) => intent.role === "product");
  ok(productIntent !== undefined);
  equal(productIntent.worktree, null);
  equal(claudeCodeWindowExecutionPlacement(productIntent), "../ProductA");
  equal(
    claudeCodeWindowExecutionPlacement({
      root: productIntent.root,
      worktree: {
        repositoryId: productIntent.root.rootId as never,
        suggestedName: "feature",
        basePolicy: "local-head",
      },
    }),
    "../ProductA/.claude/worktrees/feature",
  );
  const checkout = path.join(current.product, ".claude", "worktrees", "feature");
  mkdirSync(checkout, { recursive: true });
  const pod = createWakeflowCallerRoleGate({
    cwd: checkout,
    executionRoots: () => [
      { role: "controller", placement: "." },
      { role: "product", placement: "../ProductA/.claude/worktrees/feature" },
    ],
  });
  deepEqual(
    [...(await allowed(pod, current.root))].sort(),
    [...WAKEFLOW_ROLE_TOOL_ACCESS.product].sort(),
  );
  // 主检出本身不是这个 pod 窗口的执行根。
  const main = createWakeflowCallerRoleGate({
    cwd: current.product,
    executionRoots: () => [{ role: "product", placement: "../ProductA/.claude/worktrees/feature" }],
  });
  deepEqual(await allowed(main, current.root), [...TOOLS]);

  const link = path.join(current.parent, "product-link");
  symlinkSync(current.product, link);
  const linked = createWakeflowCallerRoleGate({ cwd: link, executionRoots: claudeExecutionRoots });
  deepEqual(
    [...(await allowed(linked, current.root))].sort(),
    [...WAKEFLOW_ROLE_TOOL_ACCESS.product].sort(),
  );
});

test("公共 MCP 入口先过这道门：被拒的调用拿到带角色与工具名的错误信封，执行器与 beforeMutation 都没有被调用", async (t) => {
  let executed = 0;
  let guarded = 0;
  const seen: string[] = [];
  const client = await connectWakeflowMcpTestClient(t, {
    executeMaintenance: async () => {
      executed += 1;
      throw new Error("the maintenance executor must not run for a refused call");
    },
    beforeMutation: () => {
      guarded += 1;
    },
    // 测试替身：把每次调用当作产品窗口发来的，按同一张归属表、同一个错误形状拒绝。
    authorizeCall: async (tool, request) => {
      seen.push(`${tool}:${(request as { root: string }).root}`);
      if (WAKEFLOW_ROLE_TOOL_ACCESS.product.includes(tool)) return;
      fail("precondition-failed", "tool-not-for-role", "$caller", {
        details: { role: "product", tool },
      });
    },
  });
  const refused = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace/private-gate",
      action: "reconcile",
      mode: "preview",
      request: {},
    },
  });
  equal(refused.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(refused)), {
    error: {
      code: "precondition-failed",
      details: { role: "product", tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME },
      path: "$caller",
      reason: "tool-not-for-role",
      retryable: false,
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  });
  equal(executed, 0);
  equal(guarded, 0, "a refused call never reaches beforeMutation");
  deepEqual(seen, [`${WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME}:/workspace/private-gate`]);
});
