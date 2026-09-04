import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { isWakeflowError } from "../../src/kernel/error.js";
import {
  assertPrivacyClean,
  DEFAULT_ALLOWED_ID_PREFIXES,
  scanPrivacy,
} from "../../src/kernel/privacy-scan.js";

const policy = {
  allowedPathRoots: ["/Users/someone/Workspace", "/Users/someone/ProductA/"],
  allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
};

test("凭证类三条规则无条件命中，结果只含类别与位置", () => {
  const text = [
    "first line",
    "-----BEGIN RSA PRIVATE KEY-----",
    "token = abcdefgh12345678",
    "key ghp_abcdefghijklmnopqrstuvwxyz",
  ].join("\n");
  const findings = scanPrivacy(text, policy);
  deepEqual(
    findings.map((finding) => [finding.kind, finding.line, finding.column]),
    [
      ["private-key", 2, 1],
      ["credential-assignment", 3, 1],
      ["provider-credential", 4, 5],
    ],
  );
  equal(JSON.stringify(findings).includes("ghp_"), false);
});

test("路径与 UUID 按白名单判断", () => {
  equal(scanPrivacy("see /Users/someone/Workspace/docs/a.md", policy).length, 0);
  equal(scanPrivacy("see /Users/someone/ProductA/src/x.ts", policy).length, 0);
  deepEqual(
    scanPrivacy("see /Users/other/secret/file.txt and ~/.ssh/id", policy).map((f) => f.kind),
    ["unlisted-absolute-path", "unlisted-absolute-path"],
  );
  equal(scanPrivacy("demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc", policy).length, 0);
  deepEqual(
    scanPrivacy("id cccccccc-cccc-4ccc-8ccc-cccccccccccc", policy).map((f) => f.kind),
    ["bare-uuid"],
  );
  equal(scanPrivacy("urls like https://example.com/a/b are fine", policy).length, 0);
  equal(scanPrivacy("relative/path/like/this and a/b", policy).length, 0);
});

test("assertPrivacyClean 以第一个命中的类别为原因失败", () => {
  assertPrivacyClean("clean text\n", policy, "$.summary");
  throws(
    () => assertPrivacyClean("password: hunter2hunter2", policy, "$.summary"),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "privacy-violation" &&
      error.reason === "credential-assignment" &&
      error.path === "$.summary",
  );
});
