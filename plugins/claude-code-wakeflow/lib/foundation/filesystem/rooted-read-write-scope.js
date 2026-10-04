import { setTimeout as delay } from "node:timers/promises";
import { types } from "node:util";
import { createUuidV4 } from "../identity/uuid-v4.js";
import { parsePlainRecord } from "../data/passive-own-data.js";
import { readMonotonicClock } from "../time/monotonic-clock.js";
import { isMonotonicDeadlineReached, monotonicDeadlineAfter, monotonicDeadlineRemaining } from "../time/monotonic-deadline.js";
import { monotonicDurationFromMilliseconds } from "../time/monotonic-duration.js";
import { parsePortableResourcePath } from "./portable-resource-path.js";
import { acquireRootedExclusiveFileLock, inspectRootedExclusiveFileLock, retireRootedExclusiveFileLockResidue, RootedExclusiveFileLockError, } from "./rooted-exclusive-file-lock.js";
import { readStableResourceDirectory, StableDirectoryReadError } from "./stable-directory-read.js";
import { parseDurableAtomicFileStageFileName, readDurableAtomicFileStageOwnerState, DurableAtomicFileStageAddressError } from "./durable-atomic-file-stage-address.js";
import { unlinkRegularFileExactly } from "./exact-regular-file-unlink.js";
export class RootedReadWriteScopeError extends Error {
    name = "RootedReadWriteScopeError";
    code = "rooted-read-write-scope";
    path = "$scope";
    reason;
    constructor(reason) {
        super(`Read/write admission failed: ${reason}.`);
        this.reason = reason;
    }
}
const READER = /^reader-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.lock$/u;
const MAXIMUM_ENTRIES = 1024;
const RETRY_MILLISECONDS = 20;
function fail(reason) {
    throw new RootedReadWriteScopeError(reason);
}
function optionsOf(value) {
    const record = parsePlainRecord(value, "$options");
    if (Object.keys(record).some((key) => !["signal", "acquireTimeoutMilliseconds", "beforeEnter"].includes(key)))
        fail("input");
    const budget = record.acquireTimeoutMilliseconds ?? 30_000;
    if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget <= 0 || budget > 300_000)
        fail("input");
    if (record.signal !== undefined && (types.isProxy(record.signal) || !(record.signal instanceof AbortSignal)))
        fail("input");
    if (record.beforeEnter !== undefined && (typeof record.beforeEnter !== "function" || types.isProxy(record.beforeEnter)))
        fail("input");
    return { acquireTimeoutMilliseconds: budget,
        ...(record.signal === undefined ? {} : { signal: record.signal }),
        ...(record.beforeEnter === undefined ? {} : { beforeEnter: record.beforeEnter }) };
}
async function retireInactive(root, ref) {
    try {
        const observed = await inspectRootedExclusiveFileLock(root, ref);
        if (observed.status === "absent")
            return false;
        if (observed.ownerState === "unknown")
            fail("recovery-required");
        if (observed.ownerState === "active")
            return true;
        await retireRootedExclusiveFileLockResidue(root, ref, observed);
    }
    catch (error) {
        // Readers release without the admission latch. A changed inspection is not
        // absence or corruption: keep admission closed and inspect again on the next admission attempt.
        if (error instanceof RootedExclusiveFileLockError && error.reason === "residue-changed")
            return true;
        throw error;
    }
    return false;
}
/** No time-based stealing. Only private create stages owned by dead writers are discarded. */
async function entriesOf(root, area) {
    const listing = await readStableResourceDirectory(root, area, { maximumEntries: MAXIMUM_ENTRIES });
    const directory = listing.directoryNode;
    if (directory.permissionBits !== 0o700 ||
        (typeof process.geteuid === "function" && directory.userId !== BigInt(process.geteuid())))
        fail("unsafe");
    const readers = [];
    for (const entry of listing.entries) {
        if (entry.node.kind !== "file" || entry.node.permissionBits !== 0o600 ||
            entry.node.userId !== directory.userId)
            fail("unsafe");
        if (entry.name === "latch.lock" || entry.name === "writer.lock")
            continue;
        if (READER.test(entry.name)) {
            readers.push(entry.resourcePath);
            continue;
        }
        let stage;
        try {
            stage = parseDurableAtomicFileStageFileName(entry.name);
        }
        catch (error) {
            if (error instanceof DurableAtomicFileStageAddressError)
                fail("unsafe");
            throw error;
        }
        if (stage.operation !== "create" || stage.mode !== 0o600)
            fail("unsafe");
        if (readDurableAtomicFileStageOwnerState(stage) !== "inactive")
            fail("recovery-required");
        await unlinkRegularFileExactly(root, entry.resourcePath, { expectedNode: entry.node });
    }
    return readers;
}
/**
 * Reader registration and writer closure share one short latch. A waiting writer keeps
 * writer.lock while readers finish; readers release their own unique files without that latch.
 * Business intents are not owned here: beforeEnter must enforce the caller's recovery reservation.
 */
