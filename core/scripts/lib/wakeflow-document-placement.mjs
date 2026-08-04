import path from "node:path";

import {
  loadWorkspaceConfig,
  resolveConfigPath,
  windowLedgerDirFor,
  workspaceLedgerPaths,
} from "./wakeflow-config.mjs";

// One semantic registry for Wakeflow documents. Paths remain configurable,
// but producers, generated instructions, storage projections, and validators
// must all describe the same ownership and lifecycle.
export const DOCUMENT_CATEGORIES = Object.freeze({
  requirement: Object.freeze({
    id: "requirement",
    storageClass: "authority",
    owner: "Design or controller acting through the same demand-authority contract",
    lifecycle: "draft -> canonical requirement record -> frozen demand authority",
    description: "Requirement, bug, supplement, or research definition and its confirmed boundaries.",
  }),
  goalStage: Object.freeze({
    id: "goal-stage",
    storageClass: "authority",
    owner: "controller",
    lifecycle: "append confirmation records; retain as durable workspace history",
    description: "Goal/stage confirmation and cross-window execution decisions.",
  }),
  workspaceRecord: Object.freeze({
    id: "workspace-record",
    storageClass: "authority",
    owner: "controller",
    lifecycle: "indexed durable record",
    description: "Workspace-wide policy, plan, acceptance, scan, and boundary records.",
  }),
  windowRecord: Object.freeze({
    id: "window-record",
    storageClass: "authority",
    owner: "the named responsibility window",
    lifecycle: "append-only responsibility history; never demand authority",
    description: "Window-specific handoff, acceptance, operating, and investigation records.",
  }),
  activeState: Object.freeze({
    id: "active-state",
    storageClass: "authority",
    owner: "controller docs plus Wakeflow reducers",
    lifecycle: "active only; archive through Wakeflow",
    description: "Current workspace projections and active demand state roots.",
  }),
  localRuntime: Object.freeze({
    id: "local-runtime",
    storageClass: "runtime",
    owner: "Wakeflow host/runtime",
    lifecycle: "replay-safe runtime, evidence, handles, or preserved audit hold",
    description: "Machine-local delivery/runtime data; never a document-authoring destination.",
  }),
  projection: Object.freeze({
    id: "projection",
    storageClass: "projection",
    owner: "Wakeflow renderers",
    lifecycle: "regenerable from state, events, config, or canonical records",
    description: "Human or machine views that display authority but never create it.",
  }),
  hostState: Object.freeze({
    id: "host-state",
    storageClass: "handles",
    owner: "the active Codex or Claude Code host adapter",
    lifecycle: "machine-local registration and verified host receipts",
    description: "Thread registries, Pod bindings, materialization receipts, and other host-scoped facts.",
  }),
  runtimeHandle: Object.freeze({
    id: "runtime-handle",
    storageClass: "handles",
    owner: "Wakeflow runtime and host adapters",
    lifecycle: "short-lived lock, pid, prompt, or keep-live state; regenerate or release through its owning tool",
    description: "Operational handles that coordinate execution but do not describe business completion.",
  }),
  transport: Object.freeze({
    id: "transport",
    storageClass: "transport",
    owner: "Wakeflow delivery preparation and recording",
    lifecycle: "replay-safe delivery history; prune only through Wakeflow retention tools",
    description: "Dispatch packets, groups, envelopes, and delivery-run observations.",
  }),
  evidence: Object.freeze({
    id: "evidence",
    storageClass: "evidence",
    owner: "target result recording",
    lifecycle: "retain as review input and audit history; never delete through transport GC",
    description: "TargetResultEnvelopes and other target-authored review inputs.",
  }),
  preserved: Object.freeze({
    id: "preserved",
    storageClass: "preserved",
    owner: "Wakeflow preserve and redacted archive operations",
    lifecycle: "manifested local audit hold; user review precedes retention pruning",
    description: "Unredacted originals and explicitly preserved local audit material.",
  }),
  archive: Object.freeze({
    id: "archive",
    storageClass: "authority",
    owner: "Wakeflow archive operations",
    lifecycle: "immutable historical demand or workspace record",
    description: "Completed, portable history grouped by archive policy.",
  }),
});

function slash(value) {
  return value.split(path.sep).join("/");
}

function relativeFrom(root, target) {
  const relative = slash(path.relative(root, target));
  return relative || ".";
}

