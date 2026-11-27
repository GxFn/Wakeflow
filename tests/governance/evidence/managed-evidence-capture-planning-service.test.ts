import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  deriveManagedEvidenceId,
  ManagedEvidenceCapturePlanningService,
  ManagedEvidenceCapturePlanningServiceError,
  type ManagedEvidenceCapturePlanningServiceErrorReason,
} from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { parseManagedEvidenceSourceSelection } from "../../../src/governance/evidence/managed-evidence-source-selection.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_DESIGN_SURFACE_ID,
  EVIDENCE_REPOSITORY_ID,
  fileSelection,
  type ManagedEvidenceCapturePlanningWorkspaceFixture,
  readyCapturePlan,
} from "./managed-evidence-capture-planning-service.fixture.js";

useDisposableDurability();

/**
 * 捕获规划（切片 8 D1 到 D3）：四种来源的零写观察、隐私分类与内容阻塞、由内容派生的身份。
 */

function treeSelection(contentReview: "reject" | "controller-confirmed" = "controller-confirmed") {
  return {
    kind: "test-output",
    source: {
      kind: "managed-path",
      root: { kind: "repository", repositoryId: EVIDENCE_REPOSITORY_ID },
      path: "artifacts/test-run",
      resourceType: "tree",
    },
    contentReview,
  };
}

function service(fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>) {
  return new ManagedEvidenceCapturePlanningService(fixture.publication.workspaceRoot);
}

test("colored and opaque UTF-8 evidence rejects credentials even with controller confirmation", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const file = path.join(fixture.repositoryRoot, "artifacts/test-run/logs/colored.txt");
    const secret = "synthetic".repeat(3);
    for (const text of [
      `\u001b[31mDATABASE_PASS\u001b[0mWORD=${secret}`,
      `\u0000PASSWORD=${secret}`,
      `\u001b]0;Authorization: Bearer ${secret}\u0007`,
      `postgres://example:${secret}@host.invalid/db`,
    ]) {
      writeFileSync(file, text);
      for (const review of ["reject", "controller-confirmed"] as const) {
        const result = await service(fixture).preview(fixture.demandId, treeSelection(review));
        equal(result.status, "blocked");
        if (result.status === "blocked") {
          equal(
            result.review.credentialFindings.some((f) => f.kind === "credential-assignment"),
            true,
          );
        }
      }
    }
    // §13.161 B9-3：夹着非 UTF-8 字节的成员是 opaque，但凭证类命中仍然阻塞，确认也放不过。
    writeFileSync(
      file,
      Buffer.concat([Buffer.from([0xff, 0xfe, 0x00]), Buffer.from(`\nPASSWORD=${secret}\n`)]),
    );
    for (const review of ["reject", "controller-confirmed"] as const) {
      const result = await service(fixture).preview(fixture.demandId, treeSelection(review));
      equal(result.status, "blocked");
      if (result.status === "blocked") {
        equal(
          result.review.credentialFindings.some((f) => f.kind === "credential-assignment"),
          true,
        );
        equal(
          result.review.opaqueFileRefs.some((ref) => String(ref).endsWith("colored.txt")),
          true,
        );
        equal(JSON.stringify(result).includes(secret), false);
      }
    }
    writeFileSync(file, "\u001b[32mtests passed\u001b[0m\n");
    const ready = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "test-output",
          source: {
            kind: "managed-path",
            root: { kind: "repository", repositoryId: EVIDENCE_REPOSITORY_ID },
            path: "artifacts/test-run/logs/colored.txt",
            resourceType: "file",
          },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    deepEqual(ready.manifest.contentReview, {
      disposition: "not-required",
      opaqueFileRefs: [],
      privacyFindings: [],
    });
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

async function expectPlanningError(
  action: () => Promise<unknown>,
  reason: ManagedEvidenceCapturePlanningServiceErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof ManagedEvidenceCapturePlanningServiceError, true);
  if (caught instanceof ManagedEvidenceCapturePlanningServiceError) {
    equal(caught.code, "wakeflow-managed-evidence-capture-planning-service");
    equal(caught.reason, reason);
  }
}

