import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import type { Sha256Digest } from "../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import type { UtcInstant } from "../../src/foundation/time/utc-instant.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import {
  createHostHookObservation,
  HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES,
  HOST_HOOK_RETENTION_MILLISECONDS,
  type HostHookObservationInput,
  readHostHookObservations,
  readHostHookObservationsInterleaved,
  writeHostHookObservation,
} from "../../src/kernel/hook-observations.js";
import { hostHookObservationsRootRef } from "../../src/kernel/layout.js";

async function fixture(
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

const SESSION = "0d1e2f30-1111-4222-8333-444455556666";
const AT = (offset: number): UtcInstant =>
  new Date(Date.UTC(2026, 8, 4, 12, 0, offset)).toISOString() as UtcInstant;

test("hook 观察记录：确定性标识、私有文件、按事件与会话有界读取", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const start = await writeHostHookObservation(root, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: SESSION,
    cwd: `${workspace}/product`,
    recordedAt: AT(0),
  });
  equal(start.disposition, "created");
  equal(start.record.recordId, createHostHookObservation({ ...start.record }).recordId);
  const again = await writeHostHookObservation(root, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: SESSION,
    cwd: `${workspace}/product`,
    recordedAt: AT(0),
  });
  equal(again.disposition, "current");
  await writeHostHookObservation(root, {
    hostId: "claude-code",
    event: "stop",
    sessionId: SESSION,
    cwd: `${workspace}/product`,
    recordedAt: AT(5),
    turnId: "turn-1",
    lastAssistantMessageDigest: `sha256:${"a".repeat(64)}` as Sha256Digest,
  });
  await writeHostHookObservation(root, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: "other-session",
    cwd: `${workspace}/design`,
    recordedAt: AT(9),
  });
  const directory = path.join(
    workspace,
    ".wakeflow-local/runtime/hosts/claude-code/observations/hooks",
  );
  equal(statSync(directory).mode & 0o777, 0o700);
  for (const name of readdirSync(directory)) {
    equal(statSync(path.join(directory, name)).mode & 0o777, 0o600);
  }
  writeFileSync(path.join(directory, "20260904T120010000Z-stop-not-a-uuid.json"), "{}\n");
  writeFileSync(path.join(directory, "stray.txt"), "x\n");

  const all = await readHostHookObservations(root, "claude-code");
  deepEqual(
    all.records.map((record) => [record.event, record.sessionId]),
    [
      ["session-start", SESSION],
      ["stop", SESSION],
      ["session-start", "other-session"],
    ],
  );
  equal(all.skipped, 2);
  const starts = await readHostHookObservations(root, "claude-code", {
    event: "session-start",
    sessionId: SESSION,
  });
  equal(starts.records.length, 1);
  equal(starts.records[0]?.cwd, `${workspace}/product`);
  // 被过滤掉的记录不算 skipped：计数只反映证据通道里读不出来的条目。
  equal(starts.skipped, 2);
  const late = await readHostHookObservations(root, "claude-code", { since: AT(5) });
  deepEqual(
    late.records.map((record) => record.event),
    ["stop", "session-start"],
  );
  equal(late.skipped, 2);
  const limited = await readHostHookObservations(root, "claude-code", { limit: 1 });
  equal(limited.records.length, 1);
  const codex = await readHostHookObservations(root, "codex");
  deepEqual(codex, { records: [], skipped: 0 });
});

test("hook 观察记录拒绝越界输入与同名不同内容", async (t) => {
  const { root, path: workspace } = await fixture(t);
  for (const [patch, reason] of [
    [{ sessionId: "has space" }, "hook-identifier"],
    [{ cwd: "relative/path" }, "hook-cwd"],
    [{ event: "unknown" }, "hook-event"],
    [{ hostId: "vim" }, "host-id"],
    [{ promptDigest: "md5:abc" }, undefined],
  ] as const) {
    throws(
      () =>
        createHostHookObservation({
          hostId: "codex",
          event: "stop",
          sessionId: SESSION,
          cwd: `${workspace}`,
          recordedAt: AT(0),
          ...(patch as object),
        }),
      (error: unknown) =>
        reason === undefined ? true : isWakeflowError(error) && error.reason === reason,
    );
  }
  await writeHostHookObservation(root, {
    hostId: "codex",
    event: "session-start",
    sessionId: SESSION,
    cwd: workspace,
    recordedAt: AT(0),
  });
  const record = createHostHookObservation({
    hostId: "codex",
    event: "session-start",
    sessionId: SESSION,
    cwd: workspace,
    recordedAt: AT(0),
  });
  const file = path.join(
    workspace,
    ".wakeflow-local/runtime/hosts/codex/observations/hooks",
    `20260904T120000000Z-session-start-${record.recordId}.json`,
  );
  writeFileSync(file, '{\n  "tampered": true\n}\n');
  await rejects(
    writeHostHookObservation(root, {
      hostId: "codex",
      event: "session-start",
      sessionId: SESSION,
      cwd: workspace,
      recordedAt: AT(0),
    }),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "precondition-failed" &&
      error.reason === "observation-conflict",
  );
  const inventory = await readHostHookObservations(root, "codex");
  equal(inventory.records.length, 0);
  equal(inventory.skipped, 1);
});

