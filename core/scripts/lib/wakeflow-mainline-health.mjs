import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import {
  durableWorkspaceConfigPath,
  resolveConfigPath,
  testWindowNames,
  workspaceLedgerPaths,
} from "./wakeflow-config.mjs";
import { isWakeflowInitStagingEntry } from "./wakeflow-active-demands.mjs";

function slash(value) {
  return String(value ?? "").split(path.sep).join("/");
}

function oneLine(error) {
  return String(error?.message ?? error).replace(/\s+/g, " ");
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

function readRegularJson(file, label) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    return {
      value: null,
      issue: issue("missing-runtime-record", `${label} is missing: ${file}`, {
        path: file,
        cause: oneLine(error),
      }),
    };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      value: null,
      issue: issue("invalid-runtime-record", `${label} must be a regular non-symlink file: ${file}`, {
        path: file,
      }),
    };
  }
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON value must be an object");
    }
    return { value, issue: null };
  } catch (error) {
    return {
      value: null,
      issue: issue("invalid-runtime-record", `${label} is unreadable: ${file}`, {
        path: file,
        cause: oneLine(error),
      }),
    };
  }
}

function jsonRecordsByWindow(directory, label) {
  if (!existsSync(directory)) return { records: new Map(), issues: [] };
  let stat;
  try {
    stat = lstatSync(directory);
  } catch (error) {
    return {
      records: new Map(),
      issues: [issue("invalid-runtime-directory", `${label} cannot be inspected: ${directory}`, {
        path: directory,
        cause: oneLine(error),
      })],
    };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return {
      records: new Map(),
      issues: [issue("invalid-runtime-directory", `${label} must be a regular non-symlink directory: ${directory}`, {
        path: directory,
      })],
    };
  }

  const records = new Map();
  const issues = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.name.endsWith(".json")) continue;
    const file = path.join(directory, entry.name);
    const read = readRegularJson(file, label);
    if (read.issue) {
      issues.push(read.issue);
      continue;
    }
    const windowName = typeof read.value.windowName === "string"
      ? read.value.windowName.trim()
      : "";
    if (!windowName) {
      issues.push(issue("invalid-runtime-record", `${label} has no windowName: ${file}`, {
        path: file,
      }));
      continue;
    }
    const existing = records.get(windowName);
    if (existing) {
      issues.push(issue(
        "duplicate-runtime-record",
        `${label} has more than one record for ${windowName}: ${existing.file}, ${file}`,
        { windowName },
      ));
      continue;
    }
    records.set(windowName, { file, value: read.value });
  }
  return { records, issues };
}

function configuredWindowRoot({ workspaceRoot, config, windowName }) {
  if (windowName === config.controllerWindow) {
    return { root: workspaceRoot, source: "workspace-root" };
  }
  const repository = (Array.isArray(config.repositories) ? config.repositories : [])
    .find((entry) => entry?.windowName === windowName);
  if (repository?.path) {
    return {
      root: resolveConfigPath(workspaceRoot, repository.path),
      source: "repositories",
      repository,
    };
  }
  if (windowName === config.designWindow && config.internalDesignPath) {
    return {
      root: resolveConfigPath(workspaceRoot, config.internalDesignPath),
      source: "internalDesignPath",
    };
  }
  if (testWindowNames(config).includes(windowName) && config.internalTestPath) {
    return {
      root: resolveConfigPath(workspaceRoot, config.internalTestPath),
      source: "internalTestPath",
    };
  }
  return null;
}

function expectedDeliveryRole(config, windowName) {
  if (windowName === config.controllerWindow) return "controller";
  if (windowName === config.designWindow) return "design";
  if (testWindowNames(config).includes(windowName)) return "test-target";
  return "target";
}

function inspectConfiguredRoot({ workspaceRoot, config, windowName }) {
  const configured = configuredWindowRoot({ workspaceRoot, config, windowName });
  if (!configured) {
    return {
      identity: null,
      issue: issue(
        "window-not-configured",
        `Required mainline window ${windowName} has no exact configured project root.`,
        { windowName },
      ),
    };
  }
  let stat;
  try {
    stat = lstatSync(configured.root);
  } catch (error) {
    return {
      identity: null,
      issue: issue(
        "project-root-missing",
        `Configured project root for ${windowName} is missing: ${configured.root}`,
        { windowName, path: configured.root, cause: oneLine(error) },
      ),
    };
  }
  if (!stat.isDirectory()) {
    return {
      identity: null,
      issue: issue(
        "project-root-invalid",
        `Configured project root for ${windowName} is not a directory: ${configured.root}`,
        { windowName, path: configured.root },
      ),
    };
  }
  try {
    return {
      identity: {
        windowName,
        configuredRoot: slash(path.resolve(configured.root)),
        canonicalRoot: slash(realpathSync(configured.root)),
        source: configured.source,
      },
      issue: null,
    };
  } catch (error) {
    return {
      identity: null,
      issue: issue(
        "project-root-unresolvable",
        `Configured project root for ${windowName} cannot be resolved exactly: ${configured.root}`,
        { windowName, path: configured.root, cause: oneLine(error) },
      ),
    };
  }
}