test("目录树来源从真实字节派生 Manifest、由内容派生身份并保持零写", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const clockCalls = { value: 0 };
    const preview = await service(fixture).preview(fixture.demandId, treeSelection(), {
      clock: () => {
        clockCalls.value += 1;
        return EVIDENCE_CAPTURED_AT;
      },
    });
    const plan = readyCapturePlan(preview);
    equal(
      plan.manifest.evidenceId,
      deriveManagedEvidenceId(
        plan.manifest.demandId,
        parseManagedEvidenceSourceSelection(treeSelection()),
        plan.manifest.payload.artifactDigest,
      ),
    );
    equal(plan.manifest.kind, "test-output");
    equal(plan.manifest.capturedAt, EVIDENCE_CAPTURED_AT);
    equal(plan.manifest.recordedBy.windowId, "window_55555555-5555-4555-8555-555555555555");
    equal(plan.manifest.source.kind, "managed-path");
    deepEqual(
      plan.manifest.payload.treeManifest.files.map((file) => file.ref),
      ["logs/report.txt", "screenshots/result.bin"],
    );
    deepEqual(plan.manifest.contentReview, {
      disposition: "controller-confirmed",
      opaqueFileRefs: ["screenshots/result.bin"],
      privacyFindings: [],
    });
    equal(plan.expectedDemand.streamRevision, 1);
    equal(clockCalls.value, 1);
    if (preview.status === "ready") equal(preview.existing, null);
    const basis = {
      kind: plan.kind,
      schemaVersion: plan.schemaVersion,
      configDigest: plan.configDigest,
      expectedDemand: plan.expectedDemand,
      manifest: plan.manifest,
    };
    equal(plan.planDigest, computeCanonicalJsonSha256Digest(basis));
    equal(Object.isFrozen(plan), true);

    // 同一内容再次规划得到同一身份；时间不参与身份。
    const again = readyCapturePlan(
      await service(fixture).preview(fixture.demandId, treeSelection(), {
        clock: () => parseUtcInstant("2026-09-01T21:30:00.000Z"),
      }),
    );
    equal(again.manifest.evidenceId, plan.manifest.evidenceId);
    equal(again.manifest.capturedAt === plan.manifest.capturedAt, false);
    const demandRoot = path.join(
      fixture.publication.workspacePath,
      ...demandFinalRootRef(fixture.demandId).split("/"),
    );
    equal(existsSync(path.join(demandRoot, "artifacts", "managed-evidence")), false);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("文件来源规范化为 content；opaque 成员在 reject 下阻塞，凭证命中永远阻塞", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const plan = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "document",
          source: {
            kind: "managed-path",
            root: { kind: "support-surface", surfaceId: EVIDENCE_DESIGN_SURFACE_ID },
            path: "reports/result.txt",
            resourceType: "file",
          },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    equal(plan.manifest.kind, "document");
    equal(plan.manifest.payload.treeManifest.fileCount, 1);
    equal(plan.manifest.payload.treeManifest.files[0]?.ref, "content");
    deepEqual(plan.manifest.contentReview, {
      disposition: "not-required",
      opaqueFileRefs: [],
      privacyFindings: [],
    });

    const clockCalls = { value: 0 };
    const blocked = await service(fixture).preview(fixture.demandId, treeSelection("reject"), {
      clock: () => {
        clockCalls.value += 1;
        return EVIDENCE_CAPTURED_AT;
      },
    });
    equal(blocked.status, "blocked");
    if (blocked.status === "blocked") {
      deepEqual(blocked.blockers, ["opaque-content:screenshots/result.bin"]);
    }
    equal(clockCalls.value, 0, "a blocked preview never reads the clock");

    writeFileSync(
      path.join(fixture.repositoryRoot, "artifacts/test-run/logs/secret.txt"),
      "token = abcdefghijklmnop\n",
    );
    const credential = await service(fixture).preview(fixture.demandId, treeSelection(), {
      clock: () => EVIDENCE_CAPTURED_AT,
    });
    equal(credential.status, "blocked");
    if (credential.status === "blocked") {
      deepEqual(credential.blockers, ["privacy:credential-assignment:logs/secret.txt:1"]);
      equal(credential.review.credentialFindings.length, 1);
    }
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("路径与 UUID 不是命中（ADR-0031）：reject 下只有 opaque 成员阻塞，确认后的清单不带隐私命中", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    writeFileSync(
      path.join(fixture.repositoryRoot, "artifacts/test-run/logs/paths.txt"),
      "/Users/a/x /Users/b/y\n/tmp/x/123e4567-e89b-42d3-a456-426614174000/out.log\n",
    );
    const rejected = await service(fixture).preview(fixture.demandId, treeSelection("reject"), {
      clock: () => EVIDENCE_CAPTURED_AT,
    });
    equal(rejected.status, "blocked");
    if (rejected.status === "blocked") {
      deepEqual(rejected.blockers, ["opaque-content:screenshots/result.bin"]);
    }
    const confirmed = readyCapturePlan(
      await service(fixture).preview(fixture.demandId, treeSelection(), {
        clock: () => EVIDENCE_CAPTURED_AT,
      }),
    );
    deepEqual(confirmed.manifest.contentReview, {
      disposition: "controller-confirmed",
      opaqueFileRefs: ["screenshots/result.bin"],
      privacyFindings: [],
    });
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("observation 来源只保留 hook 记录的脱敏投影；link 与 commit 是引用投影", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const written = await writeHostHookObservation(fixture.publication.workspaceRoot, {
      hostId: "codex",
      event: "stop",
      sessionId: "codex-host-thread:evidence-fixture",
      cwd: fixture.publication.workspacePath,
      recordedAt: parseUtcInstant("2026-09-01T20:50:00.000Z"),
    });
    const recordId = written.record.recordId;
    const observation = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "hook-observation",
          source: { kind: "observation", hostId: "codex", recordId },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    const source = observation.manifest.source;
    equal(source.kind, "observation");
    if (source.kind === "observation") {
      equal(source.event, "stop");
      equal(source.transcript, "absent");
      equal(source.recordDigest.startsWith("sha256:"), true);
    }
    const rendered = JSON.stringify(observation.manifest);
    equal(rendered.includes("codex-host-thread:evidence-fixture"), false);
    equal(rendered.includes(fixture.publication.workspacePath), false);
    equal(observation.manifest.payload.treeManifest.files[0]?.ref, "content");
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          kind: "transcript",
          source: { kind: "observation", hostId: "codex", recordId },
          contentReview: "reject",
        }),
      "kind",
    );
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          kind: "hook-observation",
          source: {
            kind: "observation",
            hostId: "codex",
            recordId: "99999999-9999-4999-8999-999999999999",
          },
          contentReview: "reject",
        }),
      "source",
    );

    const link = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "link",
          source: { kind: "link", url: "https://example.com/report" },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    deepEqual(link.manifest.source, {
      kind: "link",
      url: "https://example.com/report",
      digest: null,
    });
    const leaking = await service(fixture).preview(
      fixture.demandId,
      {
        kind: "link",
        source: { kind: "link", url: "https://example.com/report?token=abcdefghijklmnop" },
        contentReview: "controller-confirmed",
      },
      { clock: () => EVIDENCE_CAPTURED_AT },
    );
    equal(leaking.status, "blocked");
    if (leaking.status === "blocked") {
      deepEqual(leaking.blockers, ["privacy:credential-assignment:content:1"]);
    }

    const commit = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "commit",
          source: {
            kind: "commit",
            repositoryId: EVIDENCE_REPOSITORY_ID,
            commitOid: "a".repeat(40),
          },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    equal(commit.manifest.kind, "commit");
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          kind: "commit",
          source: {
            kind: "commit",
            repositoryId: "repository_99999999-9999-4999-8999-999999999999",
            commitOid: "a".repeat(40),
          },
          contentReview: "reject",
        }),
      "source-root",
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("捕获规划拒绝未配置的根、资源类型漂移和预取消请求", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          ...treeSelection(),
          source: {
            ...treeSelection().source,
            root: {
              kind: "repository",
              repositoryId: "repository_99999999-9999-4999-8999-999999999999",
            },
          },
        }),
      "source-root",
    );
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          ...treeSelection(),
          source: { ...treeSelection().source, resourceType: "file" },
        }),
      "source-type",
    );
    await expectPlanningError(
      () => service(fixture).preview(fixture.demandId, fileSelection("artifacts/missing.txt")),
      "source",
    );
    // 选择本身 kind 与来源不配是 kind，不再混进 input（§13.134）；选择形状坏了仍是 input。
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          ...fileSelection("artifacts/test-run/logs/report.txt"),
          kind: "transcript",
        }),
      "kind",
    );
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          ...fileSelection("artifacts/test-run/logs/report.txt"),
          contentReview: "maybe",
        }),
      "input",
    );
    // 闭集之外的 kind 是选择本身坏了，不是与来源不配。
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          ...fileSelection("artifacts/test-run/logs/report.txt"),
          kind: "screenshot",
        }),
      "input",
    );
    const controller = new AbortController();
    controller.abort();
    await rejects(
      () =>
        service(fixture).preview(fixture.demandId, treeSelection(), {
          signal: controller.signal,
        }),
      OperationAbortedError,
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("目录树来源深 25 层超出能归档的深度：preview 以 capacity 拒绝，而不是记下完成与取消都读不回的证据（open-items W10）", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const deep = path.join(
      fixture.repositoryRoot,
      "artifacts",
      "deep",
      ...Array.from({ length: 25 }, (_, index) => `d${index}`),
    );
    mkdirSync(deep, { recursive: true, mode: 0o755 });
    writeFileSync(path.join(deep, "leaf.txt"), "deep\n", { mode: 0o644 });
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          ...treeSelection(),
          source: { ...treeSelection().source, path: "artifacts/deep" },
        }),
      "capacity",
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

