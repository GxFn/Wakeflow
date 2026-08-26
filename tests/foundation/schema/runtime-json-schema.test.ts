import { equal } from "node:assert/strict";
import { test } from "node:test";

import { parseJsonValue } from "../../../src/foundation/data/json-value.js";
import {
  createRuntimeJsonSchemaValidator,
  RuntimeJsonSchemaError,
  type RuntimeJsonSchemaErrorReason,
} from "../../../src/foundation/schema/runtime-json-schema.js";

function expectSchemaError(
  action: () => unknown,
  reason: RuntimeJsonSchemaErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof RuntimeJsonSchemaError)) {
    throw new Error("Expected RuntimeJsonSchemaError.");
  }
  equal(caught.code, "wakeflow-runtime-json-schema");
  equal(caught.reason, reason);
}

test("one compiled validator resolves a closed local external reference", () => {
  const dependency = Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:name",
    type: "string",
    pattern: "^[a-z]+$",
  });
  const root = Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:record",
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: { name: { $ref: dependency.$id } },
  });
  const validate = createRuntimeJsonSchemaValidator<{
    readonly name: string;
  }>(root, [dependency]);

  const accepted = validate(parseJsonValue({ name: "wakeflow" }));
  equal(accepted.ok, true);
  if (accepted.ok) equal(accepted.value.name, "wakeflow");

  const rejected = validate(parseJsonValue({ name: "Wakeflow" }));
  equal(rejected.ok, false);
  if (!rejected.ok) equal(rejected.path, "$/name");
});

test("validation result does not expose Ajv keyword, schema, data, or message", () => {
  const validate = createRuntimeJsonSchemaValidator<{ readonly value: number }>({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:number",
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: { value: { type: "integer", minimum: 1 } },
  });
  const result = validate(parseJsonValue({ value: 0 }));
  equal(result.ok, false);
  equal(Object.keys(result).sort().join(","), "ok,path");
  equal(JSON.stringify(result).includes("minimum"), false);
  equal(Object.isFrozen(result), true);
});

test("Schema and dependency admission execute no accessors", () => {
  let getterCalls = 0;
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:hostile",
    type: "string",
  };
  Object.defineProperty(schema, "pattern", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return ".*";
    },
  });
  expectSchemaError(
    () => createRuntimeJsonSchemaValidator(schema),
    "schema-input",
  );
  equal(getterCalls, 0);
});

test("unresolved, duplicate, and malformed Schema catalogs fail closed", () => {
  expectSchemaError(
    () => createRuntimeJsonSchemaValidator({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wakeflow:test:missing-ref",
      $ref: "urn:wakeflow:test:missing",
    }),
    "schema-compile",
  );
  const dependency = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:duplicate",
    type: "string",
  };
  expectSchemaError(
    () => createRuntimeJsonSchemaValidator(
      { ...dependency, $id: "urn:wakeflow:test:root" },
      [dependency, dependency],
    ),
    "schema-dependency",
  );
  expectSchemaError(
    () => createRuntimeJsonSchemaValidator(null),
    "schema-input",
  );
});
