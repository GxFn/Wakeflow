import { parseSha256Digest, Sha256Error } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { parseUtcInstant, UtcInstantError } from "../../foundation/time/utc-instant.js";
import { fail } from "../../kernel/error.js";
import { demandArchiveRef, demandArchivesRootRef } from "../../kernel/layout.js";
const ARCHIVE_NAME_PATTERN = /^[0-9]{10}$/u;
const POD_ID_PATTERN = /^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAXIMUM_ARCHIVES_PER_DEMAND = 4096;
const MANIFEST_MAXIMUM_BYTES = parseByteCount(16 * 1024 * 1024, "$manifest.maximumBytes");
const EVENT_ID_PATTERN = /^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function record(value, path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        fail("precondition-failed", "archive-manifest", path);
    }
    return value;
}
function summarize(demandId, archiveRef, value) {
    const manifest = record(value, "$archive/manifest");
    const terminal = record(manifest.terminalEvent, "$archive/manifest/terminalEvent");
    const outcome = manifest.outcome;
    if (outcome !== "completed" && outcome !== "cancelled") {
        fail("precondition-failed", "archive-manifest", "$archive/manifest/outcome");
    }
    if (typeof terminal.eventId !== "string" || !EVENT_ID_PATTERN.test(terminal.eventId)) {
        fail("precondition-failed", "archive-manifest", "$archive/manifest/terminalEvent/eventId");
    }
    if (!Number.isSafeInteger(terminal.streamRevision) || terminal.streamRevision < 2) {
        fail("precondition-failed", "archive-manifest", "$archive/manifest/terminalEvent/streamRevision");
    }
    let archivedAt;
    let manifestDigest;
    try {
        archivedAt = parseUtcInstant(manifest.archivedAt, "$archive/manifest/archivedAt");
        manifestDigest = parseSha256Digest(manifest.manifestDigest, "$archive/manifest/manifestDigest");
    }
    catch (error) {
        if (error instanceof UtcInstantError || error instanceof Sha256Error) {
            fail("precondition-failed", "archive-manifest", "$archive/manifest", { cause: error });
        }
        throw error;
    }
    return Object.freeze({
        demandId,
        archiveRef,
        outcome,
        archivedAt,
        terminalEvent: Object.freeze({
            eventId: terminal.eventId,
            streamRevision: terminal.streamRevision,
        }),
        manifestDigest,
        podId: typeof manifest.podId === "string" && POD_ID_PATTERN.test(manifest.podId)
            ? manifest.podId
            : null,
    });
}
/**
 * 读回归档清单，读取失败与目录列举同形地编码：取消仍是 `io-failure`/`aborted`，
 * 其余读取与严格文本失败是 `io-failure`/`archive-manifest-<原因>`，
 * 结构坏掉的清单与 `summarize` 共用 `precondition-failed`/`archive-manifest`。
 * 基础层错误不是 WakeflowError，放任它逃逸会被外层收敛成 `unexpected`。
 */
async function readManifest(ledgerRoot, archiveRef, signal) {
    try {
        const read = await readDeterministicJsonFile(ledgerRoot, parsePortableResourcePath(`${archiveRef}/manifest.json`, "$archive"), { maximumBytes: MANIFEST_MAXIMUM_BYTES, ...signalOptions(signal) });
        return read.value;
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("io-failure", `archive-manifest-${error.reason}`, "$archive/manifest", { cause: error });
        }
        if (error instanceof StrictTextFileError) {
            fail("io-failure", `archive-manifest-${error.reason}`, "$archive/manifest", { cause: error });
        }
        if (error instanceof DeterministicJsonDocumentError) {
            fail("precondition-failed", "archive-manifest", "$archive/manifest", { cause: error });
        }
        throw error;
    }
}
/** 一个 Demand 最近的归档包（修订号最大者）的回执摘要；没有归档为 null。 */
export async function locateLatestDemandArchive(ledgerRoot, demandId, signal) {
    let listing;
    try {
        listing = await readStableResourceDirectory(ledgerRoot, demandArchivesRootRef(demandId), {
            maximumEntries: MAXIMUM_ARCHIVES_PER_DEMAND,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "not-found")
            return null;
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("io-failure", `archive-list-${error.reason}`, "$archive", { cause: error });
        }
        throw error;
    }
    const latest = listing.entries
        .filter((entry) => entry.node.kind === "directory" && ARCHIVE_NAME_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .at(-1);
    if (latest === undefined)
        return null;
    const archiveRef = demandArchiveRef(demandId, Number(latest));
    return summarize(demandId, archiveRef, await readManifest(ledgerRoot, archiveRef, signal));
}
