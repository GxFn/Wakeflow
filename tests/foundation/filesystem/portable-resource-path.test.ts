import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  joinPortableResourcePath,
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
  type PortableResourcePathErrorReason,
} from "../../../src/foundation/filesystem/portable-resource-path.js";

function expectPortableResourcePathError(
  action: () => unknown,
  reason: PortableResourcePathErrorReason,
  expectedPath: string,
): PortableResourcePathError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof PortableResourcePathError)) {
    throw new Error("Expected PortableResourcePathError.");
  }
  equal(caught.name, "PortableResourcePathError");
  equal(caught.code, "wakeflow-portable-resource-path");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("canonical root-relative resource paths receive their brand", () => {
  const values = [
    "demand.json",
    ".wakeflow-active/current/demand.json",
    "requirement-designs/需求说明.md",
    "docs/My Plan.md",
    "evidence/item#anchor%20literal",
  ] as const;

  for (const value of values) {
    const parsed: PortableResourcePath = parsePortableResourcePath(value);
    equal(parsed, value);
  }
});

test("splitting preserves exact text and returns a frozen non-empty sequence", () => {
  const value = parsePortableResourcePath(
    ".wakeflow-local/runtime/需求 evidence.json",
  );
  const segments = splitPortableResourcePath(value);

  deepEqual(segments, [
    ".wakeflow-local",
    "runtime",
    "需求 evidence.json",
  ]);
  equal(Object.isFrozen(segments), true);
});

test("joining revalidates both branded inputs and the combined path", () => {
  const parent = parsePortableResourcePath("records/evidence");
  const child = parsePortableResourcePath("payload/结果.txt");
  equal(
    joinPortableResourcePath(parent, child),
    "records/evidence/payload/结果.txt",
  );
  expectPortableResourcePathError(
    () => joinPortableResourcePath(
      asPortableResourcePath("records/../escape"),
      child,
      "$.join",
    ),
    "format",
    "$.join.parent",
  );
  expectPortableResourcePathError(
    () => joinPortableResourcePath(
      parent,
      asPortableResourcePath("payload/../escape"),
      "$.join",
    ),
    "format",
    "$.join.child",
  );
});

test("absolute, scheme-like, backslash, empty, and dot forms are rejected", () => {
  const invalid = [
    "",
    "/absolute",
    "C:/windows",
    "file:resource",
    "https://example.test/file",
    "folder\\file",
    "folder/",
    "folder//file",
    ".",
    "..",
    "./file",
    "folder/./file",
    "folder/../file",
  ] as const;

  for (const value of invalid) {
    expectPortableResourcePathError(
      () => parsePortableResourcePath(value, "$.ref"),
      "format",
      "$.ref",
    );
  }
});

test("segment-edge whitespace and control characters are rejected", () => {
  const invalid = [
    " leading",
    "trailing ",
    "folder/ leading",
    "folder/trailing /file",
    "folder/\tfile",
    "folder/file\n",
    "folder/\u007ffile",
    "folder/\u0085file",
  ] as const;

  for (const value of invalid) {
    expectPortableResourcePathError(
      () => parsePortableResourcePath(value, "$.ref"),
      "format",
      "$.ref",
    );
  }
});

test("lone surrogates are rejected without replacement", () => {
  const invalid = `folder/${String.fromCharCode(0xd800)}.txt`;
  const error = expectPortableResourcePathError(
    () => parsePortableResourcePath(invalid, "$.ref"),
    "unicode-well-formed",
    "$.ref",
  );

  equal(error.message.includes("folder"), false);
  equal(error.message.includes("txt"), false);
});

test("canonically equivalent NFD text is rejected instead of normalized", () => {
  const nfc = "docs/caf\u00e9.md";
  const nfd = "docs/cafe\u0301.md";

  equal(parsePortableResourcePath(nfc), nfc);
  expectPortableResourcePathError(
    () => parsePortableResourcePath(nfd, "$.ref"),
    "unicode-normalization",
    "$.ref",
  );
});

test("brand inputs are revalidated before splitting", () => {
  expectPortableResourcePathError(
    () => splitPortableResourcePath(
      asPortableResourcePath("folder/../escape"),
      "$.ref",
    ),
    "format",
    "$.ref",
  );
  expectPortableResourcePathError(
    () => splitPortableResourcePath(
      asPortableResourcePath(`folder/${String.fromCharCode(0xd800)}`),
      "$.ref",
    ),
    "unicode-well-formed",
    "$.ref",
  );
});

test("PortableResourcePath is distinct from an unchecked string", () => {
  const raw: string = "demand.json";

  // @ts-expect-error 未经准入的 string 不能直接获得 PortableResourcePath 品牌。
  const unchecked: PortableResourcePath = raw;
  equal(unchecked, raw);

  const checked: PortableResourcePath = parsePortableResourcePath(raw);
  equal(checked, raw);
});
