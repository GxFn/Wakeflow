import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  hasNodeSystemErrorCode,
  isNodeSystemError,
  readNodeSystemErrorCode,
  type NodeSystemError,
  type NodeSystemErrorCode,
} from "../../../src/foundation/node/node-system-error.js";

function asNodeSystemErrorCode(value: unknown): NodeSystemErrorCode {
  return value as NodeSystemErrorCode;
}

test("real Node.js filesystem errors expose their exact errno code", () => {
  const missing = path.join(
    os.tmpdir(),
    `wakeflow-node-system-error-${randomUUID()}`,
  );
  let caught: unknown;
  try {
    readFileSync(missing);
  } catch (error: unknown) {
    caught = error;
  }

  equal(readNodeSystemErrorCode(caught), "ENOENT");
  equal(hasNodeSystemErrorCode(caught, "ENOENT"), true);
  equal(hasNodeSystemErrorCode(caught, "EEXIST"), false);
  equal(isNodeSystemError(caught), true);
});

test("native Error objects with canonical own data codes are classified", () => {
  const error = new Error("private diagnostic");
  Object.defineProperty(error, "code", {
    value: "EXDEV",
    enumerable: true,
    writable: true,
    configurable: true,
  });

  const code: NodeSystemErrorCode | undefined =
    readNodeSystemErrorCode(error);
  equal(code, "EXDEV");
  equal(hasNodeSystemErrorCode(error, "EXDEV"), true);

  if (!isNodeSystemError(error)) {
    throw new Error("Expected a NodeSystemError type guard match.");
  }
  const narrowed: NodeSystemError = error;
  equal(narrowed.code, "EXDEV");
});

test("plain records and non-errors cannot spoof filesystem outcomes", () => {
  const invalid: readonly unknown[] = [
    { code: "ENOENT" },
    Object.create(null, {
      code: { value: "ENOENT", enumerable: true },
    }),
    "ENOENT",
    null,
    1,
    () => undefined,
  ];

  for (const value of invalid) {
    equal(readNodeSystemErrorCode(value), undefined);
    equal(hasNodeSystemErrorCode(value, "ENOENT"), false);
    equal(isNodeSystemError(value), false);
  }
});

test("accessor and inherited codes are ignored without executing behavior", () => {
  let getterCalls = 0;
  const accessor = new Error("accessor");
  Object.defineProperty(accessor, "code", {
    get: () => {
      getterCalls += 1;
      return "ENOENT";
    },
    enumerable: true,
    configurable: true,
  });
  equal(readNodeSystemErrorCode(accessor), undefined);
  equal(getterCalls, 0);

  const inherited = new Error("inherited");
  const prototype = Object.create(Error.prototype) as object;
  Object.defineProperty(prototype, "code", {
    value: "ENOENT",
    enumerable: true,
  });
  Object.setPrototypeOf(inherited, prototype);
  equal(readNodeSystemErrorCode(inherited), undefined);
});

test("Proxy errors are rejected before reflection traps can run", () => {
  let trapCalls = 0;
  const proxy = new Proxy(new Error("proxy"), {
    getOwnPropertyDescriptor: () => {
      trapCalls += 1;
      return {
        value: "ENOENT",
        enumerable: true,
        writable: true,
        configurable: true,
      };
    },
    getPrototypeOf: () => {
      trapCalls += 1;
      return Error.prototype;
    },
  });

  equal(readNodeSystemErrorCode(proxy), undefined);
  equal(hasNodeSystemErrorCode(proxy, "ENOENT"), false);
  equal(isNodeSystemError(proxy), false);
  equal(trapCalls, 0);
});

test("Node internal, malformed, and non-string codes are not errno codes", () => {
  const invalid: readonly unknown[] = [
    "ERR_INVALID_ARG_TYPE",
    "enoent",
    "E",
    "E-NOENT",
    `E${"A".repeat(64)}`,
    2,
    null,
  ];

  for (const code of invalid) {
    const error = new Error("invalid code");
    Object.defineProperty(error, "code", {
      value: code,
      enumerable: true,
    });
    equal(readNodeSystemErrorCode(error), undefined);
  }

  const valid = Object.assign(new Error("valid"), { code: "E2BIG" });
  equal(readNodeSystemErrorCode(valid), "E2BIG");
});

test("expected codes are revalidated despite their compile-time shape", () => {
  const error = Object.assign(new Error("missing"), { code: "ENOENT" });

  for (const expected of [
    "ERR_INVALID_ARG_TYPE",
    "enoent",
    "E",
  ] as const) {
    equal(
      hasNodeSystemErrorCode(
        error,
        asNodeSystemErrorCode(expected),
      ),
      false,
    );
  }
});

test("NodeSystemError is distinct from an unchecked Error", () => {
  const raw: Error = new Error("unchecked");

  // @ts-expect-error 普通 Error 未经 code 分类，不能直接获得 NodeSystemError 类型。
  const unchecked: NodeSystemError = raw;
  equal(unchecked, raw);
});

test("node-system-error performs only passive code classification", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/foundation/node/node-system-error.ts"),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);

  deepEqual(imports, ["node:util"]);
  equal(source.includes(".message"), false);
  equal(source.includes(".path"), false);
  equal(source.includes(".syscall"), false);
  equal(source.includes(".errno"), false);
  equal(source.includes(".cause"), false);
  equal(source.includes("String(value)"), false);
  equal(source.includes("types.isProxy(value)"), true);
  equal(source.includes("Object.getOwnPropertyDescriptor(value, \"code\")"), true);
});
