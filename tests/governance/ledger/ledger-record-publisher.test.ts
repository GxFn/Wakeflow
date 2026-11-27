import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  createDirectoryTreeCandidateDurably,
  planDirectoryTreeCandidate,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { publishDirectoryTreeCandidateDurably } from "../../../src/foundation/filesystem/durable-directory-tree-publication.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { materializeLedgerAuthorityLayout } from "../../../src/governance/ledger/ledger-authority-layout.js";
import {
  ledgerAuthorityRootRef,
  ledgerRecordPublicationStageRef,
} from "../../../src/governance/ledger/ledger-authority-paths.js";
import { loadLedgerAuthorityRecord } from "../../../src/governance/ledger/ledger-authority-reader.js";
import {
  createRequirementRecord,
  type RequirementRecord,
  renderLedgerAuthorityRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
  LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
  LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
  LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
  LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_DURABLE_FILE_MODE,
} from "../../../src/governance/ledger/ledger-authority-storage-policy.js";
import {
  type LedgerAuthorityMemberInput,
  LedgerAuthorityStoreError,
  type LedgerAuthorityStoreErrorReason,
} from "../../../src/governance/ledger/ledger-authority-store-contract.js";
import { publishLedgerAuthorityRecord } from "../../../src/governance/ledger/ledger-record-publisher.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  type FixtureDocument,
  fixtureDocuments,
  requirementMembers,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

useDisposableDurability();

/**
 * 直接覆盖单记录暂存发布编排：输入准入、首次提交、幂等复用、被打断之后的续做、补不了的暂存残留
 * 删掉重建一次（1.4.1 深审 directory-trees 的两条：0700 暂存与空的或短的成员）与锁门控。级别 1（组件）。
 */

const OTHER_REQUIREMENT_ID = "requirement_22222222-2222-4222-8222-222222222222";
const MEMBERS = requirementMembers();
const CANDIDATE_OPTIONS = {
  directoryMode: LEDGER_DURABLE_DIRECTORY_MODE,
  maximumDepth: LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
  maximumEntries: LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
  maximumFileBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
  maximumFiles: LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
  maximumTotalBytes: LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
} as const;

async function expectStoreError(
  action: () => unknown,
  reason: LedgerAuthorityStoreErrorReason,
  errorPath?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof LedgerAuthorityStoreError)) {
    throw new Error(`Expected LedgerAuthorityStoreError ${reason}.`);
  }
  equal(caught.reason, reason);
  if (errorPath !== undefined) equal(caught.path, errorPath);
}

async function ledgerRoot(t: TestContext) {
  const rootPath = disposableRoot(t, "wakeflow-ledger-publisher-");
  const root = await RootedDirectory.open(rootPath);
  t.after(() => root.close());
  await materializeLedgerAuthorityLayout(root);
  return { rootPath, root };
}

function physical(rootPath: string, ref: string): string {
  return path.join(rootPath, ...ref.split("/"));
}

function requirementRecord(
  title: string,
  requirementId: `requirement_${string}` = FIXTURE_REQUIREMENT_ID,
  documents: readonly FixtureDocument[] = fixtureDocuments(),
): Readonly<RequirementRecord> {
  return createRequirementRecord(requirementRecordDraft({ requirementId, title }, documents), {
    clock: () => FIXTURE_RECORDED_AT,
  });
}

