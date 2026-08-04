import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { documentPlacements } from "./wakeflow-document-placement.mjs";

// The document-placement registry owns category/path/owner/lifecycle semantics.
// This module adds physical tree statistics, GC commands, and hand-edit advice
// for `wakeflow-storage map`, seed-readmes, and host workspace checks.
// Classes are DESCRIPTIVE, never gates:
//   authority   machine/human truth — never hand-delete while active
//   projection  regenerable views — safe to delete, a render rebuilds them
//   transport   replay-safe delivery artifacts — GC'd only by prune-runtime
//   evidence    target results — never deleted by any GC
//   handles     host session handles/locks — regenerable, host-scoped
//   preserved   canonical audit holds under preserved/ — manifest + retention
//   legacy      known residue from older runtime versions — fold or delete
//   unknown     anything else under .wakeflow-local — route to the user

export const PRESERVED_DIR = "preserved";
export const PRESERVED_MANIFEST = "MANIFEST.md";
export const DEFAULT_PRESERVED_RETENTION_DAYS = 30;

// Known residue names from older runtime versions or pre-convention manual
// rescues. Presence is reported as `legacy` (fold into preserved/ or delete
// after review), never auto-handled.
export const LEGACY_LOCAL_TREES = [
  "pod-reservations", // pre-0.9.0 Pod placement hint (state root is now canonical)
  "preserved-state-roots",
  "preserved-wakeflow-delivery",
  "preserved-delivery-artifacts",
  "runtime-quarantine",
  "wakeflow-delivery-quarantine",
  "wakeflow-intake",
];
export const LEGACY_DELIVERY_TREES = [
  "archived-transport",
  "thread-registry", // pre-dual-host top-level registry (read-fallback only)
];

export function preservedRetentionDays(config) {
  const value = Number(config?.preservedRetentionDays);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PRESERVED_RETENTION_DAYS;
}

function statsFor(dir) {
  if (!existsSync(dir)) return { exists: false, files: 0, bytes: 0, newest: null };
  let files = 0;
  let bytes = 0;
  let newest = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files += 1;
        try {
          const st = statSync(full);
          bytes += st.size;
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        } catch {
          // unreadable entry: count it, skip stats
        }
      }
    }
  };
  walk(dir);
  return { exists: true, files, bytes, newest: newest ? new Date(newest).toISOString() : null };
}

// Directories the runtime itself creates under .wakeflow-local and
// .wakeflow-local/wakeflow-delivery. Everything else there is unknown.
const KNOWN_LOCAL_ENTRIES = new Set([
  "wakeflow-delivery",
  "worktrees",
  "wakeflow-statusline.mjs",
  "wakeflow.config.json",
  "workspace.config.json", // legacy config name (read fallback)
  PRESERVED_DIR,
  ...LEGACY_LOCAL_TREES,
  "README.md",
  ".DS_Store",
]);
const KNOWN_DELIVERY_ENTRIES = new Set([
  "dispatch-packets",
  "dispatch-groups",
  "delivery-envelopes",
  "delivery-runs",
  "target-results",
  "handles",
  "locks",
  "stop.json",
  "keep-live",
  "hosts",
  ...LEGACY_DELIVERY_TREES,
  "README.md",
  ".DS_Store",
]);

