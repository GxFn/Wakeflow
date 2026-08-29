import {
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  parseDurableAtomicFileStageFileName,
  readDurableAtomicFileStageOwnerState,
  releaseDurableAtomicFileStageAddress,
  DurableAtomicFileStageAddressError,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";

const INPUT_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);

test("atomic stage address 绑定 operation、target、input、mode 与 process owner", () => {
  const target = parsePortableResourcePath("records/record.json");
  const issued = issueDurableAtomicFileStageAddress(
    "create",
    target,
    INPUT_DIGEST,
    0o600,
  );
  try {
    const parsed = parseDurableAtomicFileStageFileName(issued.fileName);
    equal(parsed.operation, "create");
    equal(parsed.targetResourcePathDigest, issued.targetResourcePathDigest);
    equal(parsed.inputDigest, INPUT_DIGEST);
    equal(parsed.mode, 0o600);
    equal(parsed.pid, process.pid);
    equal(parsed.token, issued.token);
    equal(issued.fileName.startsWith(".wakeflow-atomic-v1-create-"), true);
    equal(readDurableAtomicFileStageOwnerState(parsed), "active");
    equal(issued.fileName.includes("records"), false);
    equal(Object.isFrozen(issued), true);
  } finally {
    releaseDurableAtomicFileStageAddress(issued);
  }
  equal(readDurableAtomicFileStageOwnerState(issued), "inactive");
});

test("atomic stage address 拒绝伪造格式与非签发 release", () => {
  for (const value of [
    ".wakeflow-stage-deadbeef.tmp",
    ".wakeflow-atomic-create-stage.tmp",
    ".wakeflow-atomic-create-zz-m600__1-0-token.tmp",
    "x".repeat(1_024),
  ]) {
    throws(
      () => parseDurableAtomicFileStageFileName(value),
      DurableAtomicFileStageAddressError,
    );
  }
  throws(
    () => releaseDurableAtomicFileStageAddress(
      Object.freeze({}) as never,
    ),
    DurableAtomicFileStageAddressError,
  );

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "fileName", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "forged";
    },
  });
  throws(
    () => readDurableAtomicFileStageOwnerState(accessor as never),
    DurableAtomicFileStageAddressError,
  );
  equal(getterCalls, 0);
});
