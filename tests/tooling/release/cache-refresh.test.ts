import { deepEqual, equal, throws } from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { refreshPluginCache } from "../../../tooling/release/cache-refresh.js";

const REPOSITORY = process.cwd();
const COMMITTED = path.join(REPOSITORY, "plugins", "claude-code-wakeflow");

function version(): string {
  return JSON.parse(readFileSync(path.join(REPOSITORY, "assets/release/version.json"), "utf8"))
    .version as string;
}

/** 一个假的宿主 CLI：记录调用，install 把已提交制品复制进缓存目录，uninstall 删除它。 */
function fixture(t: TestContext): { installed: string; cli: string; calls: string } {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-cache-refresh-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const installed = path.join(base, "cache", "gxfn", "wakeflow", version());
  const calls = path.join(base, "calls.log");
  const cli = path.join(base, "fake-claude.mjs");
  writeFileSync(
    cli,
    `${[
      "#!/usr/bin/env node",
      'import { appendFileSync, cpSync, rmSync } from "node:fs";',
      `appendFileSync(${JSON.stringify(calls)}, \`\${process.argv.slice(2).join(" ")}\\n\`);`,
      "if (process.env.FAKE_CLAUDE_FAIL_INSTALL === '1' && process.argv[3] === 'install') process.exit(1);",
      `if (process.argv[3] === "install") cpSync(${JSON.stringify(COMMITTED)}, ${JSON.stringify(installed)}, { recursive: true });`,
      `if (process.argv[3] === "uninstall") rmSync(${JSON.stringify(installed)}, { recursive: true, force: true });`,
    ].join("\n")}\n`,
    { mode: 0o755 },
  );
  return { installed, cli, calls };
}

test("缓存刷新：不带 --yes 只给计划；带 --yes 先卸载再安装并核对缓存清单与已提交制品一致", (t) => {
  const f = fixture(t);
  const plan = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: false,
    installed: f.installed,
    cli: f.cli,
  });
  equal(plan.kind, "WakeflowCacheRefresh");
  equal(plan.changesApplied, false);
  equal(plan.before.present, false);
  deepEqual(
    plan.commands.map((entry) => entry.args.join(" ")),
    ["plugin uninstall wakeflow@gxfn", "plugin install wakeflow@gxfn"],
  );
  equal(existsSync(f.calls), false, "a plan must not call the host CLI");

  const applied = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: true,
    installed: f.installed,
    cli: f.cli,
  });
  equal(applied.status, "passed");
  equal(applied.changesApplied, true);
  equal(applied.after?.present, true);
  equal(applied.after?.matchesCommitted, true);
  equal(applied.after?.manifestDigest, applied.committedManifestDigest);
  deepEqual(readFileSync(f.calls, "utf8").trim().split("\n"), [
    "plugin uninstall wakeflow@gxfn",
    "plugin install wakeflow@gxfn",
  ]);
  // 再刷一次：之前的缓存已存在且一致。
  const again = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: false,
    installed: f.installed,
    cli: f.cli,
  });
  equal(again.before.matchesCommitted, true);
});

test("缓存刷新：安装失败按 failed，Codex 不支持，版本目录名必须等于制品版本", (t) => {
  const f = fixture(t);
  process.env.FAKE_CLAUDE_FAIL_INSTALL = "1";
  try {
    const failed = refreshPluginCache(REPOSITORY, {
      hostId: "claude-code",
      yes: true,
      installed: f.installed,
      cli: f.cli,
    });
    equal(failed.status, "failed");
    equal(failed.exitCode, 1);
    equal(failed.after?.present, false);
  } finally {
    delete process.env.FAKE_CLAUDE_FAIL_INSTALL;
  }
  throws(
    () => refreshPluginCache(REPOSITORY, { hostId: "codex", yes: false }),
    /claude-code cache refresh/u,
  );
  mkdirSync(path.join(f.installed, "..", "0.0.0"), { recursive: true });
  throws(
    () =>
      refreshPluginCache(REPOSITORY, {
        hostId: "claude-code",
        yes: false,
        installed: path.join(f.installed, "..", "0.0.0"),
      }),
    /version directory/u,
  );
  // 已存在但损坏的缓存按 present 且不一致报告，不抛出。
  mkdirSync(f.installed, { recursive: true });
  cpSync(COMMITTED, f.installed, { recursive: true });
  writeFileSync(path.join(f.installed, "README.md"), "tampered\n");
  const tampered = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: false,
    installed: f.installed,
  });
  equal(tampered.before.present, true);
  equal(tampered.before.matchesCommitted, false);
  equal(typeof tampered.before.reason, "string");
});
