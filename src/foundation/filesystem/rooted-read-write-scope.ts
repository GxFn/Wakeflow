import { setTimeout as delay } from "node:timers/promises";
import { types } from "node:util";
import { createUuidV4 } from "../identity/uuid-v4.js";
import { parsePlainRecord } from "../data/passive-own-data.js";
import { readMonotonicClock } from "../time/monotonic-clock.js";
import { isMonotonicDeadlineReached, monotonicDeadlineAfter, monotonicDeadlineRemaining } from "../time/monotonic-deadline.js";
import { monotonicDurationFromMilliseconds } from "../time/monotonic-duration.js";
import { parsePortableResourcePath, type PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  acquireRootedExclusiveFileLock,
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
  type RootedExclusiveFileLockLease,
} from "./rooted-exclusive-file-lock.js";
import { readStableResourceDirectory, StableDirectoryReadError } from "./stable-directory-read.js";
import { parseDurableAtomicFileStageFileName, readDurableAtomicFileStageOwnerState, DurableAtomicFileStageAddressError } from "./durable-atomic-file-stage-address.js";
import { unlinkRegularFileExactly } from "./exact-regular-file-unlink.js";

/** A caller-owned private directory contains only the latch, writer and reader leases. */
export type RootedReadWriteMode = "shared" | "exclusive";
export interface RootedReadWriteScopeOptions {
  readonly signal?: AbortSignal;
  readonly acquireTimeoutMilliseconds?: number;
  /** A bounded owner-specific reservation check, called while admission is serialized. */
  readonly beforeEnter?: () => Promise<void>;
}

export class RootedReadWriteScopeError extends Error {
  override readonly name = "RootedReadWriteScopeError";
  readonly code = "rooted-read-write-scope";
  readonly path = "$scope";
  readonly reason: "input" | "unsafe" | "recovery-required" | "timeout" | "aborted";
  constructor(reason: RootedReadWriteScopeError["reason"]) {
    super(`Read/write admission failed: ${reason}.`);
    this.reason = reason;
  }
}

const READER = /^reader-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.lock$/u;
const MAXIMUM_ENTRIES = 1024;
const RETRY_MILLISECONDS = 20;
/** Shared-only workloads never drain readers: retire dead ones once this many leases pile up (§13.161 F4). */
const READER_RETIREMENT_THRESHOLD = 64;

type OwnerObservation = "absent" | "active" | "unknown" | "retired";

function fail(reason: RootedReadWriteScopeError["reason"]): never {
  throw new RootedReadWriteScopeError(reason);
}

function optionsOf(value: RootedReadWriteScopeOptions): RootedReadWriteScopeOptions {
  const record = parsePlainRecord(value, "$options");
  if (Object.keys(record).some((key) => !["signal", "acquireTimeoutMilliseconds", "beforeEnter"].includes(key))) fail("input");
  const budget = record.acquireTimeoutMilliseconds ?? 30_000;
  if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget <= 0 || budget > 300_000) fail("input");
  if (record.signal !== undefined && (types.isProxy(record.signal) || !(record.signal instanceof AbortSignal))) fail("input");
  if (record.beforeEnter !== undefined && (typeof record.beforeEnter !== "function" || types.isProxy(record.beforeEnter))) fail("input");
  return { acquireTimeoutMilliseconds: budget,
    ...(record.signal === undefined ? {} : { signal: record.signal as AbortSignal }),
    ...(record.beforeEnter === undefined ? {} : { beforeEnter: record.beforeEnter as () => Promise<void> }) };
}

/** An unknown owner is reported, never retired: the caller waits on it like a live one (§13.161 F2). */
async function retireInactive(root: RootedDirectory, ref: PortableResourcePath): Promise<OwnerObservation> {
  try {
    const observed = await inspectRootedExclusiveFileLock(root, ref);
    if (observed.status === "absent") return "absent";
    if (observed.ownerState === "unknown") return "unknown";
    if (observed.ownerState === "active") return "active";
    await retireRootedExclusiveFileLockResidue(root, ref, observed);
  }
  catch (error: unknown) {
    // Readers release without the admission latch. A changed inspection is not
    // absence or corruption: keep admission closed and inspect again on the next admission attempt.
    if (error instanceof RootedExclusiveFileLockError && error.reason === "residue-changed") return "active";
    throw error;
  }
  return "retired";
}

/** No time-based stealing. Only private create stages owned by dead writers are discarded. */
async function entriesOf(root: RootedDirectory, area: PortableResourcePath) {
  const listing = await readStableResourceDirectory(root, area, { maximumEntries: MAXIMUM_ENTRIES });
  const directory = listing.directoryNode;
  if (directory.permissionBits !== 0o700 ||
    (typeof process.geteuid === "function" && directory.userId !== BigInt(process.geteuid()))) fail("unsafe");
  const readers: PortableResourcePath[] = [];
  for (const entry of listing.entries) {
    if (entry.node.kind !== "file" || entry.node.permissionBits !== 0o600 ||
      entry.node.userId !== directory.userId) fail("unsafe");
    if (entry.name === "latch.lock" || entry.name === "writer.lock") continue;
    if (READER.test(entry.name)) { readers.push(entry.resourcePath); continue; }
    let stage;
    try { stage = parseDurableAtomicFileStageFileName(entry.name); }
    catch (error: unknown) {
      if (error instanceof DurableAtomicFileStageAddressError) fail("unsafe");
      throw error;
    }
    if (stage.operation !== "create" || stage.mode !== 0o600) fail("unsafe");
    const owner = readDurableAtomicFileStageOwnerState(stage);
    // A live contender's in-flight latch or lease create stage is not residue (§13.161 F1).
    if (owner === "active") continue;
    if (owner !== "inactive") fail("recovery-required");
    await unlinkRegularFileExactly(root, entry.resourcePath, { expectedNode: entry.node });
  }
  return readers;
}

