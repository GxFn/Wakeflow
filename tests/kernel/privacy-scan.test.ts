import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { isWakeflowError } from "../../src/kernel/error.js";
import {
  assertPrivacyClean,
  DEFAULT_ALLOWED_ID_PREFIXES,
  type PrivacyScanPolicy,
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

test("JWT 的三段 eyJ 形状与 Slack 轮换/刷新令牌按 provider-credential 命中，不复制值（§13.165 F6）", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  // 假令牌在运行时拼出：源码里不能留下令牌形态的字面量，否则 GitHub 的推送保护会把提交当作泄露拦下。
  const slackToken = (kind: string): string => `xox${kind}-${"abcdefghijklmnop"}`;
  const text = [`session=${jwt}`, `refresh ${slackToken("e-1")}`, `rotate ${slackToken("r")}`].join(
    "\n",
  );
  const findings = scanPrivacy(text, policy);
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
  deepEqual(scanPrivacy("eyJhbGci.eyJzdWIi.sig\nZm9vYmFyYmF6cXV4", policy), []);
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

test("口径可按调用方收窄（open-items F9）：system 只算用户或系统目录与显式文件系统写法，站内路由与模块别名通过；给了私有标识表就只算表里的 UUID", () => {
  const any = { allowedPathRoots: [], allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES };
  const scoped = { ...any, pathScope: "system" as const };
  const kinds = (text: string, scan: PrivacyScanPolicy = scoped) =>
    scanPrivacy(text, scan).map((finding) => finding.kind);
  // 自由文本里的站内路径不是私有路径。
  for (const text of [
    "GET /api/v1/users returns 200",
    "POST /v2/payments/{id}/capture",
    'import x from "@/components/Button"',
    "see /docs/spec.md for the contract",
  ]) {
    deepEqual(kinds(text), [], text);
    deepEqual(kinds(text, any), ["unlisted-absolute-path"], text);
  }
  // 指向用户或系统目录的路径，以及显式的文件系统写法，在收窄的口径下照挡。
  for (const text of [
    "/Users/alice/project/src/a.ts",
    "cwd:/Users/alice/project",
    "path=/home/alice/x",
    "file:///Users/alice/secret.txt",
    "C:\\Users\\alice\\x",
    "the /tmp/out.log file",
    "/etc/hosts was read",
    "~/.ssh/config",
    "$HOME/notes.txt",
  ]) {
    deepEqual(kinds(text), ["unlisted-absolute-path"], text);
  }

  const session = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
  const product = "123e4567-e89b-42d3-a456-426614174000";
  const known = { ...scoped, privateUuids: [session.toUpperCase()] };
  // 产品自己的 UUID 通过；本工作区的会话句柄（不分大小写）照挡；带已知前缀的照旧通过。
  deepEqual(kinds(`request ${product} failed`, known), []);
  deepEqual(kinds(`session ${session}`, known), ["bare-uuid"]);
  deepEqual(kinds(`window_${session}`, known), []);
  // 没给表：任何裸 UUID 都算（缺省不变）。
  deepEqual(kinds(`request ${product} failed`), ["bare-uuid"]);
  // 空表：没有需要挡的私有标识。
  deepEqual(kinds(`request ${product} failed`, { ...scoped, privateUuids: [] }), []);
});
