import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { scanPrivacy, scanPrivacyText } from "../../src/kernel/privacy-scan.js";

test("凭证类三条规则无条件命中，结果只含类别与位置", () => {
  const text = [
    "first line",
    "-----BEGIN RSA PRIVATE KEY-----",
    "token = abcdefgh12345678",
    "key ghp_abcdefghijklmnopqrstuvwxyz",
  ].join("\n");
  const findings = scanPrivacy(text);
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

test("JWT 的三段 eyJ 形状与 Slack 轮换/刷新令牌按 provider-credential 命中，不复制值（§13.165 F6）", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  // 假令牌在运行时拼出：源码里不能留下令牌形态的字面量，否则 GitHub 的推送保护会把提交当作泄露拦下。
  const slackToken = (kind: string): string => `xox${kind}-${"abcdefghijklmnop"}`;
  const text = [`session=${jwt}`, `refresh ${slackToken("e-1")}`, `rotate ${slackToken("r")}`].join(
    "\n",
  );
  const findings = scanPrivacy(text);
  deepEqual(
    findings.map((finding) => [finding.kind, finding.line]),
    [
      ["provider-credential", 1],
      ["provider-credential", 2],
      ["provider-credential", 3],
    ],
  );
  equal(JSON.stringify(findings).includes("eyJ"), false);
  // 三段里有一段太短，或者只有两段，都不是 JWT；普通 base64 文本不受影响。
  deepEqual(scanPrivacy("eyJhbGci.eyJzdWIi.sig\nZm9vYmFyYmF6cXV4"), []);
});

test("credentials in environment/JSON assignments, authorization and userinfo are findings", () => {
  const secret = "synthetic".repeat(3);
  const samples = [
    `DATABASE_PASSWORD=${secret}`,
    `AWS_SECRET_ACCESS_KEY = '${secret}'`,
    `_SERVICE_TOKEN=${secret}`,
    `数据库_PASSWORD=${secret}`,
    JSON.stringify({ password: secret }),
    `Authorization: Bearer ${secret}`,
    JSON.stringify({ Authorization: `Basic ${secret}` }),
    `Authorization: Token ${secret}`,
    `postgres://example:${secret}@host.invalid/db`,
    // §13.161 B9-2：框架常见的密钥名
    `SECRET_KEY=${secret}`,
    `DJANGO_SECRET_KEY = '${secret}'`,
    `secret_key_base: ${secret}`,
    `ENCRYPTION_KEY=${secret}`,
    `APP_KEY=base64:${secret}`,
    ...["ghs_", "ghu_", "ghr_", "glpat-", "npm_"].map((prefix) => prefix + "a".repeat(32)),
  ];
  for (const sample of samples) {
    const findings = scanPrivacy(sample);
    equal(
      findings.some((f) => f.kind === "credential-assignment" || f.kind === "provider-credential"),
      true,
    );
    equal(JSON.stringify(findings).includes(secret), false);
  }
  equal(scanPrivacy("TOKEN_COUNT=123456789 and MAX_TOKENS=987654321").length, 0);
  equal(scanPrivacy("-----BEGIN PGP PRIVATE KEY BLOCK-----")[0]?.kind, "private-key");
  // §13.161 B9-7：标题后换行接正文不是赋值。
  equal(scanPrivacy("## Password:\nRequirements for passphrases follow.").length, 0);
  equal(scanPrivacy("https://host.invalid/docs#authentication").length, 0);
});

test("CSI formatting has a source offset map; unknown controls remain opaque and cannot hide credentials", () => {
  const secret = "synthetic".repeat(3);
  const text = `first\n\u001b[31mDATABASE_PASS\u001b[0mWORD=${secret}\n`;
  const scanned = scanPrivacyText(text);
  equal(scanned.opaque, false);
  const finding = scanned.findings.find(
    (f) => f.kind === "credential-assignment" && f.column === 6,
  );
  equal(finding?.line, 2);
  equal(finding?.length, `DATABASE_PASS\u001b[0mWORD=${secret}`.length);
  deepEqual(scanPrivacyText("\u001b[32mclean\u001b[0m"), { opaque: false, findings: [] });
  for (const text of [`\u0000PASSWORD=${secret}`, `\u001b]0;token=${secret}\u0007`]) {
    const result = scanPrivacyText(text);
    equal(result.opaque, true);
    equal(
      result.findings.some((f) => f.kind === "credential-assignment"),
      true,
    );
  }
});

test("nested terminal formatting is stripped layer by layer: a credential behind a split escape is still found", () => {
  const secret = "synthetic".repeat(3);
  // Removing the inner sequence joins the outer one's two halves; one stripping pass left `[31m` glued
  // to the key name and the assignment went unseen (found by the command model, seed 20261003).
  const text = `\n\u001b\u001b[31m[31mPASSWORD=${secret}\n\u001b[0m\u001b[0m`;
  const scanned = scanPrivacyText(text);
  equal(scanned.opaque, false);
  deepEqual(
    scanned.findings.map((finding) => [finding.kind, finding.line]),
    [["credential-assignment", 2]],
  );
  equal(JSON.stringify(scanned).includes(secret), false);
});

test("路径与 UUID 不是命中：扫描只认凭证（ADR-0031，1.4 第 5 段）", () => {
  // 这两类在 1.3 之前按白名单判断并拒绝；六轮现场里命中的都不是秘密。这里钉住的是"不再拒绝"。
  for (const text of [
    "cwd:/Users/other/private/file.txt",
    "file:///Users/other/private/file.txt",
    "~/.ssh/config and $HOME/notes.txt",
    String.raw`C:\Users\Other\private.txt`,
    "GET /api/v1/users returns 200",
    "id cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "session 0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    "demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ])
    deepEqual(scanPrivacy(text), [], text);
  // 路径里夹着凭证时，凭证照样命中。
  deepEqual(
    scanPrivacy("see /Users/other/.env where API_KEY=abcdefgh12345678").map((f) => f.kind),
    ["credential-assignment"],
  );
});
