import { deepEqual, equal, notEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { CODEX_HOOK_OBSERVER_COMMAND } from "../../../src/hosts/codex/codex-hook-fragment.js";
import { CODEX_MCP_CONFIGURATION } from "../../../src/hosts/codex/codex-process-launch-profile.js";

for (const selection of ["host", "unset", "empty", "invalid-host"] as const) {
  test("Codex MCP 和 hook 的实际启动遵守 Node 选择：" + selection, {
    skip: process.platform === "win32",
  }, (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-node-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const plugin = path.join(root, "plugin with spaces");
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    for (const [directory, file] of [["mcp", "server.mjs"], ["hooks", "observe.mjs"]] as const) {
      mkdirSync(path.join(plugin, directory), { recursive: true });
      writeFileSync(
        path.join(plugin, directory, file),
        "process.stdout.write(JSON.stringify({entry:" + JSON.stringify(directory) +
          ",args:process.argv.slice(2)}));\n",
      );
    }
    const hostNode = path.join(root, "node with spaces");
    symlinkSync(process.execPath, hostNode);
    const env: Record<string, string> = { PATH: bin, PLUGIN_ROOT: plugin };
    if (selection === "host") {
      // GUI 的 PATH 没有 node；只能使用宿主给的路径，且路径中的空格不能拆成参数。
      env.CODEX_MCP_NODE_PATH = hostNode;
    } else {
      symlinkSync(process.execPath, path.join(bin, "node"));
      if (selection === "empty") env.CODEX_MCP_NODE_PATH = "";
      if (selection === "invalid-host") env.CODEX_MCP_NODE_PATH = path.join(root, "missing-node");
    }
    const configuration = CODEX_MCP_CONFIGURATION.mcpServers.wakeflow;
    deepEqual(configuration.env_vars, ["CODEX_MCP_NODE_PATH"]);
    const calls = [
      {
        command: configuration.command,
        args: [...configuration.args, "argument with spaces"],
        expected: { entry: "mcp", args: ["argument with spaces"] },
      },
      {
        command: "/bin/sh",
        args: ["-c", CODEX_HOOK_OBSERVER_COMMAND],
        expected: { entry: "hooks", args: ["--wakeflow-hook-observer-v1", "--host", "codex"] },
      },
    ];
    for (const call of calls) {
      const result = spawnSync(call.command, call.args, {
        cwd: plugin,
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
      if (result.error !== undefined) throw result.error;
      if (selection === "invalid-host") {
        notEqual(result.status, 0, "宿主给的路径无效时不静默改用另一个 Node");
        equal(result.stdout, "");
      } else {
        equal(result.status, 0, result.stderr);
        equal(result.stderr, "");
        deepEqual(JSON.parse(result.stdout), call.expected);
      }
    }
  });
}
