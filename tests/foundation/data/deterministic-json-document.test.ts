import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { parseJsonValue } from "../../../src/foundation/data/json-value.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
  type DeterministicJsonDocumentErrorReason,
} from "../../../src/foundation/data/deterministic-json-document.js";

function expectDocumentError(
  action: () => unknown,
  reason: DeterministicJsonDocumentErrorReason,
  path = "$document",
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DeterministicJsonDocumentError)) {
    throw new Error("Expected DeterministicJsonDocumentError.");
  }
  equal(caught.code, "wakeflow-deterministic-json-document");
  equal(caught.reason, reason);
  equal(caught.path, path);
}

test("domain insertion order renders as 2-space JSON with exactly one LF", () => {
  const value = {
    artifactKind: "wakeflow-example",
    schemaVersion: 1,
    nested: { second: 2, first: 1 },
    values: [true, null, "文本"],
  };
  const text = renderDeterministicJsonDocument(value);
  equal(text, [
    "{",
    '  "artifactKind": "wakeflow-example",',
    '  "schemaVersion": 1,',
    '  "nested": {',
    '    "second": 2,',
    '    "first": 1',
    "  },",
    '  "values": [',
    "    true,",
    "    null,",
    '    "文本"',
    "  ]",
    "}",
    "",
  ].join("\n"));

  const parsed = parseDeterministicJsonDocument(text);
  deepEqual(parsed, parseJsonValue(value));
  equal(Object.isFrozen(parsed), true);
  equal(Object.isFrozen((parsed as { nested: object }).nested), true);
});

test("all JSON top-level kinds use the same deterministic document profile", () => {
  for (const value of [null, true, false, 42, "value", [], {}] as const) {
    const text = renderDeterministicJsonDocument(value);
    deepEqual(
      parseDeterministicJsonDocument(text),
      parseJsonValue(value),
    );
    equal(text.endsWith("\n"), true);
    equal(text.endsWith("\n\n"), false);
  }
});

test("whitespace, indentation, key spelling order text, and final-LF drift are not repaired", () => {
  for (const text of [
    '{"a":1}\n',
    '{\n    "a": 1\n}\n',
    '{\n  "a": 1\n}',
    '{\r\n  "a": 1\r\n}\r\n',
    '{\n  "a": 1\n}\n\n',
  ]) {
    expectDocumentError(
      () => parseDeterministicJsonDocument(text),
      "non-deterministic",
    );
  }
});

test("duplicate object keys are rejected by representation round-trip", () => {
  expectDocumentError(
    () => parseDeterministicJsonDocument('{\n  "a": 1,\n  "a": 2\n}\n'),
    "non-deterministic",
  );
});

test("syntax and input type failures remain distinct and sanitized", () => {
  expectDocumentError(
    () => parseDeterministicJsonDocument("{not-json}\n"),
    "json-syntax",
  );
  expectDocumentError(
    () => parseDeterministicJsonDocument(null),
    "input",
  );
});

test("rendering rejects behavior-bearing values without executing them", () => {
  let getterCalls = 0;
  const input = {};
  Object.defineProperty(input, "secret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "private";
    },
  });
  expectDocumentError(
    () => renderDeterministicJsonDocument(input, "$.record"),
    "accessor-property",
    "$.record/secret",
  );
  equal(getterCalls, 0);
});