function resolveRecordedRoot(workspaceRoot, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspaceRoot, value);
  try {
    return slash(realpathSync(resolved));
  } catch {
    return null;
  }
}

function inspectRegistration({ windowName, record }) {
  if (!record) {
    return issue(
      "window-not-registered",
      `Required mainline window ${windowName} has no ${hostProfile.hostName} registration.`,
      { windowName },
    );
  }
  const registration = record.value;
  const threadId = typeof registration.threadId === "string"
    ? registration.threadId.trim()
    : "";
  if (
    registration.kind !== hostProfile.kinds.windowRegistration
    || registration.windowName !== windowName
    || !threadId
    || /\s/.test(threadId)
    || hostProfile.handleId.placeholders.includes(threadId.toLowerCase())
  ) {
    return issue(
      "window-registration-invalid",
      `Required mainline window ${windowName} has an invalid ${hostProfile.hostName} registration.`,
      { windowName, path: record.file },
    );
  }
  for (const timestampField of ["registeredAt", "lastVerifiedAt"]) {
    const timestamp = registration[timestampField];
    if (timestamp !== undefined && !Number.isFinite(Date.parse(timestamp))) {
      return issue(
        "window-registration-invalid",
        `Required mainline window ${windowName} has an invalid ${timestampField}.`,
        { windowName, path: record.file },
      );
    }
  }
  return null;
}

function inspectWindowConfig({
  workspaceRoot,
  config,
  windowName,
  record,
  identity,
}) {
  if (!record) {
    return issue(
      "window-runtime-missing",
      `Required mainline window ${windowName} has no derived runtime config.`,
      { windowName },
    );
  }
  const runtime = record.value;
  const role = expectedDeliveryRole(config, windowName);
  if (
    runtime.kind !== hostProfile.kinds.windowDispatchConfig
    || runtime.windowName !== windowName
    || runtime.threadRegistered !== true
    || runtime.deliveryRole !== role
  ) {
    return issue(
      "window-runtime-invalid",
      `Required mainline window ${windowName} has an invalid derived runtime config.`,
      { windowName, path: record.file },
    );
  }
  if (role !== "design" && runtime.dispatchable !== true) {
    return issue(
      "window-runtime-not-dispatchable",
      `Required mainline window ${windowName} is registered but not dispatchable.`,
      { windowName, path: record.file },
    );
  }

  const expectedRoot = identity?.canonicalRoot ?? null;
  const recordedCwd = resolveRecordedRoot(workspaceRoot, runtime.cwd);
  const recordedResponsibilityRoot = resolveRecordedRoot(workspaceRoot, runtime.responsibilityRoot);
  if (
    !expectedRoot
    || recordedCwd !== expectedRoot
    || recordedResponsibilityRoot !== expectedRoot
  ) {
    return issue(
      "window-project-identity-mismatch",
      `Required mainline window ${windowName} runtime root does not match its configured project root.`,
      {
        windowName,
        path: record.file,
        expectedRoot,
        recordedCwd,
        recordedResponsibilityRoot,
      },
    );
  }
  return null;
}

function inspectRecoveryResidue({
  workspaceRoot,
  config,
  ignoredCreateIntentFile = null,
}) {
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: [], config });
  const currentDir = ledgerPaths.workspaceCurrentDir;
  if (!existsSync(currentDir)) return [];
  let entries;
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch (error) {
    return [issue(
      "mainline-recovery-unreadable",
      `Cannot inspect the current demand directory for recovery state: ${currentDir}`,
      { path: currentDir, cause: oneLine(error) },
    )];
  }
  const issues = [];
  for (const entry of entries) {
    const file = path.join(currentDir, entry.name);
    if (isWakeflowInitStagingEntry(entry.name)) {
      issues.push(issue(
        "mainline-init-recovery-required",
        `Unresolved demand initialization staging state blocks a new mainline demand: ${file}`,
        { path: file },
      ));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".create-intent.json")) continue;
    if (ignoredCreateIntentFile && path.resolve(file) === path.resolve(ignoredCreateIntentFile)) {
      continue;
    }
    const read = readRegularJson(file, "create-demand recovery intent");
    if (read.issue) {
      issues.push(issue(
        "mainline-create-recovery-invalid",
        `Unreadable create-demand recovery intent blocks a new mainline demand: ${file}`,
        { path: file },
      ));
      continue;
    }
    const manifest = read.value;
    if (manifest?.intent?.placement === "pod") continue;
    if (manifest.status !== "complete" || manifest.partialCreated === true) {
      issues.push(issue(
        "mainline-create-recovery-required",
        `Unresolved mainline create-demand recovery blocks a new demand: ${file}`,
        { path: file, demandKey: manifest.demandKey ?? null, status: manifest.status ?? null },
      ));
    }
  }
  return issues;
}