function publication(
  record: Readonly<RequirementRecord>,
  members: readonly LedgerAuthorityMemberInput[] = MEMBERS,
) {
  const files = [
    ...members.map((member) => ({
      path: member.path,
      bytes: member.bytes,
      mode: LEDGER_DURABLE_FILE_MODE,
    })),
    {
      path: "record.json",
      bytes: encodeUtf8(renderLedgerAuthorityRecord(record)),
      mode: LEDGER_DURABLE_FILE_MODE,
    },
  ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  planDirectoryTreeCandidate(files, CANDIDATE_OPTIONS);
  return {
    record,
    files,
    refs: {
      finalRootRef: ledgerAuthorityRootRef(record),
      stageRef: ledgerRecordPublicationStageRef(record),
    },
  };
}

/** 一棵目录树的全部条目：相对路径、类型、权限位与文件字节（base64），按路径排序。 */
function treeEntries(directory: string): readonly (readonly [string, string, number, string])[] {
  const entries: (readonly [string, string, number, string])[] = [];
  const walk = (relative: string): void => {
    for (const name of readdirSync(path.join(directory, relative)).sort()) {
      const child = relative === "" ? name : `${relative}/${name}`;
      const childPath = path.join(directory, child);
      const stat = lstatSync(childPath);
      if (stat.isDirectory()) {
        entries.push([child, "directory", stat.mode & 0o777, ""]);
        walk(child);
      } else {
        entries.push([child, "file", stat.mode & 0o777, readFileSync(childPath, "base64")]);
      }
    }
  };
  walk("");
  return entries;
}

/** 文档只有 requirement.md 与 landing.md 之外再带一个附件时，记录树里多一层 `attachments/` 子目录。 */
const NESTED_DOCUMENTS: readonly FixtureDocument[] = [
  ...fixtureDocuments(),
  { role: "attachment", path: "attachments/notes.md", text: "附注正文。\n" },
];

/**
 * 在暂存上造一份崩溃残留，再发同一个请求：发布成功，final 与干净发布逐字节相同（含权限位），
 * `transactions/` 里剩下的与干净发布一样。干净发布在另一个一次性根上做。
 */
async function expectResidueRebuilt(
  t: TestContext,
  documents: readonly FixtureDocument[],
  damage: (
    root: RootedDirectory,
    stagePath: string,
    target: ReturnType<typeof publication>,
  ) => Promise<void>,
): Promise<void> {
  const record = requirementRecord("示例需求", FIXTURE_REQUIREMENT_ID, documents);
  const members = requirementMembers(documents);
  const target = publication(record, members);
  const clean = await ledgerRoot(t);
  equal(
    (await publishLedgerAuthorityRecord(clean.root, record, members, undefined)).wroteAuthority,
    true,
  );

  const { rootPath, root } = await ledgerRoot(t);
  await damage(root, physical(rootPath, target.refs.stageRef), target);
  // 走的是删掉重建：整树删除恰好一次。
  const removeTree = t.mock.method(filesystemMutation, "removeTree");
  const published = await publishLedgerAuthorityRecord(root, record, members, undefined);
  equal(removeTree.mock.callCount(), 1);
  removeTree.mock.restore();
  equal(published.wroteAuthority, true);
  deepEqual(published.loaded.record, record);
  deepEqual(
    treeEntries(physical(rootPath, target.refs.finalRootRef)),
    treeEntries(physical(clean.rootPath, target.refs.finalRootRef)),
  );
  deepEqual(
    readdirSync(path.join(rootPath, "transactions")),
    readdirSync(path.join(clean.rootPath, "transactions")),
  );
}

test("publishes one requirement tree and idempotently reuses the exact committed record", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const record = requirementRecord("示例需求");
  const created = await publishLedgerAuthorityRecord(root, record, MEMBERS, undefined);
  equal(created.wroteAuthority, true);
  deepEqual(created.loaded.record, record);
  equal(created.loaded.recordRef, `requirements/${FIXTURE_REQUIREMENT_ID}/record.json`);
  deepEqual(
    created.loaded.documents.map((document) => [document.role, document.memberRef]),
    [
      ["landing", `requirements/${FIXTURE_REQUIREMENT_ID}/landing.md`],
      ["requirement", `requirements/${FIXTURE_REQUIREMENT_ID}/requirement.md`],
    ],
  );
  const finalPath = physical(rootPath, `requirements/${FIXTURE_REQUIREMENT_ID}`);
  equal(statSync(finalPath).mode & 0o777, LEDGER_DURABLE_DIRECTORY_MODE);
  deepEqual(readdirSync(finalPath).sort(), ["landing.md", "record.json", "requirement.md"]);
  for (const name of readdirSync(finalPath)) {
    equal(statSync(path.join(finalPath, name)).mode & 0o777, LEDGER_DURABLE_FILE_MODE);
  }
  equal(
    readFileSync(path.join(finalPath, "record.json"), "utf8"),
    renderLedgerAuthorityRecord(record),
  );
  equal(readFileSync(path.join(finalPath, "landing.md"), "utf8"), FIXTURE_LANDING_MARKDOWN);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);

  const reused = await publishLedgerAuthorityRecord(root, record, MEMBERS, undefined);
  equal(reused.wroteAuthority, false);
  equal(reused.loaded.recordDigest, created.loaded.recordDigest);
  deepEqual(
    (await loadLedgerAuthorityRecord(root, record.requirementId, undefined)).record,
    record,
  );

  // 发布之间的互斥不在这一层：调用方持有工作区的账本记录锁（ADR-0033），所以这里一个接一个地发。
  const results = [
    await publishLedgerAuthorityRecord(
      root,
      requirementRecord("Sequential", OTHER_REQUIREMENT_ID),
      MEMBERS,
      undefined,
    ),
    await publishLedgerAuthorityRecord(
      root,
      requirementRecord("Sequential", OTHER_REQUIREMENT_ID),
      MEMBERS,
      undefined,
    ),
  ];
  deepEqual(
    results.map((result) => result.wroteAuthority),
    [true, false],
  );

  await expectStoreError(
    () =>
      publishLedgerAuthorityRecord(
        root,
        requirementRecord("Conflicting title"),
        MEMBERS,
        undefined,
      ),
    "conflict",
    "$record",
  );
  await expectStoreError(
    () =>
      publishLedgerAuthorityRecord(
        root,
        record,
        requirementMembers(fixtureDocuments({ landing: "# 改动\n" })),
        undefined,
      ),
    "member",
    "$members/0",
  );
  equal(readFileSync(path.join(finalPath, "landing.md"), "utf8"), FIXTURE_LANDING_MARKDOWN);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
});