// ---- §13.97 D7：毫秒精度、按龄修剪、列举后消失 ----------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
/** 相对固定"现在"的毫秒形时刻；测试不读墙钟。 */
const ago = (milliseconds: number): UtcInstant =>
  new Date(NOW - milliseconds).toISOString() as UtcInstant;
const compact = (instant: UtcInstant): string => instant.replace(/[-:.]/gu, "");
const OLD_UUID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const OLD_UUID_OTHER = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e";

function hooksDirectory(workspace: string, hostId: "codex" | "claude-code"): string {
  return path.join(workspace, ...hostHookObservationsRootRef(hostId).split("/"));
}

function observation(
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

function recordName(receipt: Awaited<ReturnType<typeof writeHostHookObservation>>): string {
  return `${compact(receipt.record.recordedAt)}-${receipt.record.event}-${receipt.record.recordId}.json`;
}

test("hook 观察记录要求 recordedAt 恰好 3 位小数秒：其他精度写得进去却永远读不出（D7a）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  for (const recordedAt of [
    "2026-09-18T12:00:00Z",
    "2026-09-18T12:00:00.1Z",
    "2026-09-18T12:00:00.12Z",
    "2026-09-18T12:00:00.000000Z",
    "2026-09-18T12:00:00.123456789Z",
  ] as UtcInstant[]) {
    throws(
      () => createHostHookObservation(observation(workspace, recordedAt)),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "invalid-request" &&
        error.reason === "hook-instant-precision",
    );
  }
  equal(
    createHostHookObservation(observation(workspace, "2026-09-18T12:00:00.000Z" as UtcInstant))
      .recordedAt,
    "2026-09-18T12:00:00.000Z",
  );
  equal(HOST_HOOK_RETENTION_MILLISECONDS, 30 * DAY);
  // D7c：读取上限与目录列举上限是同一个内核常量，端点与观察域按它读取，不各自写字面量。
  equal(HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES, 16384);
  await rejects(
    readHostHookObservations(root, "claude-code", {
      limit: HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES + 1,
    }),
    (error: unknown) => isWakeflowError(error) && error.reason === "hook-limit",
  );
  deepEqual(
    await readHostHookObservations(root, "claude-code", {
      limit: HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES,
    }),
    { records: [], skipped: 0 },
  );
  // 中止不被当作"读不出"吞掉。
  await rejects(
    readHostHookObservations(root, "claude-code", {}, { signal: AbortSignal.abort() }),
    (error: unknown) => isWakeflowError(error) && error.code === "io-failure",
  );
});

