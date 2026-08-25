import { deepEqual, equal, notEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  decodeUtf8,
  encodeUtf8,
  Utf8Error,
  type Utf8ErrorReason,
} from "../../../src/foundation/text/utf8.js";

function expectUtf8Error(
  action: () => unknown,
  reason: Utf8ErrorReason,
  expectedPath: string,
): Utf8Error {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof Utf8Error)) {
    throw new Error("Expected Utf8Error.");
  }
  equal(caught.name, "Utf8Error");
  equal(caught.code, "wakeflow-utf8");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asBytes(value: unknown): Uint8Array {
  return value as Uint8Array;
}

function asText(value: unknown): string {
  return value as string;
}

test("ASCII, Unicode, NUL, Buffer, and offset views round-trip exactly", () => {
  const values = [
    "",
    "Wakeflow",
    "Wakeflow 中文 🚀",
    "a\0b",
    "𝄞 café",
  ] as const;

  for (const value of values) {
    const bytes = encodeUtf8(value);
    equal(decodeUtf8(bytes), value);
    deepEqual([...bytes], [...Buffer.from(value, "utf8")]);
  }

  equal(decodeUtf8(Buffer.from("buffer", "utf8")), "buffer");
  const storage = Uint8Array.from([0xff, 0x61, 0x62, 0x63, 0xee]);
  const view = new Uint8Array(storage.buffer, 1, 3);
  equal(decodeUtf8(view), "abc");
});

test("initial UTF-8 BOM is preserved and re-encodes to the same bytes", () => {
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]);
  const text = decodeUtf8(bytes);

  equal(text, "\ufeffa");
  equal(text.length, 2);
  deepEqual([...encodeUtf8(text)], [...bytes]);
});

test("fatal decoding rejects malformed and truncated UTF-8 without replacement", () => {
  const invalid = [
    [0x80],
    [0xc0, 0xaf],
    [0xc3, 0x28],
    [0xe2, 0x82],
    [0xed, 0xa0, 0x80],
    [0xf0, 0x28, 0x8c, 0xbc],
    [0xf4, 0x90, 0x80, 0x80],
  ] as const;

  for (const bytes of invalid) {
    expectUtf8Error(
      () => decodeUtf8(Uint8Array.from(bytes), "$.bytes"),
      "decode-failure",
      "$.bytes",
    );
  }

  // fatal 失败后 decoder 不保留 streaming 状态，下一次独立调用仍可正常使用。
  equal(decodeUtf8(Uint8Array.from([0x61])), "a");
});

test("decoding accepts only Uint8Array inputs and invokes no proxy traps", () => {
  for (const value of [
    "abc",
    [0x61, 0x62, 0x63],
    new ArrayBuffer(3),
    new DataView(new ArrayBuffer(3)),
    new Uint16Array([0x6162]),
  ]) {
    expectUtf8Error(
      () => decodeUtf8(asBytes(value), "$.bytes"),
      "bytes-type",
      "$.bytes",
    );
  }

  let trapCalls = 0;
  const proxy = new Proxy(new Uint8Array([0x61]), {
    getPrototypeOf() {
      trapCalls += 1;
      return Uint8Array.prototype;
    },
  });
  expectUtf8Error(
    () => decodeUtf8(asBytes(proxy), "$.bytes"),
    "bytes-type",
    "$.bytes",
  );
  equal(trapCalls, 0);
});

test("encoding rejects non-strings and lone surrogates without coercion", () => {
  let conversionCalls = 0;
  const executableText = {
    toString() {
      conversionCalls += 1;
      return "text";
    },
  };
  expectUtf8Error(
    () => encodeUtf8(asText(executableText), "$.text"),
    "text-type",
    "$.text",
  );
  equal(conversionCalls, 0);

  for (const value of [
    "\ud800",
    "\udfff",
    "a\ud800b",
    "a\udfffb",
  ]) {
    expectUtf8Error(
      () => encodeUtf8(value, "$.text"),
      "ill-formed-text",
      "$.text",
    );
  }

  // 一对完整 surrogate 表示一个合法 scalar value。
  equal(decodeUtf8(encodeUtf8("\ud83d\ude80")), "🚀");
});

test("encoding returns independent byte arrays", () => {
  const first = encodeUtf8("abc");
  const second = encodeUtf8("abc");

  notEqual(first, second);
  deepEqual([...first], [0x61, 0x62, 0x63]);
  deepEqual([...second], [0x61, 0x62, 0x63]);
  first[0] = 0x7a;
  equal(decodeUtf8(second), "abc");
});

test("UTF-8 errors normalize paths and disclose no rejected material", () => {
  const error = expectUtf8Error(
    () => decodeUtf8(Uint8Array.from([0xc3, 0x28]), ""),
    "decode-failure",
    "$",
  );
  const textError = expectUtf8Error(
    () => encodeUtf8("private-\ud800", "$.text"),
    "ill-formed-text",
    "$.text",
  );

  equal(error.message.includes("c3"), false);
  equal(textError.message.includes("private"), false);
  equal("cause" in error, false);
  equal("cause" in textError, false);
});

test("utf8 has one standards dependency and owns no file or domain policy", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/foundation/text/utf8.ts"),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);

  deepEqual(imports, ["node:util"]);
  equal(source.includes('fatal: true'), true);
  equal(source.includes('ignoreBOM: true'), true);
  equal(source.includes("isWellFormed()"), true);
  equal(source.includes("node:fs"), false);
  equal(source.includes("JSON.parse"), false);
  equal(source.includes("maximumBytes"), false);
  equal(source.includes("canonical-json"), false);
});
