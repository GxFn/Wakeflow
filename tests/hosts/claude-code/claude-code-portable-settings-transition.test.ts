import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  planClaudeCodePortableSettingsTransition,
  WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";

test("Claude portable settings creates only the Wakeflow MCP permission", () => {
  const transition = planClaudeCodePortableSettingsTransition(null);
  equal(transition.status, "create");
  const desired = JSON.parse(transition.desiredText ?? "null") as {
    permissions: { allow: string[] };
  };
  deepEqual(desired.permissions.allow, [
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
  ]);
  equal(transition.desiredText?.includes("Bash("), false);
});

test("minimal edit preserves user fields and deduplicates only Wakeflow ownership", () => {
  const source = [
    "{",
    "\t\"theme\": \"dark\",",
    "\t\"permissions\": {",
    "\t\t\"deny\": [\"Read(./.env)\"],",
    `\t\t\"allow\": [\"Read(./docs/**)\", \"${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}\", \"${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}\"]`,
    "\t},",
    "\t\"custom\": { \"preserved\": true }",
    "}",
  ].join("\n");
  const transition = planClaudeCodePortableSettingsTransition(source);
  equal(transition.status, "update");
  const desiredText = transition.desiredText ?? "";
  equal(desiredText.includes("\t\"theme\": \"dark\","), true);
  equal(desiredText.includes("\t\"custom\": { \"preserved\": true }"), true);
  const desired = JSON.parse(desiredText) as {
    permissions: { allow: string[]; deny: string[] };
    custom: { preserved: boolean };
  };
  deepEqual(desired.permissions.allow, [
    "Read(./docs/**)",
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
  ]);
  deepEqual(desired.permissions.deny, ["Read(./.env)"]);
  equal(desired.custom.preserved, true);

  const current = planClaudeCodePortableSettingsTransition(desiredText);
  equal(current.status, "current");
  equal(current.desiredText, null);
});

test("invalid, conflicting, and legacy broad permissions remain blocked", () => {
  const cases = [
    ["{", "syntax"],
    ["{\"permissions\":{},\"permissions\":{}}", "duplicate-key"],
    ["[]", "root-not-object"],
    ["{\"permissions\":[]}", "permissions-not-object"],
    ["{\"permissions\":{\"allow\":[1]}}", "allow-not-string-array"],
    [
      "{\"permissions\":{\"allow\":[\"Bash(git *)\"]}}",
      "legacy-broad-permission-present",
    ],
    ["{/* comment */}", "syntax"],
    ["{\"permissions\":{},}", "syntax"],
  ] as const;
  for (const [source, reason] of cases) {
    const transition = planClaudeCodePortableSettingsTransition(source);
    equal(transition.status, "blocked");
    equal(transition.reason, reason);
    equal(transition.desiredText, null);
  }
});