/** 把夹具里的产品仓库目录变成真实的 git 仓库并提交当前内容；返回提交号与它的树号。 */
function initializeProductRepository(repositoryRoot: string): { commit: string; tree: string } {
  const git = (...args: readonly string[]): string => {
    const result = spawnSync(
      "git",
      ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        shell: false,
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    );
    if (result.status !== 0) throw new Error(`fixture git ${args[0]} failed`);
    return result.stdout.trim();
  };
  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(path.join(repositoryRoot, "feature.txt"), "feature\n", { mode: 0o644 });
  git("add", "feature.txt");
  git("commit", "--quiet", "--message", "feature");
  return { commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}") };
}

test("commit 来源由 Wakeflow 只读地观察（ADR-0028）：仓库里有这个提交时清单带上观察到的事实，没有或不是提交时给出阻塞项", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const { commit, tree } = initializeProductRepository(fixture.repositoryRoot);
    const selectionFor = (commitOid: string) => ({
      kind: "commit" as const,
      source: { kind: "commit" as const, repositoryId: EVIDENCE_REPOSITORY_ID, commitOid },
      contentReview: "reject" as const,
    });
    const options = { clock: () => EVIDENCE_CAPTURED_AT };

    const plan = readyCapturePlan(
      await service(fixture).preview(fixture.demandId, selectionFor(commit), options),
    );
    const source = plan.manifest.source;
    ok(source.kind === "commit" && source.observation !== undefined);
    equal(source.observation.treeOid, tree);
    deepEqual(source.observation.parents, []);
    deepEqual(source.observation.changedPaths, [{ status: "added", path: "feature.txt" }]);
    equal(source.observation.changedPathCount, 1);
    equal(source.observation.changedPathsTruncated, false);
    ok(/^sha256:[0-9a-f]{64}$/u.test(source.observation.patch.digest));
    ok(source.observation.patch.bytes > 0);
    // 同一个提交再规划一次：观察是确定的，身份与清单摘要都不变。
    const again = readyCapturePlan(
      await service(fixture).preview(fixture.demandId, selectionFor(commit), options),
    );
    equal(again.manifest.evidenceId, plan.manifest.evidenceId);
    equal(again.manifest.manifestDigest, plan.manifest.manifestDigest);

    const missingOid = "b".repeat(40);
    const missing = await service(fixture).preview(fixture.demandId, selectionFor(missingOid));
    equal(missing.status, "blocked");
    deepEqual(missing.status === "blocked" ? missing.blockers : [], [
      `commit-unknown:${missingOid}`,
    ]);
    const notCommit = await service(fixture).preview(fixture.demandId, selectionFor(tree));
    deepEqual(notCommit.status === "blocked" ? notCommit.blockers : [], [
      `commit-not-a-commit:${tree}`,
    ]);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("commit 来源拿不到结论时照旧只记引用：产品仓库目录不是 git 仓库，清单里没有 observation", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const plan = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "commit",
          source: {
            kind: "commit",
            repositoryId: EVIDENCE_REPOSITORY_ID,
            commitOid: "c".repeat(40),
          },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    deepEqual(plan.manifest.source, {
      kind: "commit",
      repositoryId: EVIDENCE_REPOSITORY_ID,
      commitOid: "c".repeat(40),
    });
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
