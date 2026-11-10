// hook 观察记录的查询（两个助手共用）：会话启动与 prompt 落地的证据都从这里读，助手从不自己断言落地。

import { lstatSync, opendirSync, realpathSync } from "node:fs";
import path from "node:path";
import { HelperFailure, refuse } from "./failure.mjs";
import { HOOKS, MAX_RECORD_BYTES, ROOT, readBoundedJson } from "./workspace.mjs";

export const HOOK_POLL_MS = 500;
export const DEFAULT_LANDING_WAIT_SECONDS = 3;

// Hook history is either flat v1 or UTC-day/digest-prefix partitions. Stream
// names so unrelated stop records never consume a lookup's in-memory capacity.
/**
 * @param {string} event
 * @param {string} [relative]
 * @param {number} [depth]
 * @returns {Generator<string, void, undefined>}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: moved verbatim from the inline script (1.3.0 batch 1, no behavior change); splitting it is tracked under open-items L2
function* hookNames(event, relative = "", depth = 0) {
  const base = path.join(ROOT, ...HOOKS.split("/"));
  const directory = path.join(base, relative);
  let handle = null;
  try {
    const before = lstatSync(directory);
    if (!before.isDirectory() || before.isSymbolicLink() || realpathSync(directory) !== directory)
      refuse("hook-observations-unavailable");
    handle = opendirSync(directory);
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const partition =
        depth === 0
          ? /^\d{8}$/u.test(entry.name)
          : depth === 1 && /^[0-9a-f]{2}$/u.test(entry.name);
      if (partition) yield* hookNames(event, child, depth + 1);
      else if (entry.name.endsWith(".json") && entry.name.includes(`-${event}-`)) yield child;
    }
    const after = lstatSync(directory);
    if (before.dev !== after.dev || before.ino !== after.ino)
      refuse("hook-observations-unavailable");
  } catch (error) {
    if (relative === "" && handle === null && error?.code === "ENOENT") return;
    if (error instanceof HelperFailure) throw error;
    refuse("hook-observations-unavailable");
  } finally {
    if (handle !== null) {
      try {
        handle.closeSync();
      } catch {
        /* already closed */
      }
    }
  }
}

/**
 * @param {string} name
 * @returns {JsonRecord | null}
 */
function readHookRecord(name) {
  const file = path.join(ROOT, ...HOOKS.split("/"), name);
  const record = readBoundedJson(file, MAX_RECORD_BYTES);
  if (record !== null && typeof record === "object" && typeof record.sessionId === "string")
    return record;
  try {
    lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
  }
  refuse("hook-observations-unavailable");
}

/**
 * 某个会话在某类事件下最新的一条记录；给了摘要就只认 prompt 摘要相符的。
 * @param {string} event
 * @param {string} sessionId
 * @param {string | null} [promptDigest]
 * @returns {JsonRecord | null}
 */
export function latestHookRecord(event, sessionId, promptDigest = null) {
  let latest = null;
  let latestName = "";
  for (const name of hookNames(event)) {
    const record = readHookRecord(name);
    if (
      record === null ||
      record.sessionId !== sessionId ||
      (promptDigest !== null && record.promptDigest !== promptDigest)
    )
      continue;
    const basename = path.basename(name);
    if (basename > latestName) {
      latestName = basename;
      latest = record;
    }
  }
  return latest;
}

// 落地记录（ADR-0027 决定 3）：先找摘要相符的（文本完整），没有再找带着许可标识的（文本被宿主改动）；
// 各取最新一条。服务端按同一规则判定，这里只是让调用方在记录结局之前看到它会怎么判。
/**
 * @param {string} sessionId
 * @param {string} promptDigest
 * @param {readonly string[]} permitIds
 * @returns {LandingMatch | null}
 */
export function landingRecord(sessionId, promptDigest, permitIds) {
  const intact = latestHookRecord("user-prompt-submit", sessionId, promptDigest);
  if (intact !== null) return { record: intact, match: "digest" };
  if (permitIds.length === 0) return null;
  let latest = null;
  let latestName = "";
  for (const name of hookNames("user-prompt-submit")) {
    const record = readHookRecord(name);
    if (record === null || record.sessionId !== sessionId || !Array.isArray(record.promptPermitIds))
      continue;
    if (!record.promptPermitIds.some((id) => permitIds.includes(id))) continue;
    const basename = path.basename(name);
    if (basename > latestName) {
      latestName = basename;
      latest = record;
    }
  }
  return latest === null ? null : { record: latest, match: "identity" };
}

/** @param {number} milliseconds */
export function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** @param {string} sessionId */
export function sessionStartRecord(sessionId) {
  return latestHookRecord("session-start", sessionId);
}

/** @param {string} sessionId */
export function sessionStartNames(sessionId) {
  /** @type {string[]} */
  const names = [];
  for (const name of hookNames("session-start")) {
    const record = readHookRecord(name);
    if (record !== null && record.sessionId === sessionId) {
      if (names.length >= 16384) refuse("hook-query-incomplete");
      names.push(name);
    }
  }
  names.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
  return names;
}

// 续上（--resume）或桌面接手（--desktop --resume）之后的证据是一条新的 session-start 记录：Claude Code 对两者都触发
// SessionStart。只认开始之后新出现的名字，此前已有的那几条不算。
/**
 * @param {string} sessionId
 * @param {ReadonlySet<string>} before
 * @param {number} seconds
 */
export function waitForNewSessionStart(sessionId, before, seconds) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const fresh = sessionStartNames(sessionId).filter((name) => !before.has(name));
    if (fresh.length > 0) {
      const record = readHookRecord(fresh[fresh.length - 1]);
      if (record !== null) return Object.freeze({ status: "observed", record });
    }
    if (Date.now() >= deadline) return Object.freeze({ status: "pending", record: null });
    sleep(HOOK_POLL_MS);
  }
}