export function inspectMainlineHealth({
  workspaceRoot,
  args = [],
  config,
  requiredProductWindows = [],
  ignoredCreateIntentFile = null,
} = {}) {
  const root = path.resolve(workspaceRoot ?? process.cwd());
  const configPath = durableWorkspaceConfigPath({ workspaceRoot: root, args });
  const issues = [];
  if (!existsSync(configPath)) {
    issues.push(issue(
      "workspace-config-missing",
      `Wakeflow workspace config is missing: ${configPath}`,
      { path: configPath },
    ));
  } else {
    try {
      const stat = lstatSync(configPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        issues.push(issue(
          "workspace-config-invalid",
          `Wakeflow workspace config must be a regular non-symlink file: ${configPath}`,
          { path: configPath },
        ));
      } else {
        const durableConfig = JSON.parse(readFileSync(configPath, "utf8"));
        if (!durableConfig || typeof durableConfig !== "object" || Array.isArray(durableConfig)) {
          throw new Error("JSON value must be an object");
        }
      }
    } catch (error) {
      issues.push(issue(
        "workspace-config-unreadable",
        `Wakeflow workspace config cannot be read as a JSON object: ${configPath}`,
        { path: configPath, cause: oneLine(error) },
      ));
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    issues.push(issue(
      "workspace-config-unreadable",
      "Wakeflow workspace config could not be loaded into an effective runtime configuration.",
      { path: configPath },
    ));
  }

  const requiredWindows = [...new Set([
    config?.controllerWindow,
    config?.designWindow,
    ...testWindowNames(config ?? {}),
    ...requiredProductWindows,
  ].map((value) => String(value ?? "").trim()).filter(Boolean))];

  const hostRoot = path.join(
    root,
    ".wakeflow-local",
    "wakeflow-delivery",
    "hosts",
    hostProfile.runtime.hostDirName,
  );
  const hostRegistrations = jsonRecordsByWindow(
    path.join(hostRoot, "thread-registry"),
    `${hostProfile.hostName} thread registration`,
  );
  const legacyRegistrations = hostProfile.runtime.legacyRegistryFallback
    ? jsonRecordsByWindow(
        path.join(root, ".wakeflow-local", "wakeflow-delivery", "thread-registry"),
        `legacy ${hostProfile.hostName} thread registration`,
      )
    : { records: new Map(), issues: [] };
  const windowConfigs = jsonRecordsByWindow(
    path.join(hostRoot, "window-config"),
    `${hostProfile.hostName} window runtime config`,
  );
  issues.push(...hostRegistrations.issues, ...legacyRegistrations.issues, ...windowConfigs.issues);

  const windows = [];
  if (config && typeof config === "object" && !Array.isArray(config)) {
    for (const windowName of requiredWindows) {
      const rootInspection = inspectConfiguredRoot({ workspaceRoot: root, config, windowName });
      if (rootInspection.issue) issues.push(rootInspection.issue);
      const registration = hostRegistrations.records.get(windowName)
        ?? legacyRegistrations.records.get(windowName)
        ?? null;
      const registrationIssue = inspectRegistration({ windowName, record: registration });
      if (registrationIssue) issues.push(registrationIssue);
      const runtimeConfig = windowConfigs.records.get(windowName) ?? null;
      const runtimeIssue = inspectWindowConfig({
        workspaceRoot: root,
        config,
        windowName,
        record: runtimeConfig,
        identity: rootInspection.identity,
      });
      if (runtimeIssue) issues.push(runtimeIssue);
      windows.push({
        windowName,
        role: expectedDeliveryRole(config, windowName),
        registered: !registrationIssue,
        runtimeHealthy: !runtimeIssue,
        projectIdentity: rootInspection.identity,
      });
    }
    issues.push(...inspectRecoveryResidue({
      workspaceRoot: root,
      config,
      ignoredCreateIntentFile,
    }));
  }

  return {
    available: issues.length === 0,
    host: hostProfile.hostId,
    configPath: slash(configPath),
    requiredWindows,
    windows,
    issues,
    identityVerification: {
      verified: "configured roots resolve canonically and match derived runtime cwd/responsibilityRoot",
      notObservableInSharedCore: `${hostProfile.hostName} live-session cwd and saved-project identity`,
    },
  };
}