test("新记录落地后只按龄修剪同一宿主目录：早于 30 天的记录文件被 unlink，边界与更新的保留，无法识别的条目与其他宿主不动（D7b）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  // 按时间倒序写三条：每条落地时目录里最新的"另一条记录"都比它自己更旧，截止基准因此比它更早，
  // 三次写入一条都修剪不掉。第一条落地时目录里没有别的记录命名条目，直接不修剪。
  const stale = await writeHostHookObservation(root, observation(workspace, ago(31 * DAY)));
  const boundary = await writeHostHookObservation(
    root,
    observation(workspace, ago(HOST_HOOK_RETENTION_MILLISECONDS)),
  );
  const young = await writeHostHookObservation(root, observation(workspace, ago(29 * DAY)));
  // 符合记录命名但内容不可用的旧文件：修剪只看名字，照样 unlink。
  const staleGarbage = `20200101T000000000Z-session-end-${OLD_UUID}.json`;
  writeFileSync(path.join(directory, staleGarbage), "garbage\n", { mode: 0o600 });
  // 无法识别的条目留给 verify 的门：非记录命名的文件、记录命名的目录。
  writeFileSync(path.join(directory, "stray.txt"), "x\n", { mode: 0o600 });
  const staleDirectory = `20200101T000000000Z-stop-${OLD_UUID}.json`;
  mkdirSync(path.join(directory, staleDirectory));
  // 另一宿主目录里的旧记录不在本次修剪范围内。
  const codexDirectory = hooksDirectory(workspace, "codex");
  mkdirSync(codexDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(codexDirectory, staleGarbage), "garbage\n", { mode: 0o600 });
  deepEqual(
    readdirSync(directory).sort(),
    [
      staleGarbage,
      staleDirectory,
      recordName(stale),
      recordName(boundary),
      recordName(young),
      "stray.txt",
    ].sort(),
  );

  // 截止基准取"目录里除本条之外最新的记录"与本条 recordedAt 的较小者：此刻最新的另一条是
  // 29 天前的 young，所以基准是 29 天前而不是"现在"，31 天前的 stale 这一轮还留着。
  const settled = await writeHostHookObservation(root, observation(workspace, ago(1)));
  equal(settled.disposition, "created");
  equal(readdirSync(directory).includes(recordName(stale)), true);
  equal(readdirSync(directory).includes(staleGarbage), false);

  // 现在目录里最新的另一条是 1 毫秒前的 settled：基准回到"现在"，30 天以前的才被修剪。
  const latest = await writeHostHookObservation(root, observation(workspace, ago(0)));
  equal(latest.disposition, "created");
  deepEqual(
    readdirSync(directory).sort(),
    [
      staleDirectory,
      recordName(boundary),
      recordName(young),
      recordName(settled),
      recordName(latest),
      "stray.txt",
    ].sort(),
  );
  deepEqual(readdirSync(codexDirectory), [staleGarbage]);

  const inventory = await readHostHookObservations(root, "claude-code");
  deepEqual(
    inventory.records.map((record) => record.recordId),
    [
      boundary.record.recordId,
      young.record.recordId,
      settled.record.recordId,
      latest.record.recordId,
    ],
  );
  // stray.txt 与记录命名的目录读不出，仍计 skipped；被修剪的不计。
  equal(inventory.skipped, 2);
  // 幂等重写没有新证据落地：整条修剪路径跳过，必然过期的记录命名文件要等下一次 created 才消失。
  const expired = `20200101T000000000Z-session-end-${OLD_UUID_OTHER}.json`;
  writeFileSync(path.join(directory, expired), "garbage\n", { mode: 0o600 });
  const again = await writeHostHookObservation(root, observation(workspace, ago(0)));
  equal(again.disposition, "current");
  equal(readdirSync(directory).includes(expired), true);
  const next = await writeHostHookObservation(
    root,
    observation(workspace, ago(0), { event: "session-end" }),
  );
  equal(next.disposition, "created");
  equal(readdirSync(directory).includes(expired), false);
  equal(readdirSync(directory).length, 7);
});

test("宿主时钟跳到未来时一次写入删不掉别的证据：截止基准被目录里已有的记录钳住（D7b）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  const first = await writeHostHookObservation(root, observation(workspace, ago(2 * DAY)));
  const second = await writeHostHookObservation(root, observation(workspace, ago(DAY)));
  // 时钟跳变的宿主交回一条一年后的记录：不钳住基准的话截止线会落到 335 天之后，两条近期记录
  // 会被一次写入连根删掉，远远越过 D7b 的 30 天损失边界。
  const skewed = await writeHostHookObservation(
    root,
    observation(workspace, new Date(NOW + 365 * DAY).toISOString() as UtcInstant, {
      event: "session-end",
    }),
  );
  equal(skewed.disposition, "created");
  deepEqual(
    readdirSync(directory).sort(),
    [recordName(first), recordName(second), recordName(skewed)].sort(),
  );
  const inventory = await readHostHookObservations(root, "claude-code");
  deepEqual(
    inventory.records.map((record) => record.recordId),
    [first.record.recordId, second.record.recordId, skewed.record.recordId],
  );
  equal(inventory.skipped, 0);
});

test("修剪与读取并发：列举后被修剪的记录当作消失、不计 skipped；列举后被顶替的仍计 skipped（D7c）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  // 第二个句柄代表并发写入的 hook 进程；在测试体内确定性关闭，不交给 `t.after`——
  // fixture 的 after 先注册、先运行并删掉临时目录，之后再 close 会让清理挂住。
  const writer = await RootedDirectory.open(workspace);
  try {
    await concurrentPruneDuringRead(root, writer, workspace, directory);
  } finally {
    await writer.close();
  }
});

