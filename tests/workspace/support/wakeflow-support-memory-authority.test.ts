import { deepEqual, equal, notEqual } from "node:assert/strict";
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
  createWakeflowSupportMemoryAuthority,
  parseWakeflowSupportMemoryAuthority,
  WakeflowSupportMemoryAuthorityError,
} from "../../../src/workspace/support/wakeflow-support-memory-authority.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

const DESIGN_ID = "surface_33333333-3333-4333-8333-333333333333";
const TEST_ID = "surface_44444444-4444-4444-8444-444444444444";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Design whole-file memory is a thin English identity and role contract", () => {
  const config = createMinimalWakeflowConfigV3();
  const surface = (config.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces[0];
  if (surface === undefined) throw new Error("Expected Design surface.");
  surface.description = "Clarifies product requirements.";
  const authority = createWakeflowSupportMemoryAuthority(
    config,
    codexWorkspaceHostResourceProfile,
    DESIGN_ID,
  );

  equal(authority.role, "design");
  equal(authority.hostId, "codex");
  equal(authority.instructionFileName, "AGENTS.md");
  equal(authority.language, "en");
  equal(authority.body.startsWith("# Wakeflow Design Support\n"), true);
  for (const expected of [
    "## Stable identity",
    "## Authority boundary",
    "## Design role",
    "## Safety boundary",
    "`wakeflow-design` Skill",
    "`\"Clarifies product requirements.\"`",
  ]) {
    equal(authority.body.includes(expected), true);
  }
  for (const obsoleteDetail of [
    "activeIndex",
    "active.current",
    "ledger",
    "13-column",
    "expectedBoardDigest",
    "wakeflow_next_work",
  ]) {
    equal(authority.body.includes(obsoleteDetail), false);
  }
  equal(authority.bodyDigest, computeSha256Digest(encodeUtf8(authority.body)));
  equal(
    authority.authorityDigest,
    computeCanonicalJsonSha256Digest({
      kind: "WakeflowSupportMemoryAuthorityDigestBasis",
      schemaVersion: 1,
      configDigest: authority.configDigest,
      programId: authority.programId,
      surfaceId: authority.surfaceId,
      windowId: authority.windowId,
      role: authority.role,
      hostId: authority.hostId,
      instructionFileName: authority.instructionFileName,
      declarationId: authority.declarationId,
      language: authority.language,
      bodyDigest: authority.bodyDigest,
    }),
  );
  deepEqual(parseWakeflowSupportMemoryAuthority(authority), authority);
  assertDeepFrozen(authority);
});

test("Test whole-file memory uses persisted Simplified Chinese and Test boundaries", () => {
  const config = createMinimalWakeflowConfigV3();
  (config.presentation as Record<string, unknown>).language = "zh-Hans";
  const chinese = createWakeflowSupportMemoryAuthority(
    config,
    claudeCodeWorkspaceHostResourceProfile,
    TEST_ID,
  );
  const english = createWakeflowSupportMemoryAuthority(
    createMinimalWakeflowConfigV3(),
    claudeCodeWorkspaceHostResourceProfile,
    TEST_ID,
  );

  equal(chinese.role, "test");
  equal(chinese.hostId, "claude-code");
  equal(chinese.instructionFileName, "CLAUDE.md");
  equal(chinese.body.startsWith("# Wakeflow Test 支持窗口\n"), true);
  equal(chinese.body.includes("产品源码始终只读"), true);
  equal(chinese.body.includes("Controller 已批准的 Test 分配"), true);
  equal(chinese.body.includes("Test 职责范围内的用户直接请求"), false);
  equal(chinese.body.includes("`wakeflow-test` Skill"), true);
  equal(chinese.body.includes("# Wakeflow Test Support"), false);
  notEqual(chinese.bodyDigest, english.bodyDigest);
  notEqual(chinese.authorityDigest, english.authorityDigest);
});

test("whole-file memory encodes user text and rejects external or forged authority", () => {
  const config = createMinimalWakeflowConfigV3();
  const surface = (config.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces[0];
  if (surface === undefined) throw new Error("Expected Design surface.");
  surface.displayName = "Design\n## forged <!-- marker --> `";
  const authority = createWakeflowSupportMemoryAuthority(
    config,
    codexWorkspaceHostResourceProfile,
    DESIGN_ID,
  );
  equal(authority.body.includes("\n## forged"), false);
  equal(authority.body.includes("<!-- marker"), false);
  equal(authority.body.includes("\\u003c!-- marker --\\u003e"), true);

  const external = createMinimalWakeflowConfigV3();
  const externalSurface = (external.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces[0];
  if (externalSurface === undefined) throw new Error("Expected surface.");
  externalSurface.ownership = "external-owned";
  externalSurface.instructionManagement = "managed-block";
  let externalError: unknown;
  try {
    createWakeflowSupportMemoryAuthority(
      external,
      codexWorkspaceHostResourceProfile,
      DESIGN_ID,
    );
  } catch (error: unknown) {
    externalError = error;
  }
  equal(externalError instanceof WakeflowSupportMemoryAuthorityError, true);
  if (externalError instanceof WakeflowSupportMemoryAuthorityError) {
    equal(externalError.reason, "surface");
    equal(externalError.path, "$surfaceId");
  }

  const forgedBody = authority.body.replace(
    "Do not implement product code",
    "Implement product code",
  );
  let forgedError: unknown;
  try {
    parseWakeflowSupportMemoryAuthority({
      ...authority,
      body: forgedBody,
      bodyDigest: computeSha256Digest(encodeUtf8(forgedBody)),
    });
  } catch (error: unknown) {
    forgedError = error;
  }
  equal(forgedError instanceof WakeflowSupportMemoryAuthorityError, true);
  if (forgedError instanceof WakeflowSupportMemoryAuthorityError) {
    equal(forgedError.reason, "authority");
  }

  let malformedError: unknown;
  try {
    parseWakeflowSupportMemoryAuthority({
      ...authority,
      body: authority.body.trimEnd(),
    });
  } catch (error: unknown) {
    malformedError = error;
  }
  equal(malformedError instanceof WakeflowSupportMemoryAuthorityError, true);
  if (malformedError instanceof WakeflowSupportMemoryAuthorityError) {
    equal(malformedError.reason, "authority");
    equal(malformedError.path, "$authority.body");
  }
});