export async function withRootedReadWriteScope(root, area, mode, operation, value = {}) {
    if ((mode !== "shared" && mode !== "exclusive") || typeof operation !== "function" || types.isProxy(operation))
        fail("input");
    const options = optionsOf(value);
    const budget = options.acquireTimeoutMilliseconds ?? 30_000;
    const deadline = monotonicDeadlineAfter(readMonotonicClock(), monotonicDurationFromMilliseconds(budget));
    const latchRef = parsePortableResourcePath(`${area}/latch.lock`);
    const writerRef = parsePortableResourcePath(`${area}/writer.lock`);
    const readerRef = parsePortableResourcePath(`${area}/reader-${createUuidV4()}.lock`);
    let lease = null;
    const check = () => {
        if (options.signal?.aborted === true)
            fail("aborted");
        if (isMonotonicDeadlineReached(deadline, readMonotonicClock()))
            fail("timeout");
    };
    const wait = async () => {
        check();
        try {
            await delay(RETRY_MILLISECONDS, undefined, options.signal === undefined ? {} : { signal: options.signal });
        }
        catch {
            fail("aborted");
        }
    };
    const lockOptions = () => {
        check();
        const remaining = monotonicDeadlineRemaining(deadline, readMonotonicClock());
        return { acquireTimeoutMilliseconds: Math.max(1, Number((remaining + 999999n) / 1000000n)),
            ...(options.signal === undefined ? {} : { signal: options.signal }) };
    };
    const latched = async (body) => {
        check();
        await retireInactive(root, latchRef);
        const latch = await acquireRootedExclusiveFileLock(root, latchRef, lockOptions());
        try {
            return await body();
        }
        finally {
            await latch.release();
        }
    };
    try {
        while (lease === null) {
            try {
                lease = await latched(async () => {
                    await entriesOf(root, area);
                    if (await retireInactive(root, writerRef))
                        return null;
                    await options.beforeEnter?.();
                    check();
                    const acquired = await acquireRootedExclusiveFileLock(root, mode === "shared" ? readerRef : writerRef, lockOptions());
                    // Ownership begins at acquisition, before the short latch can fail to settle.
                    lease = acquired;
                    return acquired;
                });
            }
            catch (error) {
                if (!transientListing(error))
                    throw error;
            }
            if (lease === null)
                await wait();
        }
        if (mode === "exclusive") {
            let drained = false;
            while (!drained) {
                try {
                    drained = await latched(async () => {
                        let active = false;
                        for (const ref of await entriesOf(root, area))
                            active = await retireInactive(root, ref) || active;
                        return !active;
                    });
                }
                catch (error) {
                    if (!transientListing(error))
                        throw error;
                    // Reader releases can change a listing while the writer is draining it.
                }
                if (!drained)
                    await wait();
            }
        }
        check();
        return await operation();
    }
    finally {
        await lease?.release();
    }
}
function transientListing(error) {
    return error instanceof StableDirectoryReadError &&
        (error.reason === "source-changed" || error.reason === "expectation-changed");
}
