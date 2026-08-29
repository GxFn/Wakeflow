import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  classifyWakeflowGitignoreExactOutsideRules,
  createWakeflowGitignoreBodyAuthority,
  parseWakeflowGitignoreBodyAuthority,
  WakeflowGitignoreBodyAuthorityError,
  type WakeflowGitignoreBodyAuthorityErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-body-authority.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
} from "../../../src/workspace/workspace-host-resource-profile.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function expectAuthorityError(
  action: () => unknown,
  reason: WakeflowGitignoreBodyAuthorityErrorReason,
  path: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowGitignoreBodyAuthorityError, true);
  if (caught instanceof WakeflowGitignoreBodyAuthorityError) {
    equal(caught.code, "wakeflow-gitignore-body-authority");
    equal(caught.reason, reason);
    equal(caught.path, path);
  }
}

test("Gitignore body authority is one host-neutral deterministic union", () => {
  const authority = createWakeflowGitignoreBodyAuthority([
    codexWorkspaceHostResourceProfile,
    claudeCodeWorkspaceHostResourceProfile,
  ]);
  const rules = [
    "/.claude/settings.local.json",
    "/.wakeflow-active/",
    "/.wakeflow-config-authority.lock",
    "/.wakeflow-gitignore-recomposition.lock",
    "/.wakeflow-local/",
    "/.wakeflow-program-instruction-claude-code.lock",
    "/.wakeflow-program-instruction-codex.lock",
  ];
  const body = `${rules.join("\n")}\n`;
  deepEqual(authority, {
    kind: "WakeflowGitignoreBodyAuthority",
    schemaVersion: 1,
    hostIds: ["codex", "claude-code"],
    rules,
    body,
    bodyDigest: computeSha256Digest(encodeUtf8(body)),
    authorityDigest: computeCanonicalJsonSha256Digest({
      kind: "WakeflowGitignoreBodyAuthorityDigestBasis",
      schemaVersion: 1,
      hostIds: ["codex", "claude-code"],
      rules,
    }),
    envelopeTarget: {
      component: "workspace-ignore",
      owner: "workspace-ignore-integration",
      body,
    },
  });
  assertDeepFrozen(authority);
  deepEqual(
    createWakeflowGitignoreBodyAuthority([
      claudeCodeWorkspaceHostResourceProfile,
      codexWorkspaceHostResourceProfile,
    ]),
    authority,
  );
});

test("Gitignore authority escapes paths and classifies only exact outside rules", () => {
  const syntheticClaude = parseWakeflowWorkspaceHostResourceProfile({
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "claude-code",
    runtimeDirectoryName: "claude-code",
    instructionFileName: "CLAUDE.md",
    surfaces: {
      windowIdentity: false,
      podEvidence: false,
      keepLive: false,
      windowLocator: false,
      settingsIntegration: {
        portablePath: ".claude/settings.json",
        localPath: ".claude/local[dev]*?.json",
      },
      statuslineAsset: null,
      activityMonitor: false,
      temporaryPrompts: false,
    },
  });
  const escaped = createWakeflowGitignoreBodyAuthority([
    syntheticClaude,
    codexWorkspaceHostResourceProfile,
  ]);
  equal(
    escaped.rules.some((rule) => (
      rule === "/.claude/local\\[dev\\]\\*\\?.json"
    )),
    true,
  );

  const authority = createWakeflowGitignoreBodyAuthority([
    codexWorkspaceHostResourceProfile,
    claudeCodeWorkspaceHostResourceProfile,
  ]);
  const compatible = classifyWakeflowGitignoreExactOutsideRules(
    authority,
    {
      prefix: "node_modules/\r\n/.wakeflow-active/\r\n",
      suffix: "# user suffix\n/.wakeflow-local/\n",
    },
  );
  deepEqual(compatible, {
    kind: "compatible",
    exactDuplicateRules: [
      "/.wakeflow-active/",
      "/.wakeflow-local/",
    ],
    exactNegatedRules: [],
  });
  assertDeepFrozen(compatible);

  const conflict = classifyWakeflowGitignoreExactOutsideRules(
    authority,
    {
      prefix: "!/.wakeflow-local/\n",
      suffix: "!/.claude/settings.local.json\r\n",
    },
  );
  deepEqual(conflict, {
    kind: "conflict",
    exactDuplicateRules: [],
    exactNegatedRules: [
      "/.claude/settings.local.json",
      "/.wakeflow-local/",
    ],
  });

  expectAuthorityError(
    () => createWakeflowGitignoreBodyAuthority([
      codexWorkspaceHostResourceProfile,
    ]),
    "profile-set",
    "$profiles",
  );
  expectAuthorityError(
    () => createWakeflowGitignoreBodyAuthority([
      codexWorkspaceHostResourceProfile,
      codexWorkspaceHostResourceProfile,
    ]),
    "profile-set",
    "$profiles",
  );
  const collidingClaude = parseWakeflowWorkspaceHostResourceProfile({
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "claude-code",
    runtimeDirectoryName: "claude-code",
    instructionFileName: "CLAUDE.md",
    surfaces: {
      windowIdentity: false,
      podEvidence: false,
      keepLive: false,
      windowLocator: false,
      settingsIntegration: {
        portablePath: ".claude/settings.json",
        localPath: ".wakeflow-local",
      },
      statuslineAsset: null,
      activityMonitor: false,
      temporaryPrompts: false,
    },
  });
  expectAuthorityError(
    () => createWakeflowGitignoreBodyAuthority([
      codexWorkspaceHostResourceProfile,
      collidingClaude,
    ]),
    "path",
    "$/profiles/1/surfaces/settingsIntegration/localPath",
  );
  const forgedRules = ["/*.tmp", ...authority.rules.slice(1)];
  const forgedBody = `${forgedRules.join("\n")}\n`;
  const forged = {
    ...authority,
    rules: forgedRules,
    body: forgedBody,
    bodyDigest: computeSha256Digest(encodeUtf8(forgedBody)),
    authorityDigest: computeCanonicalJsonSha256Digest({
      kind: "WakeflowGitignoreBodyAuthorityDigestBasis",
      schemaVersion: 1,
      hostIds: authority.hostIds,
      rules: forgedRules,
    }),
    envelopeTarget: {
      ...authority.envelopeTarget,
      body: forgedBody,
    },
  };
  expectAuthorityError(
    () => parseWakeflowGitignoreBodyAuthority(forged),
    "authority",
    "$authority",
  );
  let trapCalls = 0;
  const proxy = new Proxy([
    codexWorkspaceHostResourceProfile,
    claudeCodeWorkspaceHostResourceProfile,
  ], {
    get: () => {
      trapCalls += 1;
      return undefined;
    },
  });
  expectAuthorityError(
    () => createWakeflowGitignoreBodyAuthority(proxy),
    "input",
    "$profiles",
  );
  equal(trapCalls, 0);
});
