import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  DEMAND_LIFECYCLE_JOURNAL_KIND,
  DEMAND_REBUILDABLE_DIRECTORY_REFS,
  type DemandRecoveryRoute,
  type DemandRootReading,
  demandRecoveryReason,
  demandRecoveryTool,
  inspectDemandRecoveryRoute,
} from "../../../src/governance/demand/demand-interruption.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { demandArchiveRef, demandLifecycleJournalRef } from "../../../src/kernel/layout.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * 1 级（组件，一次性根目录，文件手写）：一个 Demand 停在哪一个被打断的事务上（1.4.1 段 1b）。
 *
 * 钉住的是判断表本身：四类恢复记录的先后（发布标记、证据事务、追加候选、生命周期日志），追加候选只在
 * 根打不开时算数，生命周期日志按"日志的动作 × 根的读法"逐格回答，读不出的记录当作没有，只有中止抛出。
 * 工具名的表在 kernel；它与各切片自己导出的工具名相等由 demand 切片的测试钉住。
 */

const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111";
const OTHER_DEMAND_ID = "demand_22222222-2222-4222-8222-222222222222";
const EVENT_ID = "demand-event_33333333-3333-4333-8333-333333333333";
const OTHER_EVENT_ID = "demand-event_44444444-4444-4444-8444-444444444444";
const DIGEST = `sha256:${"a".repeat(64)}`;

const ABSENT: DemandRootReading = { root: "absent" };
const UNLOADABLE: DemandRootReading = { root: "unloadable" };
const loads = (lifecycle: "active" | "completed" | "cancelled"): DemandRootReading => ({
  root: "loads",
  lifecycle,
});

interface Roots {
  readonly workspacePath: string;
  readonly ledgerPath: string;
  readonly workspace: RootedDirectory;
  readonly ledger: RootedDirectory;
}

async function roots(t: TestContext): Promise<Roots> {
  const base = disposableRoot(t, "wakeflow-demand-interruption-");
  const workspacePath = path.join(base, "workspace");
  const ledgerPath = path.join(base, "ledger");
  mkdirSync(path.join(workspacePath, ...demandFinalRootRef(DEMAND_ID).split("/")), {
    recursive: true,
  });
  mkdirSync(ledgerPath, { recursive: true });
  const workspace = await RootedDirectory.open(workspacePath);
  const ledger = await RootedDirectory.open(ledgerPath);
  t.after(async () => {
    await workspace.close();
    await ledger.close();
  });
  return { workspacePath, ledgerPath, workspace, ledger };
}

