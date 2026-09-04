import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import type { Sha256Digest } from "../../src/foundation/crypto/sha256.js";
import type { UtcInstant } from "../../src/foundation/time/utc-instant.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import {
  createHostHookObservation,
  readHostHookObservations,
  writeHostHookObservation,
} from "../../src/kernel/hook-observations.js";

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
  const late = await readHostHookObservations(root, "claude-code", { since: AT(5) });
  deepEqual(
    late.records.map((record) => record.event),
    ["stop", "session-start"],
  );
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
