import path from "node:path";
import { isRecord, readBoundedFile, sha256 } from "../verification/files.js";
import { captureVerificationInput } from "../verification/input-identity.js";
import { compiledTypeScriptTests } from "./run-typescript-tests.js";
import { inspectTestRecording } from "./test-recording.js";

/** Export a complete table proposal. Never update the tracked scheduling input implicitly. */
export function proposeTestDurations(root: string, receiptPath: string) {
  const receipt: unknown = JSON.parse(readBoundedFile(receiptPath).toString("utf8"));
  if (
    !isRecord(receipt) ||
    receipt.kind !== "WakeflowVerificationRun" ||
    receipt.schemaVersion !== 1 ||
    receipt.profile !== "gate" ||
    receipt.status !== "passed" ||
    receipt.inputsUnchanged !== true ||
    !isRecord(receipt.input) ||
    !isRecord(receipt.testEvidence) ||
    typeof receipt.finishedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(receipt.finishedAt)
  )
    throw new Error("A completed full-gate receipt is required.");
  const current = captureVerificationInput(root);
  if (current.digest !== receipt.input.digest || current.commit !== receipt.input.commit)
    throw new Error("The measured repository inputs have changed.");
  const directory = path.dirname(receiptPath);
  for (const [key, name] of [
    ["selection", "test-selection.json"],
    ["events", "test-events.jsonl"],
  ] as const) {
    const identity = receipt.testEvidence[key];
    if (
      !isRecord(identity) ||
      identity.digest !== sha256(readBoundedFile(path.join(directory, name)))
    )
      throw new Error("Test evidence digest changed.");
  }
  const measured = inspectTestRecording(directory);
  if (!measured.passed) throw new Error("Test evidence is not a complete passing run.");
  const expected = compiledTypeScriptTests(root)
    .map((file) =>
      path
        .relative(root, file)
        .split(path.sep)
        .join("/")
        .replace(/^\.build\/tests\/(.*)\.js$/u, "tests/$1.ts"),
    )
    .sort();
  if (JSON.stringify([...measured.selectedFiles].sort()) !== JSON.stringify(expected))
    throw new Error("Receipt does not cover the current complete test inventory.");
  const durationsMs: Record<string, number> = {};
  for (const row of measured.fileDurations) {
    if (
      typeof row.file !== "string" ||
      typeof row.durationMs !== "number" ||
      !Number.isFinite(row.durationMs) ||
      row.durationMs < 0
    )
      throw new Error("Invalid file duration.");
    durationsMs[row.file] = Math.ceil(row.durationMs);
  }
  return {
    note: "Complete measured Node test-file summary durations; excludes worker startup. Scheduling hints only.",
    measuredAt: receipt.finishedAt.slice(0, 10),
    sourceDigest: current.digest,
    sourceCommit: current.commit,
    measurement: {
      concurrency: measured.concurrency,
      files: expected.length,
      receiptDigest: sha256(readBoundedFile(receiptPath)),
    },
    durationsMs: Object.fromEntries(
      Object.entries(durationsMs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
}
