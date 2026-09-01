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
  expectedPath: string,
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
  equal(caught.name, "RuntimeJsonSchemaError");
  equal(caught.code, "wakeflow-runtime-json-schema");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
}

test("one compiled validator owns local refs, annotations, and regex format", () => {
  const dependency = Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:regex-pattern",
    type: "string",
    format: "regex",
  });
  const root = Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:record",
    "x-wakeflow-runtime-export": "WAKEFLOW_TEST_RECORD_SCHEMA",
    type: "object",
    additionalProperties: false,
    required: ["pattern"],
    properties: { pattern: { $ref: dependency.$id } },
  });
  const validate = createRuntimeJsonSchemaValidator<{
    readonly pattern: string;
  }>(root, [dependency]);

  const accepted = validate(parseJsonValue({ pattern: "^[a-z]+$" }));
  equal(accepted.ok, true);
  if (accepted.ok) equal(accepted.value.pattern, "^[a-z]+$");

  const rejected = validate(parseJsonValue({ pattern: "[" }));
  equal(rejected.ok, false);
  if (!rejected.ok) equal(rejected.path, "$/pattern");
});

test("validation is non-mutating and exposes only a frozen stable result", () => {
  const validate = createRuntimeJsonSchemaValidator<{ readonly value: number }>(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wakeflow:test:number",
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: {
        value: { type: "integer", minimum: 1 },
        defaulted: { type: "string", default: "inserted" },
      },
    },
  );
  const result = validate(parseJsonValue({ value: 0 }));
  equal(result.ok, false);
  equal(Object.keys(result).sort().join(","), "ok,path");
  equal(JSON.stringify(result).includes("minimum"), false);
  equal(Object.isFrozen(result), true);

  const admitted = parseJsonValue({ value: "1", unexpected: true });
  const before = JSON.stringify(admitted);
  const rejected = validate(admitted);
  equal(rejected.ok, false);
  equal(JSON.stringify(admitted), before);
});

test("对象uniqueItems可校验null原型JsonValue且不替换原始快照", () => {
  const validate = createRuntimeJsonSchemaValidator<
    readonly Readonly<{
      readonly value: number;
    }>[]
  >({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:unique-object-array",
    type: "array",
    uniqueItems: true,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: {
        value: { type: "integer" },
        valueOf: { type: "string" },
      },
    },
  });
  const original = parseJsonValue([
    { value: 1, valueOf: "left" },
    { value: 2, valueOf: "right" },
  ]);
  const accepted = validate(original);
  equal(accepted.ok, true);
  if (accepted.ok) equal(accepted.value, original);

  const rejected = validate(
    parseJsonValue([
      { value: 1, valueOf: "same" },
      { value: 1, valueOf: "same" },
    ]),
  );
  equal(rejected.ok, false);
  if (!rejected.ok) equal(rejected.path, "$");
});

test("Schema and dependency admission execute no accessors", () => {
  let getterCalls = 0;
  const hostileRoot = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:hostile-root",
    type: "string",
  };
  Object.defineProperty(hostileRoot, "pattern", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return ".*";
    },
  });
  expectSchemaError(
    () => createRuntimeJsonSchemaValidator(hostileRoot),
    "schema-input",
    "$schema/pattern",
  );

  const hostileDependency = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:hostile-dependency",
    type: "string",
  };
  Object.defineProperty(hostileDependency, "pattern", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return ".*";
    },
  });
  expectSchemaError(
    () =>
      createRuntimeJsonSchemaValidator(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: "urn:wakeflow:test:dependency-root",
          $ref: hostileDependency.$id,
        },
        [hostileDependency],
      ),
    "schema-dependency",
    "$dependencies/0/pattern",
  );
  equal(getterCalls, 0);
});

test("unresolved, duplicate, and malformed Schema catalogs fail closed", () => {
  expectSchemaError(
    () =>
      createRuntimeJsonSchemaValidator({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:wakeflow:test:missing-ref",
        $ref: "urn:wakeflow:test:missing",
      }),
    "schema-compile",
    "$schema",
  );
  const dependency = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:duplicate",
    type: "string",
  };
  expectSchemaError(
    () =>
      createRuntimeJsonSchemaValidator(
        { ...dependency, $id: "urn:wakeflow:test:root" },
        [dependency, dependency],
      ),
    "schema-dependency",
    "$dependencies/1/$id",
  );
  expectSchemaError(
    () => createRuntimeJsonSchemaValidator(null),
    "schema-input",
    "$schema",
  );
});
