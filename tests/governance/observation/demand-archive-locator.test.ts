import { equal, ok, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory } from "../../../src/foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../../src/foundation/filesystem/stable-file-read.js";
import { locateLatestDemandArchive } from "../../../src/governance/observation/demand-archive-locator.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { demandArchivesRootRef } from "../../../src/kernel/layout.js";

/**
 * 归档回执定位（`wakeflow_status{demandId}`）：清单读取失败必须和目录列举失败一样带稳定错误码。
 * 基础层的 StableFileReadError / StrictTextFileError / DeterministicJsonDocumentError 都不是
 * WakeflowError，逃逸出去会被外层收敛成 `unexpected`，取消原因与坏清单原因都会丢失。
 */

const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111";
const ARCHIVE_REVISION = "0000000007";
const MAXIMUM_ARCHIVES_PER_DEMAND = 4096;

const MANIFEST_TEXT = renderDeterministicJsonDocument({
  outcome: "completed",
  archivedAt: "2026-09-18T04:05:06Z",
  terminalEvent: {
    eventId: "demand-event_22222222-2222-4222-8222-222222222222",
    streamRevision: 7,
  },
  manifestDigest: `sha256:${"a".repeat(64)}`,
});

interface Fixture {
  readonly ledgerRoot: RootedDirectory;
  readonly manifestPath: string;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-archive-locator-")));
  const ledgerPath = path.join(base, "ledger");
  const archivePath = path.join(ledgerPath, "archives", DEMAND_ID, ARCHIVE_REVISION);
  mkdirSync(archivePath, { recursive: true });
  const manifestPath = path.join(archivePath, "manifest.json");
  writeFileSync(manifestPath, MANIFEST_TEXT, "utf8");
  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  t.after(async () => {
    await ledgerRoot.close();
    rmSync(base, { recursive: true, force: true });
  });
  return { ledgerRoot, manifestPath };
}

interface ObservedSignal {
  readonly signal: AbortSignal;
  reads(): number;
}

/**
 * 真实的 AbortSignal（不是 Proxy，仍能通过基础层的 isAbortSignal 校验），
 * 只把实例上的 `aborted` 换成一个受控读数：`abortAfter` 次读取之后才变成已取消。
 */
function observedSignal(abortAfter: number | null): ObservedSignal {
  const signal = new AbortController().signal;
  let reads = 0;
  Object.defineProperty(signal, "aborted", {
    configurable: true,
    get(): boolean {
      reads += 1;
      return abortAfter !== null && reads > abortAfter;
    },
  });
  return { signal, reads: () => reads };
}

test("完好的清单给出回执摘要；清单不存在时是编码后的 io-failure，而不是逃逸的基础层错误", async (t) => {
  const { ledgerRoot, manifestPath } = await fixture(t);

  const summary = await locateLatestDemandArchive(ledgerRoot, DEMAND_ID, undefined);
  ok(summary !== null);
  equal(summary.outcome, "completed");
  equal(summary.terminalEvent.streamRevision, 7);
  equal(String(summary.archiveRef), `archives/${DEMAND_ID}/${ARCHIVE_REVISION}`);

  rmSync(manifestPath);
  await rejects(
    locateLatestDemandArchive(ledgerRoot, DEMAND_ID, undefined),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "io-failure" &&
      error.reason === "archive-manifest-not-found" &&
      error.path === "$archive/manifest",
  );
});

test("清单被截断成非法 JSON 时与 summarize 同码：precondition-failed/archive-manifest", async (t) => {
  const { ledgerRoot, manifestPath } = await fixture(t);
  writeFileSync(manifestPath, '{\n  "outcome": "compl\n', "utf8");

  await rejects(
    locateLatestDemandArchive(ledgerRoot, DEMAND_ID, undefined),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "precondition-failed" &&
      error.reason === "archive-manifest" &&
      error.path === "$archive/manifest",
  );
});

test("清单写到一半没有末行换行时报稳定的 io-failure/archive-manifest-final-newline", async (t) => {
  const { ledgerRoot, manifestPath } = await fixture(t);
  writeFileSync(manifestPath, '{\n  "outcome": "compl', "utf8");

  await rejects(
    locateLatestDemandArchive(ledgerRoot, DEMAND_ID, undefined),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "io-failure" &&
      error.reason === "archive-manifest-final-newline",
  );
});

test("取消落在清单读取上时仍是 io-failure/aborted，不会收敛成 unexpected", async (t) => {
  const { ledgerRoot } = await fixture(t);

  // 先用一个只计数、从不取消的信号量出目录列举阶段读取 `aborted` 的确切次数；
  // 再让第 N+1 次读取返回已取消，取消就必然落在随后的清单读取上，不靠时序运气。
  const probe = observedSignal(null);
  await readStableResourceDirectory(ledgerRoot, demandArchivesRootRef(DEMAND_ID), {
    maximumEntries: MAXIMUM_ARCHIVES_PER_DEMAND,
    signal: probe.signal,
  });
  const listingReads = probe.reads();
  ok(listingReads > 0);

  await rejects(
    locateLatestDemandArchive(ledgerRoot, DEMAND_ID, observedSignal(listingReads).signal),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "io-failure" &&
      error.reason === "aborted" &&
      // 取消确实发生在清单读取阶段（列举阶段取消会是 StableDirectoryReadError）。
      error.cause instanceof StableFileReadError,
  );
});
