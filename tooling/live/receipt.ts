import { randomUUID } from "node:crypto";
import path from "node:path";
import { decodeJson, readObservedFile, writeExclusive, writeExclusiveJson } from "../capture/io.js";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { privateDirectory, sha256 } from "../verification/files.js";

/** Preserve imported bytes; an error flag, timestamp or verified claim never attests a host action. */
export function captureHostReceipt(repository: string, requestFile: string, resultFile: string) {
  assertCanonicalDirectory(repository);
  const request = readObservedFile(requestFile, 4 * 1024 * 1024);
  const result = readObservedFile(resultFile, 4 * 1024 * 1024);
  decodeJson(request.bytes);
  const body = decodeJson(result.bytes);
  const id = `receipt-${randomUUID()}`;
  const directory = privateDirectory(repository, `.build/live/receipts/${id}`);
  writeExclusive(path.join(directory, "request.json"), request.bytes);
  writeExclusive(path.join(directory, "result.json"), result.bytes);
  const record = {
    kind: "WakeflowImportedHostReceipt",
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    source: "imported-unverified",
    authorization: "not-established",
    hostEffect: "not-verified",
    nativeHostAcceptance: "unverified",
    requestFileDigest: request.observation.digest,
    resultFileDigest: result.observation.digest,
    resultJsonDigest: sha256(JSON.stringify(body)),
    jsonDigestConvention:
      "sha256 of UTF-8 JSON.stringify(parsed complete tool return), preserving parsed property order; not structuredContent alone",
    reportedIsError: typeof body.isError === "boolean" ? body.isError : null,
  };
  writeExclusiveJson(path.join(directory, "record.json"), record);
  return {
    kind: record.kind,
    schemaVersion: 1,
    status: "recorded",
    exitCode: 0,
    id,
    record: path.relative(repository, path.join(directory, "record.json")),
    requestFileDigest: record.requestFileDigest,
    resultFileDigest: record.resultFileDigest,
    resultJsonDigest: record.resultJsonDigest,
    reportedIsError: record.reportedIsError,
    source: record.source,
    hostEffect: record.hostEffect,
    nativeHostAcceptance: record.nativeHostAcceptance,
  };
}