/**
 * Reader registration and writer closure share one short latch. A waiting writer keeps
 * writer.lock while readers finish; readers release their own unique files without that latch.
 * Business intents are not owned here: beforeEnter must enforce the caller's recovery reservation.
 */
export async function withRootedReadWriteScope<Result>(
  root: RootedDirectory,
  area: PortableResourcePath,
  mode: RootedReadWriteMode,
  operation: () => Promise<Result>,
  value: RootedReadWriteScopeOptions = {},
): Promise<Result> {
  if ((mode !== "shared" && mode !== "exclusive") || typeof operation !== "function" || types.isProxy(operation)) fail("input");
  const options = optionsOf(value);
  const budget = options.acquireTimeoutMilliseconds ?? 30_000;
  const deadline = monotonicDeadlineAfter(readMonotonicClock(), monotonicDurationFromMilliseconds(budget));
  const latchRef = parsePortableResourcePath(`${area}/latch.lock`);
  const writerRef = parsePortableResourcePath(`${area}/writer.lock`);
  const readerRef = parsePortableResourcePath(`${area}/reader-${createUuidV4()}.lock`);
  let lease: Readonly<RootedExclusiveFileLockLease> | null = null;
  // Locks whose latest observation had an unknown owner; a later absent/retired/active
  // observation of the same lock clears it, so a spent budget names the right cause.
  const unknownOwners = new Set<string>();
  const exhausted = (): never => fail(unknownOwners.size > 0 ? "recovery-required" : "timeout");

  const check = () => {
    if (options.signal?.aborted === true) fail("aborted");
    // Waiting on an unknown owner only becomes a recovery request once the budget is spent.
    if (isMonotonicDeadlineReached(deadline, readMonotonicClock())) exhausted();
  };
  /** True while the lock at `ref` is held by a live or unknown owner. */
  const held = async (ref: PortableResourcePath): Promise<boolean> => {
    const owner = await retireInactive(root, ref);
    if (owner === "unknown") unknownOwners.add(ref);
    else unknownOwners.delete(ref);
    return owner === "active" || owner === "unknown";
  };
  const acquire = async (ref: PortableResourcePath) => {
    try { return await acquireRootedExclusiveFileLock(root, ref, lockOptions()); }
    catch (error: unknown) {
      if (error instanceof RootedExclusiveFileLockError && error.reason === "timeout") {
        check();
        exhausted();
      }
      throw error;
    }
  };
  const wait = async () => {
    check();
    try { await delay(RETRY_MILLISECONDS, undefined, options.signal === undefined ? {} : { signal: options.signal }); }
    catch { fail("aborted"); }
  };
  const lockOptions = () => {
    check();
    const remaining = monotonicDeadlineRemaining(deadline, readMonotonicClock());
    return { acquireTimeoutMilliseconds: Math.max(1, Number((remaining + 999_999n) / 1_000_000n)),
      ...(options.signal === undefined ? {} : { signal: options.signal }) };
  };
  const latched = async <Value>(body: () => Promise<Value>): Promise<Value> => {
    check();
    await held(latchRef);
    const latch = await acquire(latchRef);
    try { return await body(); } finally { await latch.release(); }
  };
  try {
    while (lease === null) {
      try {
        lease = await latched(async () => {
          const readers = await entriesOf(root, area);
          if (await held(writerRef)) return null;
          if (mode === "shared" && readers.length >= READER_RETIREMENT_THRESHOLD) {
            for (const ref of readers) await retireInactive(root, ref);
          }
          await options.beforeEnter?.();
          check();
          const acquired = await acquire(mode === "shared" ? readerRef : writerRef);
          // Ownership begins at acquisition, before the short latch can fail to settle.
          lease = acquired;
          return acquired;
        });
      } catch (error: unknown) {
        if (!transientListing(error)) throw error;
      }
      if (lease === null) await wait();
    }
    if (mode === "exclusive") {
      let drained = false;
      while (!drained) {
        try {
          drained = await latched(async () => {
            let active = false;
            for (const ref of await entriesOf(root, area)) active = (await held(ref)) || active;
            return !active;
          });
        } catch (error: unknown) {
          if (!transientListing(error)) throw error;
          // Reader releases can change a listing while the writer is draining it.
        }
        if (!drained) await wait();
      }
    }
    check();
    return await operation();
  } finally {
    await lease?.release();
  }
}

function transientListing(error: unknown): boolean {
  return error instanceof StableDirectoryReadError &&
    (error.reason === "source-changed" || error.reason === "expectation-changed");
}