test("rejects malformed records and members before touching the ledger", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const record = requirementRecord("示例需求");
  const [landing, requirement] = MEMBERS;
  if (landing === undefined || requirement === undefined) {
    throw new Error("Expected two fixture members.");
  }
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, { ...record, title: 1 }, MEMBERS, undefined),
    "input",
    "$record",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, null as never, undefined),
    "input",
    "$members",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, [landing], undefined),
    "member",
    "$members",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, [requirement, landing], undefined),
    "member",
    "$members/0",
  );
  await expectStoreError(
    () =>
      publishLedgerAuthorityRecord(
        root,
        record,
        [{ ...landing, extra: 1 } as never, requirement],
        undefined,
      ),
    "input",
    "$members/0",
  );
  await expectStoreError(
    () =>
      publishLedgerAuthorityRecord(
        root,
        record,
        [landing, { path: requirement.path, bytes: new Proxy(requirement.bytes, {}) }],
        undefined,
      ),
    "input",
    "$members/1",
  );
  await expectStoreError(
    () =>
      publishLedgerAuthorityRecord(
        root,
        record,
        [
          landing,
          {
            path: requirement.path,
            bytes: new Uint8Array(LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES + 1),
          },
        ],
        undefined,
      ),
    "capacity",
    "$members/1",
  );
  await expectStoreError(
    () =>
      publishLedgerAuthorityRecord(
        root,
        record,
        [landing, { path: requirement.path, bytes: encodeUtf8("# other\n") }],
        undefined,
      ),
    "member",
    "$members/1",
  );
  await expectStoreError(
    () =>
      publishLedgerAuthorityRecord(
        root,
        record,
        [landing, { path: "other.md", bytes: requirement.bytes }],
        undefined,
      ),
    "member",
    "$members/1",
  );
  deepEqual(readdirSync(path.join(rootPath, "requirements")), []);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
});

