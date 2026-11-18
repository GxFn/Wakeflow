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
  const validate = createRuntimeJsonSchemaValidator<{ readonly value: number }>({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:number",
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: {
      value: { type: "integer", minimum: 1 },
      defaulted: { type: "string", default: "inserted" },
    },
  });
  const result = validate(parseJsonValue({ value: 0 }));
  equal(result.ok, false);
  equal(Object.keys(result).sort().join(","), "detail,ok,path");
  // detail 只说失败的关键字，不带 Schema 里的值（上限 1、默认值 "inserted"）。
  if (!result.ok) equal(result.detail, "minimum");
  equal(JSON.stringify(result).includes("inserted"), false);
  equal(JSON.stringify(result).includes("limit"), false);
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
  // 编译推迟到第一次校验；未解析的引用在那一刻以 schema-compile 报出。
  const unresolved = createRuntimeJsonSchemaValidator({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:missing-ref",
    $ref: "urn:wakeflow:test:missing",
  });
  expectSchemaError(() => unresolved({}), "schema-compile", "$schema");
  const dependency = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:duplicate",
    type: "string",
  };
  expectSchemaError(
    () =>
      createRuntimeJsonSchemaValidator({ ...dependency, $id: "urn:wakeflow:test:root" }, [
        dependency,
        dependency,
      ]),
    "schema-dependency",
    "$dependencies/1/$id",
  );
  expectSchemaError(() => createRuntimeJsonSchemaValidator(null), "schema-input", "$schema");
});

test("a rejection carries a token-shaped detail: the failing keyword plus the property or type it names（§13.181 F-L1-1）", () => {
  const validate = createRuntimeJsonSchemaValidator<unknown>({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:detail:v1",
    type: "object",
    additionalProperties: false,
    required: ["storage"],
    properties: { storage: { type: "string" }, mode: { enum: ["a", "b"] } },
  });
  const cases: ReadonlyArray<readonly [unknown, string, string]> = [
    [{}, "$", "required:storage"],
    [{ storage: "x", extra: 1 }, "$", "additional:extra"],
    [{ storage: 1 }, "$/storage", "type:string"],
    // 枚举带上允许的取值（ADR-0029：拒绝要可操作）。
    [{ storage: "x", mode: "c" }, "$/mode", "enum:a.b"],
  ];
  for (const [value, expectedPath, expectedDetail] of cases) {
    const rejected = validate(parseJsonValue(value));
    equal(rejected.ok, false);
    if (!rejected.ok) {
      equal(rejected.path, expectedPath);
      equal(rejected.detail, expectedDetail);
      equal(/^[A-Za-z0-9_.:-]{1,128}$/u.test(rejected.detail), true);
    }
  }
});

test("判别联合的拒绝说的是实例选中的那一支（ADR-0029）：按取值固定的成员认出那一支，报它的规则；哪一支都不认时说出区分成员该取什么", () => {
  const validate = createRuntimeJsonSchemaValidator<unknown>({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:union:v1",
    oneOf: [{ $ref: "#/$defs/effect" }, { $ref: "#/$defs/recover" }],
    $defs: {
      effect: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "source"],
        properties: {
          mode: { enum: ["preview", "apply"] },
          source: { oneOf: [{ $ref: "#/$defs/path" }, { $ref: "#/$defs/commit" }] },
          items: { type: "array", items: { $ref: "#/$defs/commit" } },
        },
      },
      recover: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "operationId"],
        properties: { mode: { const: "recover" }, operationId: { type: "string" } },
      },
      path: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "root", "path"],
        properties: { kind: { const: "path" }, root: { type: "string" }, path: { type: "string" } },
      },
      commit: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "commitOid"],
        properties: { kind: { const: "commit" }, commitOid: { type: "string" } },
      },
    },
  });
  const cases: ReadonlyArray<readonly [unknown, string, string]> = [
    // 第一支（path）排在前面，Ajv 的第一条错误是它的"缺 root"；实例选的是 commit 那一支。
    [{ mode: "apply", source: { kind: "commit" } }, "$/source", "required:commitOid"],
    [
      { mode: "apply", source: { kind: "commit", commitOid: 1 } },
      "$/source/commitOid",
      "type:string",
    ],
    // 外层联合：实例是 recover 那一支，多带了一个成员。
    [{ mode: "recover", operationId: "x", source: {} }, "$", "additional:source"],
    [{ mode: "recover" }, "$", "required:operationId"],
    // 哪一支都不认：说出区分成员该取什么。
    [{ mode: "apply", source: { kind: "git" } }, "$/source/kind", "enum:path.commit"],
    [{ mode: "apply", source: {} }, "$/source/kind", "required:kind"],
    [{ mode: "delete" }, "$/mode", "enum:preview.apply.recover"],
    // 联合之外的规则照旧。
    [
      { mode: "apply", source: { kind: "commit", commitOid: "a" }, items: [{ kind: "commit" }] },
      "$/items/0",
      "required:commitOid",
    ],
    // 实例根本不是对象：没有可认的那一支，照旧报 Ajv 的第一条。
    [[], "$", "type:object"],
  ];
  for (const [value, expectedPath, expectedDetail] of cases) {
    const rejected = validate(parseJsonValue(value));
    equal(rejected.ok, false, JSON.stringify(value));
    if (!rejected.ok) {
      equal(rejected.path, expectedPath, JSON.stringify(value));
      equal(rejected.detail, expectedDetail, JSON.stringify(value));
      equal(/^[A-Za-z0-9_.:-]{1,128}$/u.test(rejected.detail), true);
    }
  }
  equal(
    validate(parseJsonValue({ mode: "apply", source: { kind: "commit", commitOid: "a" } })).ok,
    true,
  );
});
