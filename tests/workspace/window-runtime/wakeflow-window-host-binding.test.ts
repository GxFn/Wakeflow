import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  codexWindowHostIdentityProfile,
} from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import {
  computeWakeflowWindowHostBindingDigest,
  createWakeflowWindowHostBinding,
  parseWakeflowWindowHostBindingDocument,
  renderWakeflowWindowHostBinding,
  WakeflowWindowHostBindingError,
} from "../../../src/workspace/window-runtime/wakeflow-window-host-binding.js";
import {
  parseWakeflowWindowHostBindingId,
} from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";
import {
  parseWakeflowWindowHostHandle,
  WakeflowWindowHostIdentityProfileError,
} from "../../../src/workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/foundation/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";

const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
const WINDOW_ID = parseWakeflowDurableIdOfKind(
  "window_22222222-2222-4222-8222-222222222222",
  "window",
);
const BINDING_ID = parseWakeflowWindowHostBindingId(
  "window_binding_33333333-3333-4333-8333-333333333333",
);
const INTENT_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);

test("Host Identity Profile 把宿主 ID 当作不透明值而非旧 UUID 假设", () => {
  const handle = parseWakeflowWindowHostHandle(
    codexWindowHostIdentityProfile,
    {
      kind: "codex-thread",
      value: "host-owned:opaque/thread?id=7",
    },
  );
  deepEqual(handle, {
    kind: "codex-thread",
    value: "host-owned:opaque/thread?id=7",
  });
  throws(
    () => parseWakeflowWindowHostHandle(
      codexWindowHostIdentityProfile,
      { kind: "codex-thread", value: "current thread" },
    ),
    (error: unknown) => (
      error instanceof WakeflowWindowHostIdentityProfileError
      && error.reason === "handle"
    ),
  );
  throws(
    () => parseWakeflowWindowHostHandle(
      codexWindowHostIdentityProfile,
      { kind: "claude-session", value: "opaque" },
    ),
    WakeflowWindowHostIdentityProfileError,
  );
});

test("Window Host Binding 保存私有 handle 并形成唯一确定性文档", () => {
  const handle = parseWakeflowWindowHostHandle(
    codexWindowHostIdentityProfile,
    { kind: "codex-thread", value: "host-owned:opaque/thread?id=7" },
  );
  const binding = createWakeflowWindowHostBinding({
    programId: PROGRAM_ID,
    hostId: "codex",
    windowId: WINDOW_ID,
    bindingId: BINDING_ID,
    handle,
    launchIntentDigest: INTENT_DIGEST,
    observedAt: parseUtcInstant("2026-08-28T10:00:00.000Z"),
    registeredAt: parseUtcInstant("2026-08-28T10:00:01.000Z"),
  });
  const document = renderWakeflowWindowHostBinding(binding);
  equal(document.includes(handle.value), true);
  equal(document.endsWith("\n"), true);
  deepEqual(parseWakeflowWindowHostBindingDocument(document), binding);
  equal(
    /^sha256:[0-9a-f]{64}$/u.test(
      computeWakeflowWindowHostBindingDigest(binding),
    ),
    true,
  );

  throws(
    () => createWakeflowWindowHostBinding({
      ...binding,
      launchIntentDigest: INTENT_DIGEST,
      observedAt: parseUtcInstant("2026-08-28T10:00:02.000Z"),
      registeredAt: parseUtcInstant("2026-08-28T10:00:01.000Z"),
    }),
    (error: unknown) => (
      error instanceof WakeflowWindowHostBindingError
      && error.reason === "relation"
    ),
  );
});
