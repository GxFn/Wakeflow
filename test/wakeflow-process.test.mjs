#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";
import {
  execFileText,
  prepareWakeflowCommand,
  runSync,
} from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

test("wakeflow process boundary normalizes node to the current runtime", () => {
  const prepared = prepareWakeflowCommand("node", ["--version"]);
  assert.equal(prepared.kind, "node");
  assert.equal(prepared.command, process.execPath);
});

test("wakeflow process boundary allows fixed node and git commands", () => {
  const nodeResult = runSync(process.execPath, ["--version"], { encoding: "utf8" });
  assert.equal(nodeResult.status, 0, nodeResult.stderr || nodeResult.stdout);
  assert.match(nodeResult.stdout, /^v\d+/);

  const gitVersion = execFileText("git", ["--version"], { encoding: "utf8" });
  assert.match(gitVersion, /^git version /);
});

test("wakeflow process boundary rejects shell mode and unsupported commands", () => {
  assert.throws(
    () => runSync("sh", ["-c", "echo no"], { shell: true }),
    /shell mode|Unsupported Wakeflow process command/,
  );
  assert.throws(
    () => runSync("curl", ["https://example.invalid"], { encoding: "utf8" }),
    /Unsupported Wakeflow process command/,
  );
  assert.throws(
    () => runSync(process.execPath, ["-e", "console.log('no')"], { encoding: "utf8" }),
    /Unsupported Wakeflow node flag: -e/,
  );
});
