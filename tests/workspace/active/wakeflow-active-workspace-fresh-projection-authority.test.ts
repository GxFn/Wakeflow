import { deepEqual, equal, match } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG,
  WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG,
} from "../../../src/workspace/active/wakeflow-active-resource-catalog.js";
import {
  createWakeflowActiveWorkspaceFreshProjectionAuthority,
} from "../../../src/workspace/active/wakeflow-active-workspace-fresh-projection-authority.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

function config(language: "en" | "zh-Hans" = "en") {
  const value = createMinimalWakeflowConfigV3();
  (value.presentation as Record<string, unknown>).language = language;
  return value;
}

test("Fresh Active workspace projection uses current TS paths and no legacy Ledger link", () => {
  const authority = createWakeflowActiveWorkspaceFreshProjectionAuthority(
    config(),
  );
  deepEqual(authority.files.map((entry) => entry.resourcePath), [
    ".wakeflow-active/index.md",
    ".wakeflow-active/current/workspace-current-status.md",
  ]);
  const [index, status] = authority.files;
  equal(index?.content.includes(
    "current/todo/global-todo-board.md",
  ), true);
  equal(index?.content.includes("current/global-todo-board.md"), false);
  equal(index?.content.includes("workspace-record-map.md"), false);
  equal(status?.content.includes("`\"idle\"`"), true);
  equal(status?.content.includes("../index.md"), true);
  match(
    authority.sourceDigest,
    /^sha256:[0-9a-f]{64}$/u,
  );
  match(
    authority.authorityDigest,
    /^sha256:[0-9a-f]{64}$/u,
  );
  equal(
    authority.files.every((entry) => entry.content.endsWith("\n")),
    true,
  );
});

test("Fresh Active projection localizes fixed prose and contains display text as data", () => {
  const value = config("zh-Hans");
  (value.program as Record<string, unknown>).displayName =
    "Project\n## forged <!-- marker --> `code`";
  const authority = createWakeflowActiveWorkspaceFreshProjectionAuthority(
    value,
  );
  const index = authority.files[0]?.content ?? "";
  equal(index.startsWith("# Wakeflow 活动工作区\n"), true);
  equal(index.includes("## forged <!-- marker -->"), false);
  equal(index.includes("\\u003c!-- marker --\\u003e"), true);
  equal(index.includes("\\u0060code\\u0060"), true);
  equal(authority.language, "zh-Hans");
});

test("Active resource catalog separates layout ownership from projection ownership", () => {
  deepEqual(
    WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG.map((entry) => entry.declarationId),
    ["active.root", "active.current-root"],
  );
  deepEqual(
    WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG.map((entry) => ({
      declarationId: entry.declarationId,
      ownerId: entry.ownerId,
      path: entry.placement.relativePath,
      role: entry.processing.kind === "resource"
        ? entry.processing.role
        : "directory-container",
    })),
    [
      {
        declarationId: "active.root",
        ownerId: "active-layout",
        path: ".wakeflow-active",
        role: "directory-container",
      },
      {
        declarationId: "active.current-root",
        ownerId: "active-layout",
        path: ".wakeflow-active/current",
        role: "directory-container",
      },
      {
        declarationId: "active.workspace-index",
        ownerId: "active-workspace-projection",
        path: ".wakeflow-active/index.md",
        role: "derived-projection",
      },
      {
        declarationId: "active.workspace-status",
        ownerId: "active-workspace-projection",
        path: ".wakeflow-active/current/workspace-current-status.md",
        role: "derived-projection",
      },
      {
        declarationId: "active.workspace-projection-lock",
        ownerId: "active-workspace-projection",
        path: ".wakeflow-active/projector.lock",
        role: "transaction-artifact",
      },
    ],
  );
});