test("an interrupted publication is resumed from its stage by the same request, and a committed final is reused", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  // 进程死在暂存写到一半：没有任何日志，同一个请求再发一次把暂存补齐并改名生效（ADR-0031，5a 的 A 行）。
  const partial = publication(requirementRecord("Resume staged authority"));
  await createDirectoryAtomically(root, partial.refs.stageRef, {
    mode: LEDGER_DURABLE_DIRECTORY_MODE,
  });
  await createFileCandidateDurably(
    root,
    parsePortableResourcePath(`${partial.refs.stageRef}/record.json`),
    encodeUtf8(renderLedgerAuthorityRecord(partial.record)),
    { mode: LEDGER_DURABLE_FILE_MODE },
  );
  // 合法的部分暂存（已有成员完整且正确，只缺几项）是续做，不是删掉重建：已有成员的 inode 随改名进 final。
  const stagedInode = statSync(physical(rootPath, `${partial.refs.stageRef}/record.json`)).ino;
  const removeTree = t.mock.method(filesystemMutation, "removeTree");
  const resumed = await publishLedgerAuthorityRecord(root, partial.record, MEMBERS, undefined);
  equal(resumed.wroteAuthority, true);
  deepEqual(resumed.loaded.record, partial.record);
  equal(removeTree.mock.callCount(), 0);
  equal(statSync(physical(rootPath, `${partial.refs.finalRootRef}/record.json`)).ino, stagedInode);
  equal(existsSync(physical(rootPath, partial.refs.stageRef)), false);
  equal(
    readFileSync(physical(rootPath, `${partial.refs.finalRootRef}/landing.md`), "utf8"),
    FIXTURE_LANDING_MARKDOWN,
  );

  // 进程死在改名之后：final 已经生效，再发一次只是逐字节核对后复用。
  const committed = publication(requirementRecord("Post-rename recovery", OTHER_REQUIREMENT_ID));
  const candidate = await createDirectoryTreeCandidateDurably(
    root,
    committed.refs.stageRef,
    committed.files,
    CANDIDATE_OPTIONS,
  );
  await publishDirectoryTreeCandidateDurably(root, candidate, committed.refs.finalRootRef);
  const settled = await publishLedgerAuthorityRecord(root, committed.record, MEMBERS, undefined);
  equal(settled.wroteAuthority, false);
  deepEqual(settled.loaded.record, committed.record);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
});

test("a stage directory left at the 0700 birth mode is removed and rebuilt, empty or with complete members", async (t) => {
  // mkdir 之后、chmod 之前进程被杀：空目录停在 0700。
  await expectResidueRebuilt(t, fixtureDocuments(), async (_root, stagePath) => {
    mkdirSync(stagePath, { mode: 0o700 });
    chmodSync(stagePath, 0o700);
  });
  // 掉电时成员都写完了，但目录的 chmod 没有落盘（第 1 段起建造期间不同步目录）。
  await expectResidueRebuilt(t, fixtureDocuments(), async (root, stagePath, target) => {
    await createDirectoryTreeCandidateDurably(
      root,
      target.refs.stageRef,
      target.files,
      CANDIDATE_OPTIONS,
    );
    chmodSync(stagePath, 0o700);
  });
});

test("a stage with an empty 0600 member, a short member or other bytes is removed and rebuilt", async (t) => {
  const stageWithLanding = async (
    root: RootedDirectory,
    stagePath: string,
    target: ReturnType<typeof publication>,
    landing: string,
    mode: number,
  ): Promise<void> => {
    await createDirectoryAtomically(root, target.refs.stageRef, {
      mode: LEDGER_DURABLE_DIRECTORY_MODE,
    });
    await createFileCandidateDurably(
      root,
      parsePortableResourcePath(`${target.refs.stageRef}/record.json`),
      encodeUtf8(renderLedgerAuthorityRecord(target.record)),
      { mode: LEDGER_DURABLE_FILE_MODE },
    );
    writeFileSync(path.join(stagePath, "landing.md"), landing, { mode });
    chmodSync(path.join(stagePath, "landing.md"), mode);
  };
  // 排他新建之后、写内容与 chmod 之前进程被杀：空的，权限位还是出生时的 0600。
  await expectResidueRebuilt(t, fixtureDocuments(), (root, stagePath, target) =>
    stageWithLanding(root, stagePath, target, "", 0o600),
  );
  // 掉电时 chmod 落盘了、内容只落了一半：短的，权限位已经是 0644。
  await expectResidueRebuilt(t, fixtureDocuments(), (root, stagePath, target) =>
    stageWithLanding(root, stagePath, target, FIXTURE_LANDING_MARKDOWN.slice(0, 10), 0o644),
  );
  // 长度对、内容不对（数据块没有落盘）同样是残留。
  await expectResidueRebuilt(t, fixtureDocuments(), (root, stagePath, target) =>
    stageWithLanding(
      root,
      stagePath,
      target,
      "x".repeat(encodeUtf8(FIXTURE_LANDING_MARKDOWN).byteLength),
      0o644,
    ),
  );
});

