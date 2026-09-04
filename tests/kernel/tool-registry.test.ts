import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { isWakeflowError } from "../../src/kernel/error.js";
import {
  createWakeflowToolCatalog,
  findWakeflowToolRegistration,
  measureWakeflowToolCatalogBytes,
  publicToolDefinition,
  WAKEFLOW_TOOL_DESCRIPTION_MAXIMUM_BYTES,
  type WakeflowToolRegistration,
} from "../../src/kernel/tool-registry.js";

function schema(stem: string, kind: "request" | "result") {
  return Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:wakeflow:entrypoints:${stem}-${kind}:v1`,
    type: "object",
    additionalProperties: false,
    properties: { root: { type: "string" } },
  });
}

function registration(
  overrides: Partial<WakeflowToolRegistration> = {},
): WakeflowToolRegistration {
  return {
    name: "wakeflow_example_tool",
    slice: "example",
    shape: "append",
    executor: "exampleExecutor",
    title: "Example",
    description: "Append one example record.",
    requestSchema: schema("example", "request"),
    resultSchema: schema("example", "result"),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    ...overrides,
  };
}

function rejects(value: readonly WakeflowToolRegistration[], reason: string): void {
  throws(
    () => createWakeflowToolCatalog(value),
    (error: unknown) =>
      isWakeflowError(error) && error.code === "unexpected" && error.reason === reason,
  );
}

test("tool catalog 准入唯一名字、绑定名与 Schema 身份，并按形状约束注解", () => {
  const catalog = createWakeflowToolCatalog([
    registration(),
    registration({
      name: "wakeflow_example_read",
      executor: "exampleRead",
      shape: "read",
      requestSchema: schema("example-read", "request"),
      resultSchema: schema("example-read", "result"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }),
  ]);
  equal(catalog.tools.length, 2);
  equal(Object.isFrozen(catalog.tools), true);
  equal(findWakeflowToolRegistration(catalog, "wakeflow_example_read")?.shape, "read");
  equal(findWakeflowToolRegistration(catalog, "wakeflow_missing"), null);

  const definition = publicToolDefinition(catalog.tools[0]!);
  deepEqual(Object.keys(definition).sort(), [
    "annotations",
    "description",
    "inputSchema",
    "name",
    "title",
  ]);
  equal(measureWakeflowToolCatalogBytes(catalog) > 0, true);

  rejects([registration(), registration({ executor: "other" })], "tool-catalog-duplicate-name");
  rejects(
    [registration(), registration({ name: "wakeflow_other" })],
    "tool-catalog-duplicate-executor",
  );
  rejects([registration({ name: "not_wakeflow" })], "tool-catalog-registration");
  rejects(
    [registration({ description: "x".repeat(WAKEFLOW_TOOL_DESCRIPTION_MAXIMUM_BYTES + 1) })],
    "tool-catalog-registration",
  );
  rejects(
    [registration({ resultSchema: schema("other", "result") })],
    "tool-catalog-schema-stem",
  );
  rejects(
    [registration({ requestSchema: schema("example", "result") })],
    "tool-catalog-request-schema",
  );
  rejects(
    [
      registration({
        shape: "read",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      }),
    ],
    "tool-catalog-shape",
  );
  rejects(
    [
      registration({
        shape: "append",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      }),
    ],
    "tool-catalog-shape",
  );
});
