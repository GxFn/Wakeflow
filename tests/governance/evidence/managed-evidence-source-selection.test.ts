import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  assertManagedEvidenceKindMatchesSource,
  managedEvidenceSourceKey,
  ManagedEvidenceSourceSelectionError,
  parseManagedEvidenceLinkUrl,
  parseManagedEvidenceSourceDescriptor,
  parseManagedEvidenceSourceSelection,
  type ManagedEvidenceSourceSelectionErrorReason,
} from "../../../src/governance/evidence/managed-evidence-source-selection.js";

const REPOSITORY_ID = "repository_22222222-2222-4222-8222-222222222222";
const SURFACE_ID = "surface_33333333-3333-4333-8333-333333333333";
const RECORD_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const DIGEST = `sha256:${"a".repeat(64)}`;

function selection() {
  return {
    kind: "test-output",
    source: {
      kind: "managed-path",
      root: { kind: "repository", repositoryId: REPOSITORY_ID },
      path: "artifacts/test-run",
      resourceType: "tree",
    },
    contentReview: "controller-confirmed",
  };
}

function expectSelectionError(
  action: () => unknown,
  reason: ManagedEvidenceSourceSelectionErrorReason,
  path: string,
): void {
  throws(
    action,
    (error: unknown) =>
      error instanceof ManagedEvidenceSourceSelectionError &&
      error.code === "wakeflow-managed-evidence-source-selection" &&
      error.reason === reason &&
      error.path === path,
  );
}

test("证据选择只保留种类、逻辑来源与内容审阅策略，四种来源各有稳定键", () => {
  const parsed = parseManagedEvidenceSourceSelection(selection());
  deepEqual(parsed, selection());
  equal(Object.isFrozen(parsed), true);
  equal(Object.isFrozen(parsed.source), true);
  equal(
    managedEvidenceSourceKey(parsed.source),
    `managed-path:repository:${REPOSITORY_ID}:tree:artifacts/test-run`,
  );
  const observation = parseManagedEvidenceSourceSelection({
    kind: "hook-observation",
    source: { kind: "observation", hostId: "codex", recordId: RECORD_ID },
    contentReview: "reject",
  });
  equal(managedEvidenceSourceKey(observation.source), `observation:codex:${RECORD_ID}`);
  const link = parseManagedEvidenceSourceSelection({
    kind: "link",
    source: { kind: "link", url: "https://example.com/report" },
    contentReview: "reject",
  });
  deepEqual(link.source, { kind: "link", url: "https://example.com/report", digest: null });
  equal(managedEvidenceSourceKey(link.source), "link:https://example.com/report");
  const commit = parseManagedEvidenceSourceSelection({
    kind: "commit",
    source: { kind: "commit", repositoryId: REPOSITORY_ID, commitOid: "a".repeat(40) },
    contentReview: "reject",
  });
  equal(managedEvidenceSourceKey(commit.source), `commit:${REPOSITORY_ID}:${"a".repeat(40)}`);
  deepEqual(
    parseManagedEvidenceSourceDescriptor({
      kind: "managed-path",
      root: { kind: "support-surface", surfaceId: SURFACE_ID },
      path: "reports/result.txt",
      resourceType: "file",
    }),
    {
      kind: "managed-path",
      root: { kind: "support-surface", surfaceId: SURFACE_ID },
      path: "reports/result.txt",
      resourceType: "file",
    },
  );
});

