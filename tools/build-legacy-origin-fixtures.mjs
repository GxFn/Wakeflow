#!/usr/bin/env node

import { readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildWakeflowLegacyOriginFixture,
  summarizeWakeflowLegacyOriginFixture,
  writeWakeflowLegacyOriginFixture,
} from "./lib/wakeflow-legacy-origin-fixtures.mjs";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const ALLOWED_ARGS = new Set(["--json", "--write"]);

// stdin在分配前按8 MiB + 1 probe有界读取；超限请求不会先被readFileSync整体吞入内存。
function readBoundedStdin() {
  const chunks = [];
  const scratch = Buffer.allocUnsafe(64 * 1024);
  let total = 0;
  while (total <= MAX_REQUEST_BYTES) {
    const remaining = (MAX_REQUEST_BYTES + 1) - total;
    const count = readSync(0, scratch, 0, Math.min(scratch.length, remaining), null);
    if (count === 0) break;
    chunks.push(Buffer.from(scratch.subarray(0, count)));
    total += count;
  }
  return Buffer.concat(chunks, total);
}

function publicFailure(error, json) {
  const payload = {
    agentNext: "Correct the closed stdin request or inspect the selected local artifact/static roots; no fixture was written.",
    error: {
      code: typeof error?.code === "string" ? error.code : "wakeflow-legacy-origin-build-failed",
      path: typeof error?.path === "string" ? error.path : "$",
    },
    ok: false,
    scriptComplete: true,
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.error(`Legacy origin fixture build failed: ${payload.error.code} at ${payload.error.path}`);
    console.error(`Agent next: ${payload.agentNext}`);
  }
  process.exitCode = 1;
}

export function runWakeflowLegacyOriginFixtureBuilder({
  argv = process.argv.slice(2),
  input = null,
  repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
} = {}) {
  const json = argv.includes("--json");
  try {
    const unknown = argv.find((arg) => !ALLOWED_ARGS.has(arg));
    if (unknown || new Set(argv).size !== argv.length) {
      const error = new Error("closed argv rejected");
      error.code = "wakeflow-legacy-origin-argv";
      error.path = "$/argv";
      throw error;
    }
    const bytes = input === null ? readBoundedStdin() : Buffer.from(input);
    if (bytes.length === 0 || bytes.length > MAX_REQUEST_BYTES) {
      const error = new Error("stdin request size rejected");
      error.code = "wakeflow-legacy-origin-request-bytes";
      error.path = "$/stdin";
      throw error;
    }
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes) || text.charCodeAt(0) === 0xfeff) {
      const error = new Error("stdin encoding rejected");
      error.code = "wakeflow-legacy-origin-request-encoding";
      error.path = "$/stdin";
      throw error;
    }
    let request;
    try {
      request = JSON.parse(text);
    } catch {
      const error = new Error("stdin JSON rejected");
      error.code = "wakeflow-legacy-origin-request-json";
      error.path = "$/stdin";
      throw error;
    }
    const candidate = buildWakeflowLegacyOriginFixture(request);
    const writeResult = argv.includes("--write")
      ? writeWakeflowLegacyOriginFixture({ candidate, repoRoot: path.resolve(repoRoot) })
      : null;
    const summary = summarizeWakeflowLegacyOriginFixture(candidate, {
      mode: writeResult ? "write" : "preview",
      writeResult,
    });
    if (json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`Legacy origin fixture ${summary.originId}: ${summary.mode}`);
      console.log(`Artifact: ${summary.artifactDigest}`);
      console.log(`Fixture: ${summary.fixtureDigest}`);
      console.log(`Eligibility: ${summary.eligibility}`);
      console.log(`Agent next: ${summary.agentNext}`);
    }
    return summary;
  } catch (error) {
    publicFailure(error, json);
    return null;
  }
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsMain) runWakeflowLegacyOriginFixtureBuilder();