async function concurrentPruneDuringRead(
  root: RootedDirectory,
  writer: RootedDirectory,
  workspace: string,
  directory: string,
): Promise<void> {
  // 先写两条近期记录再写一条 90 天前的：写 stale 时基准取它自己（更小），所以它自己不被修剪；
  // 之后那条"现在"的写入把基准抬到 28 天前，截止线落在 58 天前，stale 才轮到被修剪。
  const kept = await writeHostHookObservation(writer, observation(workspace, ago(29 * DAY)));
  const replaced = await writeHostHookObservation(
    writer,
    observation(workspace, ago(28 * DAY), { sessionId: "other-session" }),
  );
  const stale = await writeHostHookObservation(writer, observation(workspace, ago(90 * DAY)));
  let interleaved = 0;
  const concurrent = await readHostHookObservationsInterleaved(
    root,
    "claude-code",
    {},
    async () => {
      interleaved += 1;
      // 读取方已列举到 stale、kept、replaced；此刻异步 hook 写入一条新记录并修剪掉 stale。
      await writeHostHookObservation(writer, observation(workspace, ago(0)));
      // 同一时刻另一条被顶替成不同内容：这不是消失，是读不出。
      unlinkSync(path.join(directory, recordName(replaced)));
      writeFileSync(path.join(directory, recordName(replaced)), "{}\n", { mode: 0o600 });
    },
  );
  equal(interleaved, 1);
  deepEqual(
    concurrent.records.map((record) => record.recordId),
    [kept.record.recordId],
  );
  equal(concurrent.skipped, 1);
  equal(readdirSync(directory).includes(recordName(stale)), false);

  const settled = await readHostHookObservations(root, "claude-code");
  equal(settled.records.length, 2);
  equal(settled.skipped, 1);
  unlinkSync(path.join(directory, recordName(replaced)));
  equal((await readHostHookObservations(root, "claude-code")).skipped, 0);
}

/**
 * 越界目录的合成条目：无法识别的名字最便宜，而且修剪按定义不碰它们（D7b），所以填多少个，
 * 修剪之后读取报的 `skipped` 就还是多少个。
 */
const OVERSIZED_UNRECOGNIZED = 16_300;
/** 过期记录数：足以把目录从读取上限之上带回上限之下，又不必 unlink 上万个文件。 */
const OVERSIZED_EXPIRED = 96;

function fillOversizedDirectory(directory: string): void {
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

test("目录越过读取上限时读取整体拒绝；修剪路径的上限更高，一次成功写入即把目录带回可读（D7b/D7c）", {
  timeout: 60_000,
}, async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  const kept = await writeHostHookObservation(root, observation(workspace, ago(DAY)));
  fillOversizedDirectory(directory);
  const before = 1 + OVERSIZED_UNRECOGNIZED + OVERSIZED_EXPIRED;
  equal(readdirSync(directory).length, before);
  // 读取路径的列举上限是 16,384：条目数达到它就整体拒绝，不给出半份证据。
  await rejects(
    readHostHookObservations(root, "claude-code"),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "io-failure" &&
      error.reason === "observation-listing-too-many-entries",
  );
  // 修剪路径的列举上限（65,536）高于读取上限，所以越界之后的一次成功写入仍能修剪。
  const latest = await writeHostHookObservation(root, observation(workspace, ago(0)));
  equal(latest.disposition, "created");
  equal(readdirSync(directory).length, before + 1 - OVERSIZED_EXPIRED);
  const inventory = await readHostHookObservations(root, "claude-code");
  deepEqual(
    inventory.records.map((record) => record.recordId),
    [kept.record.recordId, latest.record.recordId],
  );
  // 修剪永远不动无法识别的条目（它们留给 verify 的门），所以修剪之后 skipped 仍然恰好等于
  // 填充进去的那批文件数：少一个就说明修剪越界删掉了不属于它的东西，多一个就说明有记录读不出。
  equal(inventory.skipped, OVERSIZED_UNRECOGNIZED);
});

test("制品 manifest 摘要是后加的可选键：旧记录没有它读成 null，新记录原样往返（§13.127）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const artifact = `sha256:${"c".repeat(64)}` as Sha256Digest;
  const written = await writeHostHookObservation(
    root,
    observation(workspace, "2026-09-18T12:00:00.000Z" as UtcInstant, {
      event: "session-start",
      artifactManifestDigest: artifact,
    }),
  );
  equal(written.record.artifactManifestDigest, artifact);
  // 旧记录：恰好十二个键，没有 artifactManifestDigest——把内核自己写出的规范文件去掉这个键再放回去。
  const legacy = await writeHostHookObservation(
    root,
    observation(workspace, "2026-09-18T11:00:00.000Z" as UtcInstant, { event: "session-start" }),
  );
  const legacyPath = path.join(hooksDirectory(workspace, "claude-code"), recordName(legacy));
  const rendered = readFileSync(legacyPath, "utf8");
  const parsed = JSON.parse(rendered) as Record<string, unknown>;
  delete parsed.artifactManifestDigest;
  const sorted = Object.fromEntries(
    Object.entries(parsed).sort(([left], [right]) => (left < right ? -1 : 1)),
  );
  writeFileSync(
    legacyPath,
    rendered.startsWith("{\n")
      ? `${JSON.stringify(sorted, null, 2)}\n`
      : `${JSON.stringify(sorted)}\n`,
  );
  const inventory = await readHostHookObservations(root, "claude-code");
  equal(inventory.skipped, 0);
  deepEqual(
    inventory.records.map((record) => [record.recordId, record.artifactManifestDigest]),
    [
      [legacy.record.recordId, null],
      [written.record.recordId, artifact],
    ],
  );
});
