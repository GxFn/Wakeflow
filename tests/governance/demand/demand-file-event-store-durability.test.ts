import { deepEqual, equal } from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { open as openFileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { decideDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import { prepareDemandEventStreamCommit } from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import { countFsyncs } from "../../foundation/filesystem/fsync-count-probe.js";

/**
 * 第 1 级（组件）：Demand 事件追加的持久化协议按 fsync 次数与顺序钉住（1.4.1 第 1 段，清单 2.1
 * “事件追加”）。本文件测的就是耐久性本身，所以不调用 `useDisposableDurability()`，根以真实
 * `fsync` 打开；补丁是进程全局的，用例一律 `concurrency: false`，并在 `finally` 里还原。
 */

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_44444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);

function prepared() {
  const events = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: EVENT_ID,
    recordedAt: parseUtcInstant("2026-08-26T10:00:00.000Z"),
    identityDigest: parseSha256Digest(`sha256:${"a".repeat(64)}`),
    authorityDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
  });
  return prepareDemandEventStreamCommit(null, {
    commitId: COMMIT_ID,
    commandDigest: parseSha256Digest(`sha256:${"c".repeat(64)}`),
    events,
  });
}

interface SyncPrototype {
  sync: (this: unknown) => Promise<void>;
  stat: (this: unknown) => Promise<{ isDirectory(): boolean }>;
}

test("一次提交的追加在真实 fsync 根上恰好三次同步：候选内容、commits/、删除候选后的 append-candidates/", {
  concurrency: false,
}, async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-append-count-"));
  const root = await RootedDirectory.open(fixtureRoot, "$root", { durability: "fsync" });
  const commitsDirectory = path.join(root.absolutePath, "event-sourcing", "commits");
  const candidatesDirectory = path.join(root.absolutePath, "event-sourcing", "append-candidates");
  const probeHandle = await openFileHandle(path.join(fixtureRoot, "probe"), "w");
  const handlePrototype = Object.getPrototypeOf(probeHandle) as SyncPrototype;
  await probeHandle.close();
  rmSync(path.join(fixtureRoot, "probe"));
  const originalLink = filesystemMutation.link;
  const originalUnlink = filesystemMutation.unlink;
  const originalParentSync = RootedResourceParentHandle.prototype.sync;
  const log: string[] = [];
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    filesystemMutation.link = async (existingPath, newPath) => {
      await originalLink(existingPath, newPath);
      log.push(`link ${path.dirname(existingPath)} -> ${path.dirname(newPath)}`);
    };
    filesystemMutation.unlink = async (target) => {
      await originalUnlink(target);
      log.push(`unlink ${path.dirname(target)}`);
    };
    RootedResourceParentHandle.prototype.sync = async function loggedSync() {
      log.push(
        `parent-sync ${path.dirname(this.resourceAbsolutePath)} target=${
          existsSync(this.resourceAbsolutePath) ? "present" : "absent"
        }`,
      );
      return originalParentSync.call(this);
    };

    const counted = await countFsyncs(async () => {
      // 计数补丁装好之后再包一层，记录每次真实 fsync 落在文件还是目录句柄上。
      const countedSync = handlePrototype.sync;
      handlePrototype.sync = async function orderedSync(this: unknown): Promise<void> {
        const directory = (await handlePrototype.stat.call(this)).isDirectory();
        log.push(directory ? "fsync directory" : "fsync file");
        return countedSync.call(this);
      };
      try {
        return await store.append(prepared());
      } finally {
        handlePrototype.sync = countedSync;
      }
    });

    equal(counted.result.disposition, "committed");
    equal(counted.syncCount, 3);
    equal(counted.directorySyncCount, 2);
    // 索引是缓存，以 `durability: "none"` 发布（自身的链接与暂存删除，零次同步）；三次同步之外
    // 的条目只能来自它。
    const indexDirectory = path.join(root.absolutePath, "event-sourcing", "index");
    const indexEntries = log.slice(7);
    equal(
      indexEntries.every(
        (entry) =>
          (entry.startsWith("link ") || entry.startsWith("unlink ")) &&
          entry.includes(indexDirectory),
      ),
      true,
    );
    deepEqual(log.slice(0, 7), [
      "fsync file",
      `link ${candidatesDirectory} -> ${commitsDirectory}`,
      `parent-sync ${commitsDirectory} target=present`,
      "fsync directory",
      `unlink ${candidatesDirectory}`,
      `parent-sync ${candidatesDirectory} target=absent`,
      "fsync directory",
    ]);
    deepEqual(readdirSync(candidatesDirectory), []);
    deepEqual(readdirSync(commitsDirectory), ["0000000000000001.json"]);
  } finally {
    filesystemMutation.link = originalLink;
    filesystemMutation.unlink = originalUnlink;
    RootedResourceParentHandle.prototype.sync = originalParentSync;
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
