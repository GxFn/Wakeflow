import { equal, match, rejects, throws } from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { callArtifactTool, parseToolArguments } from "../../../tooling/mcp/call.js";

const CANDIDATE = path.join(process.cwd(), "plugins", "codex-wakeflow");

function disposableRoot(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-mcp-call-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("mcp call：对已核验的制品副本起一个新 stdio 进程调用一次公共工具；工具拒绝按 failed 带公开错误码返回", {
  timeout: 60_000,
}, async (t) => {
  const root = disposableRoot(t);
  // 一个空目录不是 Wakeflow 工作区：status 以公开错误拒绝，调用本身是成功的观测。
  const refused = await callArtifactTool({
    candidate: CANDIDATE,
    workspace: root,
    tool: "wakeflow_status",
    arguments: {},
  });
  equal(refused.kind, "WakeflowMcpCall");
  equal(refused.status, "failed");
  equal(refused.exitCode, 1);
  equal(refused.reason, "lab-mcp-tool-failed");
  equal(refused.candidate.hostId, "codex");
  match(refused.candidate.manifestDigest, /^sha256:[0-9a-f]{64}$/u);
  equal(typeof refused.mcpError?.code, "string");
  equal(refused.runtime, "generated-stdio-new-process");
  equal(
    JSON.stringify(refused).includes(root),
    false,
    "the result must not carry the workspace path",
  );
});

test("mcp call 拒绝非 wakeflow_ 工具名、不存在的制品、非真实目录与带 root 的参数", async (t) => {
  const root = disposableRoot(t);
  await rejects(
    callArtifactTool({ candidate: CANDIDATE, workspace: root, tool: "rm_rf", arguments: {} }),
    /wakeflow_\* public tool/u,
  );
  await rejects(
    callArtifactTool({
      candidate: path.join(root, "missing"),
      workspace: root,
      tool: "wakeflow_status",
      arguments: {},
    }),
    /real directory/u,
  );
  await rejects(
    callArtifactTool({ candidate: root, workspace: root, tool: "wakeflow_status", arguments: {} }),
    /artifact-manifest|manifest/u,
  );
  throws(() => parseToolArguments(root, { inline: '{"root":"/elsewhere"}' }), /cannot carry root/u);
  throws(() => parseToolArguments(root, { inline: "[1]" }), /one JSON object/u);
  throws(() => parseToolArguments(root, { inline: "{}", file: "x.json" }), /not both/u);
  writeFileSync(path.join(root, "arguments.json"), '{"demandId":"demand_x"}\n');
  equal(parseToolArguments(root, { file: "arguments.json" }).demandId, "demand_x");
  equal(Object.keys(parseToolArguments(root, {})).length, 0);
});