function inside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function documentPlacements({
  workspaceRoot = process.cwd(),
  args = process.argv.slice(2),
  config = null,
  windowName = null,
  displayRoot = workspaceRoot,
} = {}) {
  const loaded = config ?? loadWorkspaceConfig({ workspaceRoot, args });
  const ledger = workspaceLedgerPaths({ workspaceRoot, args, config: loaded });
  const goalStageDir = resolveConfigPath(
    workspaceRoot,
    loaded?.goalStageConfirmationDir ?? "../wakeflow-ledger/goal-stage-confirmation",
  );
  const windowRecordDir = windowName
    ? windowLedgerDirFor({ workspaceRoot, config: loaded, windowName })
    : null;
  const localRuntimeRoot = path.join(workspaceRoot, ".wakeflow-local");
  const deliveryRoot = path.join(localRuntimeRoot, "wakeflow-delivery");
  const entries = {
    requirement: {
      ...DOCUMENT_CATEGORIES.requirement,
      path: ledger.requirementDesignsDir,
    },
    goalStage: {
      ...DOCUMENT_CATEGORIES.goalStage,
      path: goalStageDir,
    },
    workspaceRecord: {
      ...DOCUMENT_CATEGORIES.workspaceRecord,
      path: path.dirname(ledger.workspaceRecordMapPath),
    },
    windowRecord: {
      ...DOCUMENT_CATEGORIES.windowRecord,
      path: windowRecordDir,
    },
    activeState: {
      ...DOCUMENT_CATEGORIES.activeState,
      path: ledger.workspaceCurrentDir,
      rootPath: ledger.activeLedgerRoot,
    },
    projection: {
      ...DOCUMENT_CATEGORIES.projection,
      path: ledger.workspaceCurrentDir,
    },
    localRuntime: {
      ...DOCUMENT_CATEGORIES.localRuntime,
      path: localRuntimeRoot,
    },
    hostState: {
      ...DOCUMENT_CATEGORIES.hostState,
      path: path.join(deliveryRoot, "hosts"),
    },
    runtimeHandle: {
      ...DOCUMENT_CATEGORIES.runtimeHandle,
      path: deliveryRoot,
    },
    transport: {
      ...DOCUMENT_CATEGORIES.transport,
      path: deliveryRoot,
    },
    evidence: {
      ...DOCUMENT_CATEGORIES.evidence,
      path: path.join(deliveryRoot, "target-results"),
    },
    preserved: {
      ...DOCUMENT_CATEGORIES.preserved,
      path: path.join(localRuntimeRoot, "preserved"),
    },
    archive: {
      ...DOCUMENT_CATEGORIES.archive,
      path: ledger.workspaceArchiveDir,
    },
  };
  return Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, {
    ...value,
    relativePath: value.path ? relativeFrom(displayRoot, value.path) : null,
  }]));
}

export function documentDestinationLines(options = {}) {
  const placements = documentPlacements(options);
  const lines = [
    `- Demand definitions, requirement deltas, test-environment specifications, and confirmed boundaries go to \`${placements.requirement.relativePath}/\`; these are the only durable documents that may become demand-authority anchors.`,
    `- Goal/stage confirmations and cross-window execution decisions go to \`${placements.goalStage.relativePath}/\`.`,
    `- Workspace-wide plans, policies, acceptance records, scans, and boundary records go to \`${placements.workspaceRecord.relativePath}/\` and stay indexed by the workspace record map.`,
  ];
  if (placements.windowRecord.path) {
    lines.push(`- This window's responsibility-specific operating history and handoffs go to \`${placements.windowRecord.relativePath}/\`; do not place demand definitions there.`);
  }
  lines.push(
    `- Current projections and state roots live under \`${placements.activeState.relativePath}/\`; do not use active runtime as a durable document library.`,
    `- \`${placements.localRuntime.relativePath}/\` is machine-local runtime only, never an authoring destination.`,
  );
  return lines;
}

export function demandAuthorityPlacementIssue({
  workspaceRoot = process.cwd(),
  config = null,
  ref,
} = {}) {
  if (typeof ref !== "string" || !ref.trim()) return null;
  const fileRef = ref.split("#", 1)[0];
  if (!fileRef) return null;
  const absolute = path.isAbsolute(fileRef)
    ? path.resolve(fileRef)
    : path.resolve(workspaceRoot, fileRef);
  const placements = documentPlacements({ workspaceRoot, config });
  if (inside(absolute, placements.requirement.path) || inside(absolute, placements.goalStage.path)) {
    return null;
  }
  return `demand authority reference ${ref} is outside the canonical requirement roots ${placements.requirement.relativePath}/ and ${placements.goalStage.relativePath}/; keep legacy evidence readable, but promote the demand definition before freezing new authority`;
}
