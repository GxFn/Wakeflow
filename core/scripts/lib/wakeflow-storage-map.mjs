import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// The storage map is the single source for "what lives where, who writes it,
// and may a human touch it" — consumed by `wakeflow-storage map` (the
// wakeflow_view scope=storage projection), by seed-readmes (the in-place
// README generators), and by the claude-host check-workspace storage section.
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
  "locks",
  "stop.json",
  "keep-live",
  "hosts",
  ...LEGACY_DELIVERY_TREES,
  "README.md",
  ".DS_Store",
]);

export function scanStorage({ workspaceRoot, config = {} }) {
  const localDir = path.join(workspaceRoot, ".wakeflow-local");
  const deliveryDir = path.join(localDir, "wakeflow-delivery");
  const activeDir = path.join(workspaceRoot, ".wakeflow-active");
  const ledgerRoot = path.resolve(workspaceRoot, config.projectLedgerRoot ?? "../wakeflow-ledger");

  const trees = [];
  const add = (relPath, absPath, cls, writer, gc, handEdit, description) => {
    trees.push({ path: relPath, class: cls, writer, gc, handEdit, description, ...statsFor(absPath) });
  };

  add(".wakeflow-active", activeDir, "authority",
    "controller (docs) + wakeflow-state reducers (state roots)",
    "archive-demand relocates completed roots into the ledger",
    "docs yes (controller-maintained); state roots never by hand",
    "Active business state: index.md is the single controller entry; current/ holds the board, status doc, and one state root per active demand.");
  add(".wakeflow-local/wakeflow-delivery/dispatch-packets", path.join(deliveryDir, "dispatch-packets"), "transport",
    "prepare-dispatch", "wakeflow_prune_runtime", "no",
    "Dispatch packets (replay-safe transport).");
  add(".wakeflow-local/wakeflow-delivery/dispatch-groups", path.join(deliveryDir, "dispatch-groups"), "transport",
    "prepare-dispatch", "wakeflow_prune_runtime", "no",
    "Dispatch group snapshots.");
  add(".wakeflow-local/wakeflow-delivery/delivery-envelopes", path.join(deliveryDir, "delivery-envelopes"), "transport",
    "prepare/build delivery", "wakeflow_prune_runtime", "no",
    "Delivery + controller-return envelopes.");
  add(".wakeflow-local/wakeflow-delivery/delivery-runs", path.join(deliveryDir, "delivery-runs"), "transport",
    "record-delivery-run", "wakeflow_prune_runtime", "no",
    "Send/readback evidence per delivery attempt.");
  add(".wakeflow-local/wakeflow-delivery/target-results", path.join(deliveryDir, "target-results"), "evidence",
    "record-target-result", "NEVER deleted by GC", "no",
    "TargetResultEnvelopes — acceptance evidence; prune-runtime always retains them.");
  add(".wakeflow-local/wakeflow-delivery/locks", path.join(deliveryDir, "locks"), "handles",
    "prepare/send", "released on result; release-window-lock recovers", "only via release-window-lock",
    "One in-flight delivery lock per window (cross-host).");
  add(".wakeflow-local/wakeflow-delivery/hosts", path.join(deliveryDir, "hosts"), "handles",
    "host helpers", "regenerated on launch/registration", "no (regenerable; real session ids live here)",
    "Per-host runtime: thread-registry (REAL session ids), window-config, tmux bindings, monitor pidfile, transient prompt/lock files.");
  add(".wakeflow-local/worktrees", path.join(localDir, "worktrees"), "authority",
    "stream-open (git worktree)", "stream-close removes its worktree", "no (git worktrees; close via stream-close)",
    "Isolation worktrees for cross-demand streams (claude edition).");
  add(`.wakeflow-local/${PRESERVED_DIR}`, path.join(localDir, PRESERVED_DIR), "preserved",
    "wakeflow-storage preserve + archive-demand --redact", "wakeflow_prune_runtime target=preserved (after retention)", "review then delete is fine",
    `Canonical audit holds: preserved/<YYYY-MM-DD>-<reason>/ each with ${PRESERVED_MANIFEST} (who/why/source/retention).`);
  add(path.relative(workspaceRoot, ledgerRoot).split(path.sep).join("/") || "wakeflow-ledger", ledgerRoot, "authority",
    "controller (archives, records)", "none — durable, version-controlled", "yes (documents; keep record-map indexed)",
    "Durable ledger: record-map, policies, requirement designs, monthly archive/<YYYY-MM>/<demand>/ trees, pending-merges.");

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

  return { trees, legacy, unknown, preserved };
}

const README_MARKER_START = "<!-- wakeflow:storage-readme:start -->";
const README_MARKER_END = "<!-- wakeflow:storage-readme:end -->";

function wrap(body) {
  return `${README_MARKER_START}\n${body.trim()}\n${README_MARKER_END}\n`;
}

// Short in-place orientation: each answers "what is this / who writes it /
// may I touch it". Regenerated by `wakeflow-storage seed-readmes`; do not
// hand-maintain inside the markers.
export function readmeContents({ ledgerRel = "../wakeflow-ledger" } = {}) {
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
| \`worktrees/<Repo__id>/\` | isolation git worktrees (cross-demand streams) | close via \`stream-close\` |
| \`wakeflow.config.json\` | DERIVED stream overlay (regenerated; \`derived{}\` marker) | no — regenerate via stream ops |
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
- \`locks/<window>.json\`: one in-flight delivery per window (cross-host).
  Released when the matching result lands; recover a stale one only with
  \`release-window-lock\` (dry-run first).
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
  \`paste-<window>.lock\`, \`stream-overlay.lock\` (O_EXCL mutexes).

A dead window resumes from its registered id (\`launch-window --resume\`);
deleting a registry entry orphans that session.`),
    },
    {
      file: `${ledgerRel}/README.md`,
      content: wrap(`# wakeflow-ledger/ — durable records (version-controlled)

Generated by \`wakeflow-storage seed-readmes\`; do not hand-edit this file.

- \`workspace/workspace-record-map.md\`: the INDEX — every durable record hangs
  off it. \`workspace/pending-merges.md\`: isolation branches awaiting
  human-reviewed merge-back (delete a row once merged/dropped).
- \`workspace/archive/<YYYY-MM>/<demand>/\`: archived demand state roots
  (P1-0 redaction-guarded) and archived workspace docs, by month.
- \`requirement-designs/\`, \`goal-stage-confirmation/\`: Design-side durable
  documents. \`<window>/\`: per-window long-term ledgers.
- Rule: no user absolute paths, API keys, tokens, or real session ids in
  anything committed here.`),
    },
  ];
}

export { README_MARKER_START, README_MARKER_END };
