import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { executeDemandCompletionRequest } from "../../../src/capabilities/demand/lifecycle.js";
import { executeStatusRequest } from "../../../src/capabilities/observation/service.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { refreshLedgerReadingPagesAfterMaintenance } from "../../../src/application/observation/active-projection-refresh.js";
import { refreshLedgerReadingPages } from "../../../src/governance/observation/ledger-reading-pages.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：账本里的人读页面（open-items I22，1.4 第 3 段）在一个真实归档上的读写。完成一个 Demand
 * 之后，归档修订目录的旁边多出它的一页、账本根上多出历史索引（0644，可进版本库）；页面的内容来自封存的
 * 归档；旁边的页面不干扰归档的定位；刷新是幂等的；页面被删、语言被换都由下一次刷新补上；
 * 渲染上限用完时那一行不给链接；维护之后的那一步从工作区根自己找到账本与语言。
 */

async function complete(root: string, demandId: string): Promise<void> {
  const request = { root, demandId, mode: "preview" as const };
  const preview = await executeDemandCompletionRequest(request, { durability: "none" });
  if (preview.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
  equal(preview.status, "ready");
  const completed = await executeDemandCompletionRequest(
    { ...request, mode: "apply", planDigest: preview.planDigest },
    { durability: "none" },
  );
  if (completed.kind !== "WakeflowDemandCompletionMutation") throw new Error("Expected apply.");
  equal(completed.disposition, "completed");
}

test("完成之后账本里有这个 Demand 的一页与历史索引；内容来自归档；刷新幂等并自愈", {
  timeout: 120_000,
}, async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture({ coverAllCriteria: true });
  try {
    const { demandId } = fixture;
    await complete(fixture.workspacePath, demandId);

    const ledgerPath = path.join(fixture.fixtureRoot, "wakeflow-ledger");
    const demandArchives = path.join(ledgerPath, "archives", demandId);
    const names = readdirSync(demandArchives).sort();
    const revision = names.find((name) => /^[0-9]{10}$/u.test(name));
    if (revision === undefined) throw new Error("Expected one sealed archive.");
    // 页面在修订目录的旁边，不在里面：封存的归档包没有多出文件。
    deepEqual(names, [revision, `${revision}.md`]);
    deepEqual(readdirSync(path.join(demandArchives, revision)).sort(), [
      "manifest.json",
      "payload",
      "verify-report.json",
    ]);
    const pagePath = path.join(demandArchives, `${revision}.md`);
    const historyPath = path.join(ledgerPath, "history.md");
    equal(statSync(pagePath).mode & 0o777, 0o644);
    equal(statSync(historyPath).mode & 0o777, 0o644);

    const page = readFileSync(pagePath, "utf8");
    const manifest = JSON.parse(
      readFileSync(path.join(demandArchives, revision, "manifest.json"), "utf8"),
    ) as { readonly manifestDigest: string; readonly archivedAt: string };
    ok(
      page.includes(`<!-- wakeflow:demand-archive-page:v2:en:${manifest.manifestDigest} -->`),
      page,
    );
    ok(page.includes(`- Demand: \`${demandId}\``));
    ok(page.includes(`- Outcome: completed · archived ${manifest.archivedAt}`));
    for (const heading of [
      "## What was asked",
      "## What changed",
      "## What was verified",
      "## Instructions outside the task package",
      "## What remains",
      "## Measures",
    ]) {
      ok(page.includes(`\n${heading}\n`), heading);
    }
    // 目标、它的逐条结论（记录版本 2）与 Controller 的接受决定都从归档里读出来了。
    ok(page.includes("### Target 1 · implementation"), page);
    ok(page.includes("| Anchor | Claim | Target's result | Observed |"), page);
    ok(/\n1\. \*\*accept\*\* · /u.test(page), page);
    ok(/Recorded steps: [1-9][0-9]* event commits, 1 of them result imports/u.test(page), page);
    ok(/bytes over 1 target, /u.test(page), page);
    // 页面进账本：不带本机路径，也不带任何会话标识。
    equal(page.includes(fixture.fixtureRoot), false);
    equal(/local_[0-9a-f]{8}-/u.test(page), false);

    const history = readFileSync(historyPath, "utf8");
    ok(history.includes("<!-- wakeflow:ledger-history:v1:en -->"));
    ok(
      history.includes(`| completed | [\`${demandId}\`](archives/${demandId}/${revision}.md) |`),
      history,
    );

    // 旁边多了一个文件，归档照样找得到：status 仍读回这份归档。
    const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, {
      root: fixture.workspacePath,
      demandId,
    });
    equal(status.archive?.outcome, "completed");

    const ledgerRoot = await RootedDirectory.open(ledgerPath);
    try {
      // 幂等：标记没变就不重读归档，字节相同就不重写。
      deepEqual(await refreshLedgerReadingPages(ledgerRoot, { language: "en" }), {
        demands: 1,
        pagesWritten: 0,
        pagesPending: 0,
        historyWritten: false,
        unreadable: 0,
      });
      // 页面被删：下一次刷新补上，字节与之前相同。
      rmSync(pagePath);
      const repaired = await refreshLedgerReadingPages(ledgerRoot, { language: "en" });
      equal(repaired.pagesWritten, 1);
      equal(repaired.historyWritten, false);
      equal(readFileSync(pagePath, "utf8"), page);
      // 工作区换了语言：页面与索引都按新语言重写。
      const translated = await refreshLedgerReadingPages(ledgerRoot, { language: "zh-Hans" });
      equal(translated.pagesWritten, 1);
      equal(translated.historyWritten, true);
      ok(readFileSync(pagePath, "utf8").includes("## 要求了什么"));
      ok(readFileSync(historyPath, "utf8").includes("# Wakeflow Demand 历史"));
      // 这一轮的渲染上限用完：页面留给下一轮，索引里那一行不给链接。
      rmSync(pagePath);
      const deferred = await refreshLedgerReadingPages(ledgerRoot, {
        language: "zh-Hans",
        renderLimit: 0,
      });
      equal(deferred.pagesPending, 1);
      equal(deferred.pagesWritten, 0);
      ok(readFileSync(historyPath, "utf8").includes(`| completed | \`${demandId}\` |`));
    } finally {
      await ledgerRoot.close();
    }

    // 维护之后的那一步：从工作区根找到账本与配置的语言，把缺的页面与索引补齐。
    rmSync(historyPath);
    await refreshLedgerReadingPagesAfterMaintenance(fixture.workspaceRoot, undefined);
    equal(readFileSync(pagePath, "utf8"), page);
    equal(readFileSync(historyPath, "utf8"), history);
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});
