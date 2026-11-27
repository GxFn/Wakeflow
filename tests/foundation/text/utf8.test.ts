import { deepEqual, equal, notEqual } from "node:assert/strict";
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

test("ASCII, Unicode, NUL, Buffer, and offset views round-trip exactly", () => {
  const values = ["", "Wakeflow", "Wakeflow 中文 🚀", "a\0b", "𝄞 café"] as const;

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

test("encoding rejects lone surrogates without coercion", () => {
  for (const value of ["\ud800", "\udfff", "a\ud800b", "a\udfffb"]) {
    expectUtf8Error(() => encodeUtf8(value, "$.text"), "ill-formed-text", "$.text");
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
