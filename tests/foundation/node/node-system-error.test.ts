import { equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import {
  readNodeSystemErrorCode,
  type NodeSystemErrorCode,
} from "../../../src/foundation/node/node-system-error.js";

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
});

test("native and cross-realm Error objects expose canonical own data codes", () => {
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

  const crossRealm: unknown = runInNewContext(
    "Object.assign(new Error('private'), { code: 'ENOENT' })",
  );
  equal(readNodeSystemErrorCode(crossRealm), "ENOENT");
});

test("plain records and non-errors cannot spoof filesystem outcomes", () => {
  const invalid: readonly unknown[] = [
    { code: "ENOENT" },
    Object.create(null, {
      code: { value: "ENOENT", enumerable: true },
    }),
    Object.create(Error.prototype, {
      code: { value: "ENOENT", enumerable: true },
    }),
    "ENOENT",
    null,
    1,
    () => undefined,
  ];

  for (const value of invalid) {
    equal(readNodeSystemErrorCode(value), undefined);
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
