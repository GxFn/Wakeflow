import { createHash, randomUUID } from "node:crypto";
import { hostProfile } from "./wakeflow-host-profile.mjs";

function legacyBindingId({ windowName, registeredAt }) {
  return `legacy-${createHash("sha256")
    .update(JSON.stringify({ windowName, registeredAt: registeredAt || null }))
    .digest("hex")
    .slice(0, 24)}`;
}

const entrySyncStatuses = new Set(["pending", "ready", "failed"]);

export function entrySyncStatusForRegistration(registration) {
  if (!registration) return "missing";
  if (entrySyncStatuses.has(registration.entrySyncStatus)) {
    return registration.entrySyncStatus;
  }
  return registration.entrySyncStatus === undefined
    ? "legacy-assumed-ready"
    : "invalid";
}

export function threadRegistrationReady(registration) {
  return ["ready", "legacy-assumed-ready"].includes(
    entrySyncStatusForRegistration(registration),
  );
}

export function createThreadRegistration({
  windowName,
  threadId,
  registeredAt,
  entrySyncStatus = "pending",
  entrySyncCheckedAt = registeredAt,
  bindingId = randomUUID(),
  version = 4,
}) {
  if (!entrySyncStatuses.has(entrySyncStatus)) {
    throw new Error(`Invalid entrySyncStatus for ${windowName}: ${entrySyncStatus}`);
  }
  return {
    kind: hostProfile.kinds.windowRegistration,
    version,
    windowName,
    bindingId,
    threadId,
    registeredAt,
    entrySyncStatus,
    entrySyncCheckedAt,
    lastVerifiedAt: entrySyncStatus === "ready" ? entrySyncCheckedAt : null,
  };
}

export function normalizeThreadRegistrationRecord({
  windowName,
  registration,
  threadRegistryFile,
  version = 4,
}) {
  if (registration.kind !== hostProfile.kinds.windowRegistration) {
    throw new Error(`Invalid thread registration for ${windowName}.`);
  }
  if (!registration.threadId) {
    throw new Error(`Thread registration for ${windowName} is missing threadId.`);
  }
  const entrySyncStatus = entrySyncStatusForRegistration(registration);
  if (entrySyncStatus === "invalid") {
    throw new Error(`Thread registration for ${windowName} has an invalid entrySyncStatus.`);
  }
  return {
    kind: hostProfile.kinds.windowRegistration,
    version,
    windowName: registration.windowName || windowName,
    bindingId: registration.bindingId || legacyBindingId({
      windowName: registration.windowName || windowName,
      registeredAt: registration.registeredAt,
    }),
    threadId: registration.threadId,
    registeredAt: registration.registeredAt,
    entrySyncStatus,
    entrySyncCheckedAt: registration.entrySyncCheckedAt,
    lastVerifiedAt: registration.lastVerifiedAt,
    threadRegistryFile,
  };
}

export function buildWindowDispatchConfig({
  windowName,
  config,
  repository,
  deliveryRole,
  cwd,
  responsibilityRoot,
  registration,
  threadRegistryFile,
  generatedAt,
  version = 2,
}) {
  const dispatchWindows = new Set([
    ...(Array.isArray(config.dispatchWindows) ? config.dispatchWindows : []),
    ...(Array.isArray(config.requiredDispatchWindows) ? config.requiredDispatchWindows : []),
    config.controllerWindow,
  ].filter(Boolean));
  const threadReady = threadRegistrationReady(registration);
  const dispatchable = threadReady
    && ["controller", "target", "test-target"].includes(deliveryRole)
    && (dispatchWindows.size === 0 || dispatchWindows.has(windowName) || Boolean(registration));
  return {
    kind: hostProfile.kinds.windowDispatchConfig,
    version,
    windowName,
    repositoryPath: repository?.path,
    responsibility: repository?.role,
    dispatchable,
    threadRegistered: Boolean(registration),
    threadReady,
    entrySyncStatus: entrySyncStatusForRegistration(registration),
    threadBindingId: registration?.bindingId,
    threadRegistryFile,
    cwd,
    responsibilityRoot,
    deliveryRole,
    delivery: {
      transport: "direct-thread",
      requireThread: true,
      missingThread: "fail-closed",
      readbackRequired: true,
    },
    automation: {
      mode: "manual-or-unattended",
      continuousWhenEnabled: true,
      keepLive: "required-when-automation-enabled",
    },
    result: {
      returnRoute: "controller",
      resultEnvelopeRequired: true,
    },
    generatedAt,
  };
}
