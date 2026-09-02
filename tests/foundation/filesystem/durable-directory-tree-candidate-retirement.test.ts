import { equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createDirectoryTreeCandidateDurably,
  planDirectoryTreeCandidate,
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidateResult,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import {
  retireDirectoryTreeCandidateDurably,
  settleDirectoryTreeCandidateRetirement,
  DurableDirectoryTreeCandidateRetirementError,
  type DurableDirectoryTreeCandidateRetirementErrorReason,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate-retirement.js";
import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";

const STAGE_REF = parsePortableResourcePath(
  "transactions/.managed-evidence.wakeflow-stage",
);
const FILES = [
  {
    path: "manifest.json",
    bytes: encodeUtf8('{"kind":"manifest"}\n'),
    mode: 0o600,
  },
  {
    path: "payload/content.txt",
    bytes: encodeUtf8("evidence\n"),
    mode: 0o600,
  },
  {
    path: "payload/nested/run.mjs",
    bytes: encodeUtf8("export {};\n"),
    mode: 0o700,
  },
] as const;
const OPTIONS = {
  directoryMode: 0o700,
  maximumDepth: 8,
  maximumEntries: 16,
  maximumFileBytes: 1024,
  maximumFiles: 4,
  maximumTotalBytes: 4096,
} as const;

interface RetirementFixture {
  readonly rootPath: string;
  readonly root: RootedDirectory;
  readonly plan: Readonly<DirectoryTreeCandidatePlan>;
  readonly candidate: Readonly<DirectoryTreeCandidateResult>;
}

async function createFixture(): Promise<RetirementFixture> {
  const rootPath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-directory-retirement-"),
  );
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  chmodSync(path.join(rootPath, "transactions"), 0o700);
  const root = await RootedDirectory.open(rootPath);
  const plan = planDirectoryTreeCandidate(FILES, OPTIONS);
  const candidate = await createDirectoryTreeCandidateDurably(
    root,
    STAGE_REF,
    FILES,
    OPTIONS,
  );
  return Object.freeze({ rootPath, root, plan, candidate });
}

async function cleanupFixture(fixture: RetirementFixture): Promise<void> {
  await fixture.root.close();
  rmSync(fixture.rootPath, { recursive: true, force: true });
}

async function expectRetirementError(
  action: () => unknown | Promise<unknown>,
  reason: DurableDirectoryTreeCandidateRetirementErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableDirectoryTreeCandidateRetirementError)) {
    throw new Error("Expected DurableDirectoryTreeCandidateRetirementError.");
  }
  equal(caught.reason, reason);
}

function stagePath(rootPath: string, suffix = ""): string {
  return path.join(
    rootPath,
    ...STAGE_REF.split("/"),
    ...suffix.split("/").filter(Boolean),
  );
}

