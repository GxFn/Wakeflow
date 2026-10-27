import { equal, ok, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory } from "../../../src/foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../../src/foundation/filesystem/stable-file-read.js";
import {
  describeDemandArchive,
  locateLatestDemandArchive,
} from "../../../src/governance/observation/demand-archive-locator.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { demandArchivesRootRef } from "../../../src/kernel/layout.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 归档回执定位（`wakeflow_status{demandId}`）：清单读取失败必须和目录列举失败一样带稳定错误码。
 * 基础层的 StableFileReadError / StrictTextFileError / DeterministicJsonDocumentError 都不是
 * WakeflowError，逃逸出去会被外层收敛成 `unexpected`，取消原因与坏清单原因都会丢失。
 * 读回的 title/goal/summary 按码点截断：上限处恰为 emoji 时不切开代理对（Codex 审阅 R-ROOT-05）。
 */

const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111";
const ARCHIVE_REVISION = "0000000007";
const MAXIMUM_ARCHIVES_PER_DEMAND = 4096;
/** 读回文本的码点上限，与 demand-archive-locator 的常量一致。 */
const TITLE_MAXIMUM_CODE_POINTS = 256;
const GOAL_MAXIMUM_CODE_POINTS = 512;
const SUMMARY_MAXIMUM_CODE_POINTS = 280;
const TARGET_TASK_ID = "target-task_33333333-3333-4333-8333-333333333333";

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
  readonly archivePath: string;
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
  return { ledgerRoot, archivePath, manifestPath };
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

/** 第 `maximum - 1` 个码点是 emoji，再超出上限：按码元 `slice(0, maximum - 1)` 恰好把它的代理对切开。 */
function straddling(maximum: number, filler: string): string {
  return `${filler.repeat(maximum - 2)}😀${"x".repeat(8)}`;
}

test("读回：title、goal 与已接受目标摘要在上限处恰为 emoji 时仍 well-formed、恰为上限个码点并以省略号结尾（R-ROOT-05）", async (t) => {
  const { ledgerRoot, archivePath } = await fixture(t);
  const payloadPath = path.join(archivePath, "payload");
  mkdirSync(path.join(payloadPath, "event-sourcing", "commits"), { recursive: true });
  writeFileSync(
    path.join(payloadPath, "identity.json"),
    renderDeterministicJsonDocument({
      title: straddling(TITLE_MAXIMUM_CODE_POINTS, "t"),
      goal: straddling(GOAL_MAXIMUM_CODE_POINTS, "g"),
    }),
    "utf8",
  );
  writeFileSync(
    path.join(payloadPath, "event-sourcing", "commits", "0000000000000001.json"),
    renderDeterministicJsonDocument({
      events: [
        {
          eventType: "result.target-result-recorded",
          data: {
            result: {
              workType: "implementation",
              targetTaskId: TARGET_TASK_ID,
              report: {
                summary: straddling(SUMMARY_MAXIMUM_CODE_POINTS, "s"),
                repositoryChange: {
                  branch: "feature/sample",
                  commits: [{ value: "a".repeat(40) }],
                },
              },
            },
          },
        },
        {
          eventType: "review.target-result-decided",
          data: { decision: { targetTaskId: TARGET_TASK_ID, decision: "accept" } },
        },
      ],
    }),
    "utf8",
  );

  const summary = await locateLatestDemandArchive(ledgerRoot, DEMAND_ID, undefined);
  ok(summary !== null);
  const readback = await describeDemandArchive(ledgerRoot, summary, undefined);
  const acceptedSummary = readback.acceptedTargets[0]?.summary ?? null;
  ok(acceptedSummary !== null);
  for (const [text, maximum] of [
    [readback.title, TITLE_MAXIMUM_CODE_POINTS],
    [readback.goal, GOAL_MAXIMUM_CODE_POINTS],
    [acceptedSummary, SUMMARY_MAXIMUM_CODE_POINTS],
  ] as const) {
    equal(text.isWellFormed(), true);
    equal([...text].length, maximum);
    equal(text.endsWith("😀…"), true);
  }
});