test("Manifest 来源投影：observation 带脱敏字段，link 的摘要必须显式", () => {
  const projected = parseManagedEvidenceSourceDescriptor({
    kind: "observation",
    hostId: "claude-code",
    recordId: RECORD_ID,
    event: "stop",
    recordedAt: "2026-09-10T08:00:00.000Z",
    turnId: null,
    promptDigest: null,
    lastAssistantMessageDigest: DIGEST,
    transcript: "present",
    recordDigest: DIGEST,
  });
  equal(projected.kind, "observation");
  if (projected.kind === "observation") equal(projected.transcript, "present");
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceDescriptor({
        kind: "observation",
        hostId: "codex",
        recordId: RECORD_ID,
      }),
    "record",
    "$/source",
  );
  expectSelectionError(
    () => parseManagedEvidenceSourceDescriptor({ kind: "link", url: "https://example.com/x" }),
    "source",
    "$/source",
  );
  deepEqual(
    parseManagedEvidenceSourceDescriptor({ kind: "link", url: "https://example.com/x", digest: DIGEST }),
    { kind: "link", url: "https://example.com/x", digest: DIGEST },
  );
});

test("种类与来源绑定：transcript 只接引用带 transcript 的记录，其余种类各归其来源", () => {
  expectSelectionError(
    () => parseManagedEvidenceSourceSelection({ ...selection(), kind: "link" }),
    "kind",
    "$/kind",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        kind: "test-output",
        source: { kind: "observation", hostId: "codex", recordId: RECORD_ID },
        contentReview: "reject",
      }),
    "kind",
    "$/kind",
  );
  expectSelectionError(
    () =>
      assertManagedEvidenceKindMatchesSource("transcript", {
        kind: "observation",
        hostId: "codex",
        recordId: RECORD_ID,
        event: "stop",
        recordedAt: "2026-09-10T08:00:00.000Z" as never,
        turnId: null,
        promptDigest: null,
        lastAssistantMessageDigest: null,
        transcript: "absent",
        recordDigest: DIGEST as never,
      }),
    "kind",
    "$/kind",
  );
  expectSelectionError(
    () => parseManagedEvidenceSourceSelection({ ...selection(), kind: "screenshot" }),
    "kind",
    "$/kind",
  );
});

test("来源拒绝物理路径、保留段、坏标识、带凭证的 URL 与非法提交对象", () => {
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        source: { ...selection().source, path: "/private/result" },
      }),
    "path",
    "$/source/path",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        source: { ...selection().source, path: ".git/objects" },
      }),
    "path",
    "$/source/path",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        source: { ...selection().source, expectedDigest: DIGEST },
      }),
    "source",
    "$/source",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        source: {
          ...selection().source,
          root: { kind: "repository", repositoryId: `surface_${SURFACE_ID.split("_")[1]}` },
        },
      }),
    "identifier",
    "$/source/root/repositoryId",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        source: { kind: "https", url: "https://example.com/result" },
      }),
    "source",
    "$/source/kind",
  );
  for (const url of [
    "http://example.com/x",
    "https://user:secret@example.com/x",
    "https://example.com/a b",
    "ftp://example.com/x",
    "https://",
  ]) {
    expectSelectionError(() => parseManagedEvidenceLinkUrl(url), "url", "$/source/url");
  }
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        kind: "commit",
        source: { kind: "commit", repositoryId: REPOSITORY_ID, commitOid: "not-an-oid" },
        contentReview: "reject",
      }),
    "commit",
    "$/source/commitOid",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        kind: "hook-observation",
        source: { kind: "observation", hostId: "tmux", recordId: RECORD_ID },
        contentReview: "reject",
      }),
    "source",
    "$/source/hostId",
  );
  expectSelectionError(
    () => parseManagedEvidenceSourceSelection({ ...selection(), contentReview: "allow" }),
    "content-review",
    "$/contentReview",
  );
});

test("证据选择不执行 accessor 或 Proxy trap", () => {
  const accessor = Object.defineProperty({}, "source", {
    enumerable: true,
    get() {
      throw new Error("must not execute");
    },
  });
  expectSelectionError(() => parseManagedEvidenceSourceSelection(accessor), "input", "$selection");
  let trapCalls = 0;
  const proxy = new Proxy(selection(), {
    ownKeys() {
      trapCalls += 1;
      return [];
    },
  });
  expectSelectionError(() => parseManagedEvidenceSourceSelection(proxy), "input", "$selection");
  equal(trapCalls, 0);
});
