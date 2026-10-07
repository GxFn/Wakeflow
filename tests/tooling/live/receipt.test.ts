import { deepEqual, equal, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runToolingCli } from "../../../tooling/cli.js";
import { captureHostReceipt } from "../../../tooling/live/receipt.js";
import { sha256 } from "../../../tooling/verification/files.js";

test("receipt preserves exact imported request/return bytes and distinguishes both digest conventions", async (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-host-receipt-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const request = path.join(root, "request.json"),
    result = path.join(root, "return.json");
  const requestBytes = Buffer.from(
    '{ "tool": "send", "arguments": {"prompt":"private fixture text"}}\n',
  );
  const resultBytes = Buffer.from(
    '{ "isError": true, "content": [{"type":"text","text":"failure fixture"}], "verified": true }\n',
  );
  writeFileSync(request, requestBytes);
  writeFileSync(result, resultBytes);
  const r = captureHostReceipt(root, request, result);
  equal(r.resultFileDigest, sha256(resultBytes));
  equal(r.resultJsonDigest, sha256(JSON.stringify(JSON.parse(resultBytes.toString()))));
  equal(r.hostEffect, "not-verified");
  equal(r.nativeHostAcceptance, "unverified");
  equal(JSON.stringify(r).includes("private fixture text"), false);
  const directory = path.dirname(path.join(root, r.record));
  deepEqual(readFileSync(path.join(directory, "result.json")), resultBytes);
  deepEqual(readFileSync(path.join(directory, "request.json")), requestBytes);
  equal(JSON.parse(readFileSync(path.join(root, r.record), "utf8")).reportedIsError, true);
  const cli = await runToolingCli(
    ["live", "receipt", "--request", request, "--input", result],
    root,
  );
  equal(cli.status, "recorded");
  writeFileSync(result, '{"isError":true,"isError":false}');
  throws(() => captureHostReceipt(root, request, result), /capture-invalid-json/u);
  mkdirSync(path.join(root, "directory"));
  throws(() => captureHostReceipt(root, request, path.join(root, "directory")));
});
