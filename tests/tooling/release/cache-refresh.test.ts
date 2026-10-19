import { deepEqual, equal, ok, throws } from "node:assert/strict";
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
function fixture(t: TestContext): {
  installed: string;
  cli: string;
  calls: string;
  /** 宿主的 marketplace 登记：缺省把 gxfn 登记为指向本检出的 directory 源（本机现场的形态，§13.183 F-L1-10）。 */
  marketplaces: string;
  registerMarketplace: (source: Record<string, unknown>) => void;
} {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-cache-refresh-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const installed = path.join(base, "cache", "gxfn", "wakeflow", version());
  const calls = path.join(base, "calls.log");
  const cli = path.join(base, "fake-claude.mjs");
  const marketplaces = path.join(base, "known_marketplaces.json");
  const registerMarketplace = (source: Record<string, unknown>) =>
    writeFileSync(
      marketplaces,
      `${JSON.stringify({ gxfn: { source, installLocation: REPOSITORY } })}\n`,
    );
  registerMarketplace({ source: "directory", path: REPOSITORY });
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
  return { installed, cli, calls, marketplaces, registerMarketplace };
}

test("缓存刷新：不带 --yes 只给计划；带 --yes 先卸载再安装并核对缓存清单与已提交制品一致", (t) => {
  const f = fixture(t);
  const plan = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: false,
    installed: f.installed,
    cli: f.cli,
    knownMarketplaces: f.marketplaces,
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
    knownMarketplaces: f.marketplaces,
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
    knownMarketplaces: f.marketplaces,
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
      knownMarketplaces: f.marketplaces,
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

test("缓存刷新：核对宿主实际加载的位置——directory 源就地加载检出里的制品，github 源加载缓存副本，登记缺失即 unknown 且不算成功（§13.183 F-L1-10）", (t) => {
  const f = fixture(t);
  // 本机形态：gxfn 是指向本检出的 directory 源 → 加载位置是检出里的 plugins/claude-code-wakeflow，与已提交一致。
  const inPlace = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: true,
    installed: f.installed,
    cli: f.cli,
    knownMarketplaces: f.marketplaces,
  });
  equal(inPlace.status, "passed");
  equal(inPlace.loadPath.kind, "directory-marketplace");
  equal(inPlace.loadPath.path, COMMITTED);
  equal(inPlace.loadPath.matchesCommitted, true);
  equal(inPlace.loadPath.manifestDigest, inPlace.committedManifestDigest);
  ok(inPlace.nextSteps[0]?.includes("loads this plugin in place"));
  // github 源：缓存副本就是加载位置。
  f.registerMarketplace({ source: "github", repo: "GxFn/Wakeflow" });
  const fromCache = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: true,
    installed: f.installed,
    cli: f.cli,
    knownMarketplaces: f.marketplaces,
  });
  equal(fromCache.status, "passed");
  equal(fromCache.loadPath.kind, "cache");
  equal(fromCache.loadPath.path, f.installed);
  equal(fromCache.loadPath.matchesCommitted, true);
  equal(
    fromCache.nextSteps.some((step) => step.includes("in place")),
    false,
  );
  // 登记缺失：加载位置未知，副本再一致也不能宣称成功。
  rmSync(f.marketplaces, { force: true });
  const unknown = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: true,
    installed: f.installed,
    cli: f.cli,
    knownMarketplaces: f.marketplaces,
  });
  equal(unknown.status, "failed");
  equal(unknown.loadPath.kind, "unknown");
  equal(unknown.loadPath.reason, "known-marketplaces-unreadable");
  equal(unknown.after?.matchesCommitted, true);
  // 不带 --yes 也报告加载位置。
  f.registerMarketplace({ source: "directory", path: REPOSITORY });
  const plan = refreshPluginCache(REPOSITORY, {
    hostId: "claude-code",
    yes: false,
    installed: f.installed,
    cli: f.cli,
    knownMarketplaces: f.marketplaces,
  });
  equal(plan.loadPath.kind, "directory-marketplace");
  equal(plan.changesApplied, false);
});