test("a nested-document stage whose subdirectory is left at 0700 is removed and rebuilt", async (t) => {
  await expectResidueRebuilt(t, NESTED_DOCUMENTS, async (root, stagePath, target) => {
    await createDirectoryTreeCandidateDurably(
      root,
      target.refs.stageRef,
      target.files,
      CANDIDATE_OPTIONS,
    );
    chmodSync(path.join(stagePath, "attachments"), 0o700);
  });
});

test("a residue stage that cannot be removed reports recovery-required, and a rebuild that fails again is a conflict without a second removal", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { record, refs } = publication(requirementRecord("示例需求"));
  const stagePath = physical(rootPath, refs.stageRef);
  const publish = () => publishLedgerAuthorityRecord(root, record, MEMBERS, undefined);
  mkdirSync(stagePath, { mode: 0o700 });
  chmodSync(stagePath, 0o700);

  // 删除失败：不报成功，暂存原样留着，同一个请求再发一次会重做。
  const failing = t.mock.method(filesystemMutation, "removeTree", async () => {
    throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  });
  await expectStoreError(publish, "recovery-required", "$stage");
  equal(failing.mock.callCount(), 1);
  equal(existsSync(stagePath), true);
  equal(existsSync(physical(rootPath, refs.finalRootRef)), false);
  failing.mock.restore();

  // 删除“成功”但目录还在：重建撞上它，照旧报冲突，不再删第二次（不循环）。
  const vacuous = t.mock.method(filesystemMutation, "removeTree", async () => undefined);
  await expectStoreError(publish, "conflict", "$stage");
  equal(vacuous.mock.callCount(), 1);
  equal(existsSync(physical(rootPath, refs.finalRootRef)), false);
  vacuous.mock.restore();

  equal((await publish()).wroteAuthority, true);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
});

test("fails closed on a stage node it did not build, and a stray stage beside a committed final does not block", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { record, refs } = publication(requirementRecord("示例需求"));
  const stagePath = physical(rootPath, refs.stageRef);
  const publish = () => publishLedgerAuthorityRecord(root, record, MEMBERS, undefined);

  // 暂存路径上是个文件：发布器从不在那里造文件，拒绝并且什么都不动。
  writeFileSync(stagePath, "not a stage", { mode: 0o600 });
  await expectStoreError(publish, "conflict", "$stage");
  equal(readFileSync(stagePath, "utf8"), "not a stage");
  equal(existsSync(physical(rootPath, refs.finalRootRef)), false);
  rmSync(stagePath);

  equal((await publish()).wroteAuthority, true);
  // final 生效之后旁边多出一个同名暂存：它不属于任何进行中的发布，不挡住复用，也不被这里清理。
  await createDirectoryAtomically(root, refs.stageRef, { mode: LEDGER_DURABLE_DIRECTORY_MODE });
  equal((await publish()).wroteAuthority, false);
  equal(existsSync(stagePath), true);
});

test("an already aborted signal is reported as aborted before any admission write", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { record, refs } = publication(requirementRecord("示例需求"));
  // 候选树规划先核对信号；§13.169 前这里被映射成 member $members。
  await rejects(
    () => publishLedgerAuthorityRecord(root, record, MEMBERS, AbortSignal.abort()),
    OperationAbortedError,
  );
  equal(existsSync(physical(rootPath, refs.finalRootRef)), false);
});
