import { equal, notEqual, ok } from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planFixtureTargetTask,
} from "./target-task-planning-service.fixture.js";

/**
 * 共享预备基线（plan §11）的不变量：副本必须是彼此隔离、权限位与基线一致的真实工作区。
 * 这里不替身内核，两份工作区都由公共切片真实追加事件。
 */

function modeCensus(root: string): readonly string[] {
  const lines: string[] = [];
  function visit(relative: string): void {
    const absolute = relative.length === 0 ? root : path.join(root, relative);
    for (const name of readdirSync(absolute).sort()) {
      const child = relative.length === 0 ? name : `${relative}/${name}`;
      const stat = lstatSync(path.join(root, child));
      lines.push(`${(stat.mode & 0o7777).toString(8)} ${stat.isDirectory() ? "d" : "f"} ${child}`);
      if (stat.isDirectory()) visit(child);
    }
  }
  visit("");
  return lines;
}

test("共享基线的两份副本是彼此隔离的真实工作区：各自从修订 1 追加规划事件互不影响", async (t) => {
  const first = await createTargetTaskPlanningWorkspaceFixture();
  const second = await createTargetTaskPlanningWorkspaceFixture();
  t.after(async () => {
    await cleanupTargetTaskPlanningWorkspaceFixture(first);
    await cleanupTargetTaskPlanningWorkspaceFixture(second);
  });

  notEqual(first.fixtureRoot, second.fixtureRoot);
  equal(first.recordDigest, second.recordDigest);

  const marker = path.join(first.fixtureRoot, "ProductA", "isolation-marker.txt");
  writeFileSync(marker, "first only\n", { mode: 0o644 });
  equal(existsSync(path.join(second.fixtureRoot, "ProductA", "isolation-marker.txt")), false);

  const plannedFirst = await planFixtureTargetTask(first);
  const plannedSecond = await planFixtureTargetTask(second);
  equal(plannedFirst.targetTask.workType, "implementation");
  equal(plannedSecond.targetTask.workType, "implementation");
  equal(plannedFirst.event.streamRevision, plannedSecond.event.streamRevision);
  // 目标身份由固定输入决定而不是随机分配，所以同档副本得到同一个 targetTaskId。
  equal(plannedFirst.targetTask.targetTaskId, plannedSecond.targetTask.targetTaskId);
});

test("按需复制保留基线权限位：副本的目录 0700 与文件 0600 与不共享基线的工作区逐项一致", async (t) => {
  const shared = await createTargetTaskPlanningWorkspaceFixture();
  const fresh = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
  t.after(async () => {
    await cleanupTargetTaskPlanningWorkspaceFixture(shared);
    await cleanupTargetTaskPlanningWorkspaceFixture(fresh);
  });

  notEqual(shared.fixtureRoot, fresh.fixtureRoot);
  const sharedCensus = modeCensus(shared.fixtureRoot);
  const freshCensus = modeCensus(fresh.fixtureRoot);
  equal(sharedCensus.join("\n"), freshCensus.join("\n"));
  ok(sharedCensus.some((line) => line.startsWith("700 d ")));
  ok(sharedCensus.some((line) => line.startsWith("600 f ")));
  equal(
    sharedCensus.filter((line) => line.startsWith("700 d ")).length,
    freshCensus.filter((line) => line.startsWith("700 d ")).length,
  );
});
