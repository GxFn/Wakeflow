import { deepEqual, equal } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { publishWakeflowConfigAuthority } from "../../src/configuration/wakeflow-config-authority-publication.js";
import {
  replaceWakeflowConfigAuthority,
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
} from "../../src/configuration/wakeflow-config-authority-replacement.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { lockCycleEvents, traceDurability } from "../support/durability-trace.js";
import { createMinimalWakeflowConfig } from "./wakeflow-config.fixture.js";

/**
 * Level 1 (component): 配置权威锁（L10）经生产包装走一个周期仍是权威档（1.4.1 第 1 段清单 2.1 节：
 * L8–L12 留在权威档，新建 3、删除 1）。
 *
 * 级别说明：tests/configuration 的目录缺省是 2 级，本文件只在一次性根上调用一个配置模块，不起子进程，
 * 属 1 级。用同一份配置做一次"已是当前"的替换：锁内只核对、不写，计到的只有锁；有人给这把锁传了
 * 轻档，链接之后与删暂存之后的两次父目录同步会消失。
 *
 * 不调用 useDisposableDurability：本文件测的就是同步。
 */

test("config authority lock (L10) through replaceWakeflowConfigAuthority of the current config", async (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-family-config-")));
  const workspacePath = path.join(base, "WakeflowProgram");
  for (const directory of [
    workspacePath,
    path.join(base, "ProductA"),
    path.join(base, "wakeflow-ledger"),
  ]) {
    mkdirSync(directory, { mode: 0o755 });
  }
  const root = await RootedDirectory.open(workspacePath, "$root", { durability: "fsync" });
  t.after(async () => {
    await root.close();
    rmSync(base, { recursive: true, force: true });
  });
  const source = await publishWakeflowConfigAuthority(root, createMinimalWakeflowConfig());
  let disposition: string | undefined;
  const traced = traceDurability(t, workspacePath);
  const trace = await traced(async () => {
    disposition = (
      await replaceWakeflowConfigAuthority(root, createMinimalWakeflowConfig(), source.authority)
    ).disposition;
  });
  equal(disposition, "current");
  deepEqual(trace, {
    syncCount: 4,
    directorySyncCount: 3,
    events: lockCycleEvents(WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF, "default"),
  });
});
