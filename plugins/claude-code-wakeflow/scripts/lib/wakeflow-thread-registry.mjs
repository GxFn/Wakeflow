import { createHash, randomUUID } from "node:crypto";
import { hostProfile } from "./wakeflow-host-profile.mjs";

function legacyBindingId({ windowName, registeredAt }) {
  return `legacy-${createHash("sha256")
    .update(JSON.stringify({ windowName, registeredAt: registeredAt || null }))
    .digest("hex")
    .slice(0, 24)}`;
}

export function createThreadRegistration({
  windowName,
  threadId,
  registeredAt,
  bindingId = randomUUID(),
  version = 3,
}) {
  return {
    kind: hostProfile.kinds.windowRegistration,
    version,
    windowName,
    bindingId,
    threadId,
    registeredAt,
    lastVerifiedAt: registeredAt,
  };
}

export function normalizeThreadRegistrationRecord({
  windowName,
  registration,
  threadRegistryFile,
  version = 3,
}) {
  if (registration.kind !== hostProfile.kinds.windowRegistration) {
    throw new Error(`Invalid thread registration for ${windowName}.`);
  }
  if (!registration.threadId) {
    throw new Error(`Thread registration for ${windowName} is missing threadId.`);
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
  version = 1,
}) {
  const dispatchWindows = new Set([
    ...(Array.isArray(config.dispatchWindows) ? config.dispatchWindows : []),
    ...(Array.isArray(config.requiredDispatchWindows) ? config.requiredDispatchWindows : []),
    config.controllerWindow,
  ].filter(Boolean));
  const dispatchable = ["controller", "target", "test-target"].includes(deliveryRole)
    && (dispatchWindows.size === 0 || dispatchWindows.has(windowName) || Boolean(registration));
  return {
    kind: hostProfile.kinds.windowDispatchConfig,
    version,
    windowName,
    repositoryPath: repository?.path,
    responsibility: repository?.role,
    dispatchable,
    threadRegistered: Boolean(registration),
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