function writeIn(base: string, ref: string, text: string): void {
  const file = path.join(base, ...ref.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function inRoot(ref: string): string {
  return `${demandFinalRootRef(DEMAND_ID)}/${ref}`;
}

function writeJournal(
  target: Roots,
  action: string,
  overrides: Readonly<Record<string, unknown>> = {},
): void {
  writeIn(
    target.workspacePath,
    demandLifecycleJournalRef(DEMAND_ID),
    renderDeterministicJsonDocument({
      kind: DEMAND_LIFECYCLE_JOURNAL_KIND,
      schemaVersion: 1,
      plan: { action, demandId: DEMAND_ID, eventId: EVENT_ID },
      planDigest: DIGEST,
      verify: null,
      ...overrides,
    }),
  );
}

function writeArchive(target: Roots, outcome: "completed" | "cancelled", eventId: string): void {
  writeIn(
    target.ledgerPath,
    `${demandArchiveRef(DEMAND_ID, 7)}/manifest.json`,
    renderDeterministicJsonDocument({
      outcome,
      archivedAt: "2026-11-22T00:00:00.000Z",
      manifestDigest: DIGEST,
      terminalEvent: { eventId, streamRevision: 7 },
    }),
  );
}

function makeRebuildableDirectories(target: Roots, except: string | null = null): void {
  for (const directory of DEMAND_REBUILDABLE_DIRECTORY_REFS) {
    if (directory === except) continue;
    mkdirSync(path.join(target.workspacePath, ...inRoot(directory).split("/")), {
      recursive: true,
    });
  }
}

function route(target: Roots, reading: DemandRootReading) {
  return inspectDemandRecoveryRoute(target.workspace, target.ledger, DEMAND_ID, reading);
}

const lifecycle = (action: "complete" | "cancel" | "continue"): DemandRecoveryRoute => ({
  kind: "lifecycle",
  action,
});

test("四类恢复记录各有自己的工具与拒绝原因", () => {
  const cases: readonly (readonly [DemandRecoveryRoute, string, string])[] = [
    [{ kind: "publication" }, "wakeflow_create_demand", "demand-publication"],
    [{ kind: "evidence" }, "wakeflow_record_evidence", "evidence-publication-pending"],
    [{ kind: "append-candidates" }, "wakeflow_maintain_workspace", "append-candidates-pending"],
    [lifecycle("complete"), "wakeflow_complete_demand", "lifecycle-journal-pending"],
    [lifecycle("cancel"), "wakeflow_cancel_demand", "lifecycle-journal-pending"],
    [lifecycle("continue"), "wakeflow_continue_demand", "lifecycle-journal-pending"],
  ];
  for (const [entry, tool, reason] of cases) {
    equal(demandRecoveryTool(entry), tool);
    equal(demandRecoveryReason(entry), reason);
  }
});

test("没有任何恢复记录：三种读法都是 null", async (t) => {
  const target = await roots(t);
  for (const reading of [ABSENT, UNLOADABLE, loads("active"), loads("completed")]) {
    equal(await route(target, reading), null);
  }
});

test("先后：发布标记先于追加候选，追加候选先于证据事务，证据事务先于生命周期日志", async (t) => {
  const target = await roots(t);
  writeJournal(target, "continue");
  deepEqual(await route(target, UNLOADABLE), lifecycle("continue"));

  writeIn(target.workspacePath, inRoot("transactions/managed-evidence-publication.json"), "{}\n");
  deepEqual(await route(target, UNLOADABLE), { kind: "evidence" });

  // 证据事件追加到一半被杀，证据事务与追加候选都留着：先收候选。证据的 recover 在候选还在时被根的清点
  // 拒绝、什么都不改，先点它就是原地打转。
  writeIn(target.workspacePath, inRoot("event-sourcing/append-candidates/pending"), "x");
  deepEqual(await route(target, UNLOADABLE), { kind: "append-candidates" });
  // 根读得出时候选不算数（它是正在进行的追加），轮到证据事务。
  deepEqual(await route(target, loads("active")), { kind: "evidence" });

  writeIn(target.workspacePath, inRoot("transactions/publication.json"), "{}\n");
  deepEqual(await route(target, UNLOADABLE), { kind: "publication" });
  deepEqual(await route(target, loads("active")), { kind: "publication" });
  // 根不在时根里的记录不问：留下的只有日志。
  deepEqual(await route(target, ABSENT), lifecycle("continue"));
});

test("追加候选只在根打不开时算数；空的候选目录不算", async (t) => {
  const target = await roots(t);
  mkdirSync(
    path.join(target.workspacePath, ...inRoot("event-sourcing/append-candidates").split("/")),
    { recursive: true },
  );
  equal(await route(target, UNLOADABLE), null);
  writeIn(target.workspacePath, inRoot("event-sourcing/append-candidates/pending"), "x");
  deepEqual(await route(target, UNLOADABLE), { kind: "append-candidates" });
  equal(await route(target, loads("active")), null);
});

test("continue 的日志：根不在、根是 completed 或 active 时接手；cancelled 不接手；根打不开时只在少了可重建目录时接手", async (t) => {
  const target = await roots(t);
  writeJournal(target, "continue");
  deepEqual(await route(target, ABSENT), lifecycle("continue"));
  deepEqual(await route(target, loads("completed")), lifecycle("continue"));
  deepEqual(await route(target, loads("active")), lifecycle("continue"));
  equal(await route(target, loads("cancelled")), null);

  const missing = DEMAND_REBUILDABLE_DIRECTORY_REFS[3];
  if (missing === undefined) throw new Error("Expected seven rebuildable directories.");
  equal(DEMAND_REBUILDABLE_DIRECTORY_REFS.length, 7);
  makeRebuildableDirectories(target, missing);
  deepEqual(await route(target, UNLOADABLE), lifecycle("continue"));
  makeRebuildableDirectories(target);
  equal(await route(target, UNLOADABLE), null, "七个目录都在的打不开，不是 continue 能治的");
});

for (const [action, terminal, outcome] of [
  ["complete", "completed", "completed"],
  ["cancel", "cancelled", "cancelled"],
] as const) {
  test(`${action} 的日志：根能打开时只在生命周期已是 ${terminal} 时接手，active 不接手`, async (t) => {
    const target = await roots(t);
    writeJournal(target, action);
    deepEqual(await route(target, loads(terminal)), lifecycle(action));
    equal(await route(target, loads("active")), null, "终态事件没有提交，日志只是一份意图");
    equal(await route(target, loads(terminal === "completed" ? "cancelled" : "completed")), null);
  });

  test(`${action} 的日志：根不在或打不开时，只在最近的归档就是这份计划封的时候接手`, async (t) => {
    const target = await roots(t);
    writeJournal(target, action);
    equal(await route(target, ABSENT), null, "没有归档");
    equal(await route(target, UNLOADABLE), null);

    writeArchive(target, outcome, OTHER_EVENT_ID);
    equal(await route(target, ABSENT), null, "归档是别的终态事件封的");

    writeArchive(target, outcome === "completed" ? "cancelled" : "completed", EVENT_ID);
    equal(await route(target, ABSENT), null, "结局不符");

    writeArchive(target, outcome, EVENT_ID);
    deepEqual(await route(target, ABSENT), lifecycle(action));
    deepEqual(await route(target, UNLOADABLE), lifecycle(action));
  });
}

test("日志读不出、种类不对、是别的 Demand 的或动作不认识：当作没有", async (t) => {
  const target = await roots(t);
  writeIn(target.workspacePath, demandLifecycleJournalRef(DEMAND_ID), "not json\n");
  equal(await route(target, ABSENT), null);

  writeJournal(target, "continue", { kind: "SomethingElse" });
  equal(await route(target, ABSENT), null);

  writeJournal(target, "continue", {
    plan: { action: "continue", demandId: OTHER_DEMAND_ID, eventId: EVENT_ID },
  });
  equal(await route(target, ABSENT), null);

  writeJournal(target, "record-decision");
  equal(await route(target, ABSENT), null);

  writeJournal(target, "continue", { plan: null });
  equal(await route(target, ABSENT), null);
});

test("归档清单坏掉：终态日志当作没有出口，不抛出", async (t) => {
  const target = await roots(t);
  writeJournal(target, "complete");
  writeIn(target.ledgerPath, `${demandArchiveRef(DEMAND_ID, 7)}/manifest.json`, "{}\n");
  equal(await route(target, ABSENT), null);
});

test("已中止的信号：抛出 io-failure aborted", async (t) => {
  const target = await roots(t);
  writeJournal(target, "continue");
  const controller = new AbortController();
  controller.abort();
  await rejects(
    inspectDemandRecoveryRoute(target.workspace, target.ledger, DEMAND_ID, ABSENT, {
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof WakeflowError && error.code === "io-failure" && error.reason === "aborted",
  );
});
