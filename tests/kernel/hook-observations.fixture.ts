import { lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import type { UtcInstant } from "../../src/foundation/time/utc-instant.js";
import type {
  HostHookObservationInput,
  writeHostHookObservation,
} from "../../src/kernel/hook-observations.js";
import { hostHookObservationsRootRef } from "../../src/kernel/layout.js";

/**
 * hook 观察测试的共享夹具：一次性工作区根、固定时钟、目录与记录名的派生。`hook-observations.test.ts`
 * 与带负载标签的 `hook-observations.load.test.ts`（上万条目的真实目录树）共用，所以它们可以在两条道里
 * 各自跑（测试开发标准 §3，§13.206 D3）。
 */
export async function fixture(
  t: TestContext,
): Promise<{ readonly root: RootedDirectory; readonly path: string }> {
  const absolutePath = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-hooks-")));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return { root, path: absolutePath };
}

export const SESSION = "0d1e2f30-1111-4222-8333-444455556666";
export const AT = (offset: number): UtcInstant =>
  new Date(Date.UTC(2026, 8, 4, 12, 0, offset)).toISOString() as UtcInstant;

export const DAY = 24 * 60 * 60 * 1000;
export const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
/** 相对固定"现在"的毫秒形时刻；测试不读墙钟。 */
export const ago = (milliseconds: number): UtcInstant =>
  new Date(NOW - milliseconds).toISOString() as UtcInstant;
export const compact = (instant: UtcInstant): string => instant.replace(/[-:.]/gu, "");

export function hooksDirectory(workspace: string, hostId: "codex" | "claude-code"): string {
  return path.join(workspace, ...hostHookObservationsRootRef(hostId).split("/"));
}

export function hookEntries(directory: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    const child = path.join(directory, name);
    if (/^\d{8}$/u.test(name) && lstatSync(child).isDirectory()) {
      for (const shard of readdirSync(child)) {
        const shardPath = path.join(child, shard);
        if (/^[0-9a-f]{2}$/u.test(shard) && lstatSync(shardPath).isDirectory()) {
          for (const leaf of readdirSync(shardPath)) entries.push(`${name}/${shard}/${leaf}`);
        } else entries.push(`${name}/${shard}`);
      }
    } else entries.push(name);
  }
  return entries.sort();
}

export function observation(
  workspace: string,
  recordedAt: UtcInstant,
  patch: Partial<HostHookObservationInput> = {},
): HostHookObservationInput {
  return {
    hostId: "claude-code",
    event: "stop",
    sessionId: SESSION,
    cwd: `${workspace}/product`,
    recordedAt,
    ...patch,
  };
}

export function recordName(receipt: Awaited<ReturnType<typeof writeHostHookObservation>>): string {
  return `${compact(receipt.record.recordedAt).slice(0, 8)}/${receipt.record.recordId.slice(0, 2)}/${compact(receipt.record.recordedAt)}-${receipt.record.event}-${receipt.record.recordId}.json`;
}

/**
 * 越界目录的合成条目：无法识别的名字最便宜，而且修剪按定义不碰它们（D7b），所以填多少个，
 * 修剪之后读取报的 `skipped` 就还是多少个。
 */
export const OVERSIZED_UNRECOGNIZED = 16_300;
/** 过期记录数：足以把目录从读取上限之上带回上限之下，又不必 unlink 上万个文件。 */
export const OVERSIZED_EXPIRED = 96;

export function fillOversizedDirectory(directory: string): void {
  for (let index = 0; index < OVERSIZED_UNRECOGNIZED; index += 1) {
    writeFileSync(path.join(directory, `stray-${index.toString(16).padStart(6, "0")}.txt`), "x\n", {
      mode: 0o600,
    });
  }
  for (let index = 0; index < OVERSIZED_EXPIRED; index += 1) {
    const hex = index.toString(16).padStart(12, "0");
    writeFileSync(
      path.join(directory, `20200101T000000000Z-stop-00000000-0000-4000-8000-${hex}.json`),
      "garbage\n",
      { mode: 0o600 },
    );
  }
}
