import { hostProfile } from "./wakeflow-host-profile.mjs";

export function createThreadRegistration({ windowName, threadId, registeredAt, version = 2 }) {
  return {
    kind: hostProfile.kinds.windowRegistration,
    version,
    windowName,
    threadId,
    registeredAt,
    lastVerifiedAt: registeredAt,
  };
}

export function normalizeThreadRegistrationRecord({
  windowName,
  registration,
  threadRegistryFile,
  version = 2,
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
