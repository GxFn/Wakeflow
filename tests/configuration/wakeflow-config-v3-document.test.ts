import { equal } from "node:assert/strict";
import { test } from "node:test";

import { renderWakeflowConfigV3 } from "../../src/configuration/wakeflow-config-v3-document.js";
import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../src/configuration/wakeflow-config-v3.js";
import { parseDeterministicJsonDocument } from "../../src/foundation/data/deterministic-json-document.js";
import {
  createMinimalWakeflowConfigV3,
  serializeWakeflowConfigV3Fixture,
} from "./wakeflow-config-v3.fixture.js";

test("minimal config renders in its one explicit domain field order", () => {
  const value = createMinimalWakeflowConfigV3();
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  equal(
    renderWakeflowConfigV3(reordered),
    serializeWakeflowConfigV3Fixture(value),
  );
});

test("optional nested fields survive representation normalization", () => {
  const value = createMinimalWakeflowConfigV3();
  const program = value.program as Record<string, unknown>;
  program.description = "Program description";
  const topology = value.topology as {
    repositories: Record<string, unknown>[];
    supportSurfaces: Record<string, unknown>[];
    windows: Record<string, unknown>[];
  };
  topology.repositories[0]!.description = "Repository description";
  topology.repositories[0]!.validation = {
    residueExceptions: [{ path: "generated/cache", reason: "Owned cache" }],
  };
  topology.supportSurfaces[0]!.description = "Design description";
  topology.supportSurfaces[1]!.ownership = "external-owned";
  topology.supportSurfaces[1]!.instructionManagement = "managed-block";
  topology.windows[0]!.description = "Controller description";
  value.governance = {
    audit: { preservedReviewAfterDays: 30 },
    validation: {
      runtimeResidue: {
        label: "runtime",
        matchers: [
          { kind: "substring", value: "node server.mjs" },
          { kind: "regex", value: "node\\s+server\\.mjs" },
        ],
      },
    },
  };
  value.hosts = {
    codex: {
      launch: {
        modelByRole: { controller: "gpt-5", default: "gpt-5-mini" },
        reasoningEffortByRole: { controller: "high", default: "medium" },
      },
    },
    "claude-code": {
      launch: {
        modelByRole: { product: "claude-sonnet" },
        permissionMode: "acceptEdits",
      },
      tmux: { sessionName: "wakeflow", socketName: "wakeflow-socket" },
    },
  };

  const rendered = renderWakeflowConfigV3(value);
  const parsed = parseDeterministicJsonDocument(rendered);
  const model = parseWakeflowConfigV3(parsed);
  equal(renderWakeflowConfigV3(model), rendered);
  equal(
    computeWakeflowConfigV3Digest(model),
    computeWakeflowConfigV3Digest(parseWakeflowConfigV3(value)),
  );
  for (const expected of [
    "Program description",
    "generated/cache",
    "external-owned",
    "preservedReviewAfterDays",
    "gpt-5-mini",
    "acceptEdits",
    "wakeflow-socket",
  ]) {
    equal(rendered.includes(expected), true);
  }
});
