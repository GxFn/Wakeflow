import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
  WakeflowConfigError,
} from "../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../src/configuration/wakeflow-config-document.js";
import { parseDeterministicJsonDocument } from "../../src/foundation/data/deterministic-json-document.js";
import {
  createMinimalWakeflowConfig,
  serializeWakeflowConfigFixture,
} from "./wakeflow-config.fixture.js";

test("minimal config renders in its one explicit domain field order", () => {
  const value = createMinimalWakeflowConfig();
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  equal(
    renderWakeflowConfig(reordered),
    serializeWakeflowConfigFixture(value),
  );
});

test("optional nested fields survive representation normalization", () => {
  const value = createMinimalWakeflowConfig();
  const program = value.program as Record<string, unknown>;
  program.description = "Program description";
  const topology = value.topology as {
    repositories: Record<string, unknown>[];
    supportSurfaces: Record<string, unknown>[];
    windows: Record<string, unknown>[];
  };
  topology.repositories[0]!.description = "Repository description";
  topology.supportSurfaces[0]!.description = "Design description";
  topology.supportSurfaces[1]!.ownership = "external-owned";
  topology.supportSurfaces[1]!.instructionManagement = "managed-block";
  topology.windows[0]!.description = "Controller description";
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

  const rendered = renderWakeflowConfig(value);
  const parsed = parseDeterministicJsonDocument(rendered);
  const model = parseWakeflowConfig(parsed);
  equal(renderWakeflowConfig(model), rendered);
  equal(
    computeWakeflowConfigDigest(model),
    computeWakeflowConfigDigest(parseWakeflowConfig(value)),
  );
  for (const expected of [
    "Program description",
    "Repository description",
    "external-owned",
    '"governance": {}',
    "gpt-5-mini",
    "acceptEdits",
    "wakeflow-socket",
  ]) {
    equal(rendered.includes(expected), true);
  }
});

// 用户裁决 Q4（gate-log §13.134）：auto 成为 Claude 窗口的缺省权限模式；配置只接受
// auto、acceptEdits、bypassPermissions，CLI 的其余模式（manual、dontAsk、plan）不是持久偏好。
test("Claude permissionMode admits auto, acceptEdits and bypassPermissions only", () => {
  for (const mode of ["auto", "acceptEdits", "bypassPermissions"]) {
    const value = createMinimalWakeflowConfig();
    value.hosts = { "claude-code": { launch: { permissionMode: mode } } };
    const model = parseWakeflowConfig(value);
    equal(model.hosts?.["claude-code"]?.launch?.permissionMode, mode);
    const rendered = renderWakeflowConfig(model);
    equal(rendered.includes(`"permissionMode": "${mode}"`), true);
    equal(
      renderWakeflowConfig(parseWakeflowConfig(parseDeterministicJsonDocument(rendered))),
      rendered,
    );
  }
  for (const mode of ["manual", "dontAsk", "plan", "default", "Auto"]) {
    const value = createMinimalWakeflowConfig();
    value.hosts = { "claude-code": { launch: { permissionMode: mode } } };
    throws(
      () => parseWakeflowConfig(value),
      (error: unknown) => error instanceof WakeflowConfigError && error.reason === "schema",
    );
  }
});
