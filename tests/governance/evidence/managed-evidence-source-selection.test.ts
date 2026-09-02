import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  ManagedEvidenceSourceSelectionError,
  parseManagedEvidenceSourceDescriptor,
  parseManagedEvidenceSourceSelection,
  type ManagedEvidenceSourceSelectionErrorReason,
} from "../../../src/governance/evidence/managed-evidence-source-selection.js";

const REPOSITORY_ID = "repository_22222222-2222-4222-8222-222222222222";
const SURFACE_ID = "surface_33333333-3333-4333-8333-333333333333";

function selection() {
  return {
    evidenceType: "test-output",
    source: {
      root: { kind: "repository", repositoryId: REPOSITORY_ID },
      path: "artifacts/test-run",
      resourceType: "tree",
    },
    sensitivity: "internal",
    opaqueContentPolicy: "controller-confirmed",
  };
}

function expectSelectionError(
  action: () => unknown,
  reason: ManagedEvidenceSourceSelectionErrorReason,
  path: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof ManagedEvidenceSourceSelectionError, true);
  if (caught instanceof ManagedEvidenceSourceSelectionError) {
    equal(caught.code, "wakeflow-managed-evidence-source-selection");
    equal(caught.reason, reason);
    equal(caught.path, path);
  }
}

test("Managed Evidence source selection只保留逻辑根、portable path与内容策略", () => {
  const parsed = parseManagedEvidenceSourceSelection(selection());
  deepEqual(parsed, selection());
  equal(Object.isFrozen(parsed), true);
  equal(Object.isFrozen(parsed.source), true);
  equal(Object.isFrozen(parsed.source.root), true);

  deepEqual(
    parseManagedEvidenceSourceDescriptor({
      root: { kind: "support-surface", surfaceId: SURFACE_ID },
      path: "reports/result.txt",
      resourceType: "file",
    }),
    {
      root: { kind: "support-surface", surfaceId: SURFACE_ID },
      path: "reports/result.txt",
      resourceType: "file",
    },
  );
});

test("source selection拒绝物理路径、locator和调用方来源摘要", () => {
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
        source: {
          root: { kind: "https", url: "https://example.com/result" },
          path: "result",
          resourceType: "file",
        },
      }),
    "source",
    "$/source/root/kind",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        source: {
          ...selection().source,
          expectedDigest: `sha256:${"a".repeat(64)}`,
        },
      }),
    "source",
    "$/source",
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
});

test("source selection稳定区分typed root、标签和opaque策略", () => {
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        source: {
          ...selection().source,
          root: {
            kind: "repository",
            repositoryId: `surface_${SURFACE_ID.split("_")[1]}`,
          },
        },
      }),
    "identifier",
    "$/source/root/repositoryId",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        evidenceType: "not valid",
      }),
    "evidence-type",
    "$/evidenceType",
  );
  expectSelectionError(
    () =>
      parseManagedEvidenceSourceSelection({
        ...selection(),
        opaqueContentPolicy: "allow",
      }),
    "opaque-policy",
    "$/opaqueContentPolicy",
  );
});

test("source selection不执行accessor或Proxy trap", () => {
  const accessor = Object.defineProperty({}, "source", {
    enumerable: true,
    get() {
      throw new Error("must not execute");
    },
  });
  expectSelectionError(
    () => parseManagedEvidenceSourceSelection(accessor),
    "input",
    "$selection",
  );

  let trapCalls = 0;
  const proxy = new Proxy(selection(), {
    ownKeys() {
      trapCalls += 1;
      return [];
    },
  });
  expectSelectionError(
    () => parseManagedEvidenceSourceSelection(proxy),
    "input",
    "$selection",
  );
  equal(trapCalls, 0);
});
