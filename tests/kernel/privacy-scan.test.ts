import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { isWakeflowError } from "../../src/kernel/error.js";
import {
  assertPrivacyClean,
  DEFAULT_ALLOWED_ID_PREFIXES,
  scanPrivacy,
  scanPrivacyText,
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

test("credentials in environment/JSON assignments, authorization and userinfo never inherit path allowances", () => {
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
    const findings = scanPrivacy(sample, policy);
    equal(
      findings.some((f) => f.kind === "credential-assignment" || f.kind === "provider-credential"),
      true,
    );
    equal(JSON.stringify(findings).includes(secret), false);
  }
  equal(scanPrivacy("TOKEN_COUNT=123456789 and MAX_TOKENS=987654321", policy).length, 0);
  equal(scanPrivacy("-----BEGIN PGP PRIVATE KEY BLOCK-----", policy)[0]?.kind, "private-key");
  // §13.161 B9-7：标题后换行接正文不是赋值。
  equal(scanPrivacy("## Password:\nRequirements for passphrases follow.", policy).length, 0);
  equal(scanPrivacy("https://host.invalid/docs#authentication", policy).length, 0);
});

test("path lexing respects Unicode words and regex escapes while detecting explicit filesystem forms", () => {
  for (const text of [
    "BigInt/Symbol/函数/数组/Number",
    String.raw`value.replace(/\s+/g, " ")`,
    "类型/集合/元素",
    "relative/path/readme.md",
    "https://host.invalid/api/orders",
    "profile://host.invalid/account/view",
  ])
    equal(scanPrivacy(text, policy).length, 0, text);
  for (const text of [
    "cwd:/Users/other/private/file.txt",
    "位于/Users/other/private/file.txt",
    "文件file:///Users/other/private/file.txt",
    String.raw`路径C:\Users\Other\private.txt`,
    "file:///Users/other/private/file.txt",
    "$HOME/.ssh/id",
    String.raw`C:\Users\Other\private.txt`,
    String.raw`\\server\share\private.txt`,
  ])
    equal(
      scanPrivacy(text, policy).some((f) => f.kind === "unlisted-absolute-path"),
      true,
      text,
    );
});

test("path containment normalizes dot segments and file URIs without prefix or namespace escapes", () => {
  const scoped = {
    ...policy,
    allowedPathRoots: [
      "/allowed/work",
      String.raw`C:\Allowed\Work`,
      String.raw`\\server\share\Work`,
    ],
  };
  for (const text of [
    "/allowed/work/docs/../readme.md",
    "file:///allowed/work/readme.md",
    String.raw`C:\Allowed\Work\docs\..\readme.md`,
    "C:/Allowed/Work/readme.md",
    String.raw`\\server\share\Work\readme.md`,
  ])
    equal(scanPrivacy(text, scoped).length, 0, text);
  for (const text of [
    "/allowed/work/../../private/key",
    "/allowed/work-other/private",
    "file:///allowed/work/%2e%2e/private/key",
    "file:///allowed/work/readme?other=/Users/other/private",
    String.raw`C:\Allowed\Work\..\private.txt`,
    String.raw`C:\Allowed\Work-other\private.txt`,
    String.raw`\\server\share\Work\..\private.txt`,
  ])
    equal(
      scanPrivacy(text, scoped).some((f) => f.kind === "unlisted-absolute-path"),
      true,
      text,
    );
});

test("CSI formatting has a source offset map; unknown controls remain opaque and cannot hide credentials", () => {
  const secret = "synthetic".repeat(3);
  const text = `first\n\u001b[31mDATABASE_PASS\u001b[0mWORD=${secret}\n`;
  const scanned = scanPrivacyText(text, policy);
  equal(scanned.opaque, false);
  const finding = scanned.findings.find(
    (f) => f.kind === "credential-assignment" && f.column === 6,
  );
  equal(finding?.line, 2);
  equal(finding?.length, `DATABASE_PASS\u001b[0mWORD=${secret}`.length);
  deepEqual(scanPrivacyText("\u001b[32mclean\u001b[0m", policy), { opaque: false, findings: [] });
  equal(scanPrivacy("/Users/someone/Work\u001b[32mspace/readme.md\u001b[0m", policy).length, 0);
  for (const text of [`\u0000PASSWORD=${secret}`, `\u001b]0;token=${secret}\u0007`]) {
    const result = scanPrivacyText(text, policy);
    equal(result.opaque, true);
    equal(
      result.findings.some((f) => f.kind === "credential-assignment"),
      true,
    );
  }
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

test("UUID allowances require an entire recognized prefix; unknown prefixes are still scanned", () => {
  const uuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  for (const prefix of ["", "unknown_", "custom-", "other-demand_", "notdemand_"]) {
    const text = `${prefix}${uuid}`;
    deepEqual(
      scanPrivacy(text, policy),
      [{ kind: "bare-uuid", line: 1, column: prefix.length + 1, length: uuid.length }],
      text,
    );
  }
  for (const allowedIdPrefixes of [[], [""]])
    for (const prefix of ["", "demand_", "unknown_"])
      equal(
        scanPrivacy(`${prefix}${uuid}`, { ...policy, allowedIdPrefixes })[0]?.kind,
        "bare-uuid",
      );
  for (const prefix of DEFAULT_ALLOWED_ID_PREFIXES)
    deepEqual(scanPrivacy(`(${prefix}${uuid})`, policy), []);
  for (const text of [
    `word${uuid}`,
    `${uuid}word`,
    `${uuid}_suffix`,
    `${uuid}-suffix`,
    `0${uuid}0`,
  ])
    deepEqual(scanPrivacy(text, policy), [], text);
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

test("运行时身份前缀与持久身份一样放行：window_binding_ 与 maintenance_operation_ 不是裸 UUID（§13.161 B9-1）", () => {
  const uuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  for (const prefix of ["window_binding_", "maintenance_operation_", "demand_"]) {
    equal(DEFAULT_ALLOWED_ID_PREFIXES.includes(prefix), true, prefix);
    deepEqual(scanPrivacy(`- binding: ${prefix}${uuid}`, policy), [], prefix);
  }
  equal(scanPrivacy(`unknown_binding_${uuid}`, policy)[0]?.kind, "bare-uuid");
});