export function scanStorage({ workspaceRoot, config = {} }) {
  const placements = documentPlacements({ workspaceRoot, config });
  const localDir = placements.localRuntime.path;
  const deliveryDir = placements.transport.path;
  const activeDir = placements.activeState.rootPath;
  const ledgerRoot = path.resolve(workspaceRoot, config.projectLedgerRoot ?? "../wakeflow-ledger");

  const trees = [];
  const add = (relPath, absPath, placement, {
    writer = placement.owner,
    gc = placement.lifecycle,
    handEdit,
    description = placement.description,
  } = {}) => {
    trees.push({
      path: relPath,
      category: placement.id,
      class: placement.storageClass,
      owner: placement.owner,
      lifecycle: placement.lifecycle,
      writer,
      gc,
      handEdit,
      description,
      ...statsFor(absPath),
    });
  };

  add(".wakeflow-active", activeDir, placements.activeState, {
    gc: "archive-demand relocates completed roots into the ledger",
    handEdit: "docs yes (controller-maintained); state roots never by hand",
  });
  add(".wakeflow-local/wakeflow-delivery/dispatch-packets", path.join(deliveryDir, "dispatch-packets"), placements.transport, {
    writer: "prepare-dispatch", gc: "wakeflow_prune_runtime", handEdit: "no", description: "Dispatch packets (replay-safe transport).",
  });
  add(".wakeflow-local/wakeflow-delivery/dispatch-groups", path.join(deliveryDir, "dispatch-groups"), placements.transport, {
    writer: "prepare-dispatch", gc: "wakeflow_prune_runtime", handEdit: "no", description: "Dispatch group snapshots.",
  });
  add(".wakeflow-local/wakeflow-delivery/delivery-envelopes", path.join(deliveryDir, "delivery-envelopes"), placements.transport, {
    writer: "prepare/build delivery", gc: "wakeflow_prune_runtime", handEdit: "no", description: "Delivery + controller-return envelopes.",
  });
  add(".wakeflow-local/wakeflow-delivery/delivery-runs", path.join(deliveryDir, "delivery-runs"), placements.transport, {
    writer: "record-delivery-run", gc: "wakeflow_prune_runtime", handEdit: "no", description: "Send/readback observations per delivery attempt.",
  });
  add(".wakeflow-local/wakeflow-delivery/target-results", placements.evidence.path, placements.evidence, {
    writer: "record-target-result", gc: "NEVER deleted by transport GC", handEdit: "no",
  });
  add(".wakeflow-local/wakeflow-delivery/handles", path.join(deliveryDir, "handles"), placements.runtimeHandle, {
    writer: "Wakeflow runtime scans", gc: "regenerated by the owning command", handEdit: "no",
    description: "Regenerable runtime scan handles such as the optional next-work output.",
  });
  add(".wakeflow-local/wakeflow-delivery/locks", path.join(deliveryDir, "locks"), placements.runtimeHandle, {
    writer: "applied delivery preparation / target host send", gc: "released on target result; release-window-lock recovers", handEdit: "only via release-window-lock",
  });
  add(".wakeflow-local/wakeflow-delivery/hosts", placements.hostState.path, placements.hostState, {
    writer: "host helpers", gc: "regenerated on launch/registration", handEdit: "no (regenerable; real session ids live here)",
  });
  add(".wakeflow-local/worktrees", path.join(localDir, "worktrees"), {
    id: "legacy-claude-stream",
    storageClass: "legacy",
    owner: "legacy Claude stream helper",
    lifecycle: "legacy stream-close removes its worktree",
    description: "Legacy stream worktrees only. Current Pods use host-created worktrees and do not store them under Wakeflow runtime.",
  }, { handEdit: "no" });
  add(`.wakeflow-local/${PRESERVED_DIR}`, placements.preserved.path, placements.preserved, {
    writer: "wakeflow-storage preserve + archive-demand --redact", gc: "wakeflow_prune_runtime target=preserved (after retention)", handEdit: "review then delete is fine",
  });
  add(path.relative(workspaceRoot, ledgerRoot).split(path.sep).join("/") || "wakeflow-ledger", ledgerRoot, placements.workspaceRecord, {
    writer: "controller, Design promotion, and Wakeflow archive operations", gc: "none — durable, version-controlled", handEdit: "yes (documents; keep record-map indexed)",
    description: "Durable ledger root containing requirement, goal/stage, workspace, window, and archive records governed by the placement registry.",
  });

  // Legacy residue (report only when present)
  const legacy = [];
  for (const name of LEGACY_LOCAL_TREES) {
    const abs = path.join(localDir, name);
    if (existsSync(abs)) legacy.push({ path: `.wakeflow-local/${name}`, ...statsFor(abs), origin: "pre-convention manual rescue or older runtime" });
  }
  for (const name of LEGACY_DELIVERY_TREES) {
    const abs = path.join(deliveryDir, name);
    if (existsSync(abs)) legacy.push({ path: `.wakeflow-local/wakeflow-delivery/${name}`, ...statsFor(abs), origin: name === "archived-transport" ? "older prune-runtime archived instead of deleting" : "pre-dual-host layout (read fallback only)" });
  }

  // Unknown trees (anything not in the known sets)
  const unknown = [];
  const sweep = (dir, relBase, known) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (known.has(entry.name)) continue;
      unknown.push({ path: `${relBase}/${entry.name}`, ...statsFor(path.join(dir, entry.name)) });
    }
  };
  sweep(localDir, ".wakeflow-local", KNOWN_LOCAL_ENTRIES);
  sweep(deliveryDir, ".wakeflow-local/wakeflow-delivery", KNOWN_DELIVERY_ENTRIES);

  // Preserved entries with manifest + age report
  const preserved = [];
  const preservedRoot = path.join(localDir, PRESERVED_DIR);
  if (existsSync(preservedRoot)) {
    for (const entry of readdirSync(preservedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const abs = path.join(preservedRoot, entry.name);
      preserved.push({
        name: entry.name,
        path: `.wakeflow-local/${PRESERVED_DIR}/${entry.name}`,
        hasManifest: existsSync(path.join(abs, PRESERVED_MANIFEST)),
        ...statsFor(abs),
      });
    }
  }

  const layout = Object.fromEntries(Object.entries(placements).map(([key, placement]) => [key, {
    id: placement.id,
    path: placement.relativePath,
    class: placement.storageClass,
    owner: placement.owner,
    lifecycle: placement.lifecycle,
  }]));
  return { layout, trees, legacy, unknown, preserved };
}