test("完整candidate按精确清单退休且不触碰同级资源", async () => {
  const fixture = await createFixture();
  try {
    writeFileSync(
      path.join(fixture.rootPath, "transactions", "keep.json"),
      "keep\n",
      {
        mode: 0o600,
      },
    );
    const receipt = await retireDirectoryTreeCandidateDurably(
      fixture.root,
      fixture.candidate,
    );
    equal(receipt.disposition, "retired");
    equal(receipt.candidateRootPath, STAGE_REF);
    equal(receipt.plan.treeDigest, fixture.plan.treeDigest);
    equal(receipt.retiredFileCount, 3);
    equal(receipt.retiredDirectoryCount, 3);
    equal(existsSync(stagePath(fixture.rootPath)), false);
    equal(
      readFileSync(
        path.join(fixture.rootPath, "transactions", "keep.json"),
        "utf8",
      ),
      "keep\n",
    );
    equal(Object.isFrozen(receipt), true);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("首次退休要求完整candidate，未知或缺失成员不会被吞掉", async () => {
  const unknownFixture = await createFixture();
  try {
    writeFileSync(
      stagePath(unknownFixture.rootPath, "unknown.txt"),
      "unknown\n",
      {
        mode: 0o600,
      },
    );
    await expectRetirementError(
      () =>
        retireDirectoryTreeCandidateDurably(
          unknownFixture.root,
          unknownFixture.candidate,
        ),
      "source-changed",
    );
    equal(existsSync(stagePath(unknownFixture.rootPath)), true);
    equal(
      readFileSync(stagePath(unknownFixture.rootPath, "unknown.txt"), "utf8"),
      "unknown\n",
    );
  } finally {
    await cleanupFixture(unknownFixture);
  }

  const partialFixture = await createFixture();
  try {
    rmSync(stagePath(partialFixture.rootPath, "manifest.json"));
    await expectRetirementError(
      () =>
        retireDirectoryTreeCandidateDurably(
          partialFixture.root,
          partialFixture.candidate,
        ),
      "source-changed",
    );
    equal(
      readFileSync(
        stagePath(partialFixture.rootPath, "payload/content.txt"),
        "utf8",
      ),
      "evidence\n",
    );
  } finally {
    await cleanupFixture(partialFixture);
  }
});

test("恢复入口只续接原计划的安全子集并对absent保持观察语义", async () => {
  const fixture = await createFixture();
  try {
    rmSync(stagePath(fixture.rootPath, "payload/nested/run.mjs"));
    rmdirSync(stagePath(fixture.rootPath, "payload/nested"));

    const settled = await settleDirectoryTreeCandidateRetirement(
      fixture.root,
      STAGE_REF,
      fixture.plan,
    );
    equal(settled.disposition, "retired");
    equal(settled.retiredFileCount, 2);
    equal(settled.retiredDirectoryCount, 2);
    equal(existsSync(stagePath(fixture.rootPath)), false);

    const absent = await settleDirectoryTreeCandidateRetirement(
      fixture.root,
      STAGE_REF,
      fixture.plan,
    );
    equal(absent.disposition, "absent");
    equal(absent.retiredFileCount, 0);
    equal(absent.retiredDirectoryCount, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("恢复入口拒绝内容漂移与符号链接，不删除其他计划成员", async () => {
  const changedFixture = await createFixture();
  try {
    writeFileSync(
      stagePath(changedFixture.rootPath, "payload/content.txt"),
      "changed\n",
      { mode: 0o600 },
    );
    await expectRetirementError(
      () =>
        settleDirectoryTreeCandidateRetirement(
          changedFixture.root,
          STAGE_REF,
          changedFixture.plan,
        ),
      "candidate-conflict",
    );
    equal(
      readFileSync(stagePath(changedFixture.rootPath, "manifest.json"), "utf8"),
      '{"kind":"manifest"}\n',
    );
  } finally {
    await cleanupFixture(changedFixture);
  }

  const linkFixture = await createFixture();
  try {
    symlinkSync(
      "manifest.json",
      stagePath(linkFixture.rootPath, "unexpected-link"),
    );
    await expectRetirementError(
      () =>
        settleDirectoryTreeCandidateRetirement(
          linkFixture.root,
          STAGE_REF,
          linkFixture.plan,
        ),
      "candidate-conflict",
    );
    equal(existsSync(stagePath(linkFixture.rootPath, "manifest.json")), true);
  } finally {
    await cleanupFixture(linkFixture);
  }
});

test("取消与行为输入在首个删除提交点之前失败", async () => {
  const fixture = await createFixture();
  try {
    const controller = new AbortController();
    controller.abort();
    await expectRetirementError(
      () =>
        retireDirectoryTreeCandidateDurably(fixture.root, fixture.candidate, {
          signal: controller.signal,
        }),
      "aborted",
    );
    equal(existsSync(stagePath(fixture.rootPath)), true);

    let trapCalls = 0;
    const candidate = new Proxy(fixture.candidate, {
      getPrototypeOf() {
        trapCalls += 1;
        return Object.prototype;
      },
    });
    await expectRetirementError(
      () =>
        retireDirectoryTreeCandidateDurably(
          fixture.root,
          candidate as DirectoryTreeCandidateResult,
        ),
      "input",
    );
    equal(trapCalls, 0);
    equal(existsSync(stagePath(fixture.rootPath)), true);

    const forged = {
      ...fixture.candidate,
      future: true,
    } as unknown as DirectoryTreeCandidateResult;
    await expectRetirementError(
      () => retireDirectoryTreeCandidateDurably(fixture.root, forged),
      "input",
    );
    equal(existsSync(stagePath(fixture.rootPath)), true);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("恢复入口拒绝伪造计划且不接收recursive删除选项", async () => {
  const fixture = await createFixture();
  try {
    const forgedPlan = {
      ...fixture.plan,
      files: fixture.plan.files.slice(1),
    } as DirectoryTreeCandidatePlan;
    await expectRetirementError(
      () =>
        settleDirectoryTreeCandidateRetirement(
          fixture.root,
          STAGE_REF,
          forgedPlan,
        ),
      "input",
    );
    await expectRetirementError(
      () =>
        settleDirectoryTreeCandidateRetirement(
          fixture.root,
          STAGE_REF,
          fixture.plan,
          { recursive: true } as never,
        ),
      "input",
    );
    equal(existsSync(stagePath(fixture.rootPath)), true);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("部分candidate可由恢复入口退休但不能伪装成首次完整candidate", async () => {
  const rootPath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-directory-retirement-partial-"),
  );
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  chmodSync(path.join(rootPath, "transactions"), 0o700);
  const root = await RootedDirectory.open(rootPath);
  try {
    const plan = planDirectoryTreeCandidate(FILES, OPTIONS);
    await createDirectoryAtomically(root, STAGE_REF, { mode: 0o700 });
    await createFileCandidateDurably(
      root,
      parsePortableResourcePath(`${STAGE_REF}/manifest.json`),
      FILES[0].bytes,
      { mode: 0o600 },
    );
    const rootNode = (await root.inspectExistingResource(STAGE_REF)).node;
    const forgedComplete = Object.freeze({
      candidateRootPath: STAGE_REF,
      plan,
      rootNode,
    });
    await expectRetirementError(
      () => retireDirectoryTreeCandidateDurably(root, forgedComplete),
      "candidate-conflict",
    );
    equal(existsSync(stagePath(rootPath)), true);

    const recovered = await settleDirectoryTreeCandidateRetirement(
      root,
      STAGE_REF,
      plan,
    );
    equal(recovered.disposition, "retired");
    equal(recovered.retiredFileCount, 1);
    equal(recovered.retiredDirectoryCount, 1);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
