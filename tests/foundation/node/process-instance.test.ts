import { equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { observeProcessInstance, recordedProcessIsInactive } from "../../../src/foundation/node/process-instance.js";

test("process birth observations are stable, and PID replacement needs positive evidence", async () => {
  const one = await observeProcessInstance(process.pid);
  const two = await observeProcessInstance(process.pid);
  equal(one.state, "active");
  equal(two.birthDigest, one.birthDigest);
  const old = computeCanonicalJsonSha256Digest({ birth: "old" });
  const current = computeCanonicalJsonSha256Digest({ birth: "new" });
  equal(recordedProcessIsInactive(old, { state: "active", birthDigest: current }), true);
  equal(recordedProcessIsInactive(old, { state: "unknown", birthDigest: current }), true);
  equal(recordedProcessIsInactive(old, { state: "active", birthDigest: old }), false);
  equal(recordedProcessIsInactive(old, { state: "unknown", birthDigest: null }), false);
  equal(recordedProcessIsInactive(null, { state: "active", birthDigest: current }), false);
  equal(recordedProcessIsInactive(null, { state: "inactive", birthDigest: null }), true);
  await rejects(observeProcessInstance(-1), TypeError);
});