const README_MARKER_START = "<!-- wakeflow:storage-readme:start -->";
const README_MARKER_END = "<!-- wakeflow:storage-readme:end -->";

function wrap(body) {
  return `${README_MARKER_START}\n${body.trim()}\n${README_MARKER_END}\n`;
}

// Short in-place orientation: each answers "what is this / who writes it /
// may I touch it". Regenerated by `wakeflow-storage seed-readmes`; do not
// hand-maintain inside the markers.
export function readmeContents({
  ledgerRel = "../wakeflow-ledger",
  placements = null,
  requirementRel = "requirement-designs",
  goalStageRel = "goal-stage-confirmation",
  workspaceRecordRel = "workspace",
} = {}) {
  const effectiveRequirementRel = placements?.requirement?.relativePath ?? requirementRel;
  const effectiveGoalStageRel = placements?.goalStage?.relativePath ?? goalStageRel;
  const effectiveWorkspaceRecordRel = placements?.workspaceRecord?.relativePath ?? workspaceRecordRel;
  return [
    {
      file: ".wakeflow-active/README.md",
      content: wrap(`# .wakeflow-active/ — active business state (gitignored)

Generated by \`wakeflow-storage seed-readmes\`; do not hand-edit this file.

- **What**: the workspace's ACTIVE layer. \`index.md\` is the single controller
  entry; \`current/\` holds the human docs (status, global TODO board,
  test-exchange) and ONE state-root directory per active demand.
- **Who writes**: the controller maintains the docs; ONLY wakeflow-state
  reducers write state roots (\`wakeflow-state.json\`, events, packages,
  results, candidates). Never edit state-root JSON by hand.
- **Lifecycle**: \`archive-demand\` relocates a completed root into the ledger.
  With \`--redact\`, the ORIGINAL is machine-moved to
  \`.wakeflow-local/preserved/<date>-archive-original-<demand>/\` for audit —
  \`current/\` stays clean without manual moves.
- **May I delete?** Docs are yours (keep \`index.md\` accurate). State roots:
  never by hand — archive them.`),
    },
    {
      file: ".wakeflow-local/README.md",
      content: wrap(`# .wakeflow-local/ — machine-local runtime (NEVER commit)

Generated by \`wakeflow-storage seed-readmes\`; do not hand-edit this file.
Real session/thread ids live only here. One command explains everything:
\`wakeflow_view scope=storage\` (adds size/age/class per tree).

| Entry | What | May I touch? |
| --- | --- | --- |
| \`wakeflow-delivery/\` | delivery transport + host handles (own README inside) | via tools only |
| \`worktrees/\` | legacy Claude stream compatibility only; current Pod worktrees are host-created and live outside Wakeflow runtime | do not create for Pods |
| \`wakeflow.config.json\` | legacy derived stream overlay only; current Pod placement does not write this file | do not hand-edit |
| \`wakeflow-statusline.mjs\` | generated statusline script | no — reseeded |
| \`preserved/<date>-<reason>/\` | canonical audit holds, each with \`MANIFEST.md\` | review, then delete or \`prune-runtime target=preserved\` |

**Rescue convention**: any manual "keep this for audit" move goes to
\`preserved/<YYYY-MM-DD>-<reason>/\` via \`wakeflow-storage preserve\` (writes
the manifest for you). Anything else appearing at this level is flagged
\`unknown-tree\` by \`check-workspace\` — route it to the user; never auto-delete.`),
    },
    {
      file: ".wakeflow-local/wakeflow-delivery/README.md",
      content: wrap(`# wakeflow-delivery/ — delivery transport runtime

Generated by \`wakeflow-storage seed-readmes\`; do not hand-edit this file.

- \`dispatch-packets/ dispatch-groups/ delivery-envelopes/ delivery-runs/\`:
  replay-safe TRANSPORT artifacts. GC: \`wakeflow_prune_runtime\` (dry-run
  first) — never delete by hand.
- \`target-results/\`: EVIDENCE (TargetResultEnvelopes). Never deleted by any
  GC; superseded results move to \`superseded/\`.
- \`locks/<window>.json\`: one in-flight target work lease per target window
  (cross-host). Applied delivery preparation reserves it with the envelope's
  delivery id; target send reuses/revalidates that same lease. Controller-return
  notifications do not take it. Released when the matching target result
  lands; recover a stale one only with \`release-window-lock\` (dry-run first).
- \`stop.json\`: automation stop marker. \`keep-live/\`: keep-live runtime.
- \`hosts/<host>/\`: per-host handles — see its README.`),
    },
    {
      file: ".wakeflow-local/wakeflow-delivery/hosts/README.md",
      content: wrap(`# hosts/<host>/ — per-host session handles

Generated by \`wakeflow-storage seed-readmes\`; do not hand-edit this file.

Everything here is HOST-SCOPED and regenerable — but \`thread-registry/\`
holds the REAL session ids (the only place they may exist; never copy them
into tracked docs, prompts, or backfill).

- \`thread-registry/<window>.json\`: window -> session id (registered once per launch).
- \`window-config/<window>.json\`: derived sendability view (regenerable).
- \`window-host/<window>.json\`: tmux binding (claude edition).
- \`keep-live/\`, \`runtime-meta.json\` (plugin version stamp),
  \`activity-monitor-<server>.pid\` (O_EXCL, owned per --root),
  \`entry-sync-*/deliver-*/pod-entry-*.txt\` (transient prompts),
  \`paste-<window>.lock\` (O_EXCL mutex). The host-neutral
  \`stream-overlay.lock\` sits at \`.wakeflow-local/\` beside the overlay it
  guards — dual-host workspaces mutate ONE overlay under ONE lock.

A dead window resumes from its registered id (\`launch-window --resume\`);
deleting a registry entry orphans that session.`),
    },
    {
      file: `${ledgerRel}/README.md`,
      content: wrap(`# wakeflow-ledger/ — durable records (version-controlled)

Generated by \`wakeflow-storage seed-readmes\`; do not hand-edit this file.

- \`${effectiveWorkspaceRecordRel}/workspace-record-map.md\`: the INDEX — every durable record hangs
  off it. \`${effectiveWorkspaceRecordRel}/pending-merges.md\`: isolation branches awaiting
  human-reviewed merge-back (delete a row once merged/dropped).
- \`${effectiveWorkspaceRecordRel}/archive/<YYYY-MM>/<demand>/\`: archived demand state roots
  (P1-0 redaction-guarded) and archived workspace docs, by month.
- \`${effectiveRequirementRel}/\`: canonical demand definitions, requirement deltas,
  test-environment specifications, and confirmed demand boundaries.
- \`${effectiveGoalStageRel}/\`: goal/stage confirmations and cross-window execution
  decisions. \`<window>/\`: responsibility-specific history only; never put a
  demand definition there.
- Rule: no user absolute paths, API keys, tokens, or real session ids in
  anything committed here.`),
    },
  ];
}

export { README_MARKER_START, README_MARKER_END };
