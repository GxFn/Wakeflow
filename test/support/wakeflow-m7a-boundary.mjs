import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

const MAX_MODULE_SOURCE_BYTES = 2 * 1024 * 1024;

export const WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS = Object.freeze([
  "lib/wakeflow-runtime.mjs",
  "lib/wakeflow-trace.mjs",
  "scripts/lib/wakeflow-active-demands.mjs",
  "scripts/lib/wakeflow-artifact-identity.mjs",
  "scripts/lib/wakeflow-config.mjs",
  "scripts/lib/wakeflow-controller-events.mjs",
  "scripts/lib/wakeflow-controller-return.mjs",
  "scripts/lib/wakeflow-delivery-evidence.mjs",
  "scripts/lib/wakeflow-delivery-run-recording-command.mjs",
  "scripts/lib/wakeflow-delivery-status-command.mjs",
  "scripts/lib/wakeflow-delivery-store.mjs",
  "scripts/lib/wakeflow-demand-authority.mjs",
  "scripts/lib/wakeflow-dispatch-commands.mjs",
  "scripts/lib/wakeflow-dispatch-group-review.mjs",
  "scripts/lib/wakeflow-document-placement.mjs",
  "scripts/lib/wakeflow-idempotency.mjs",
  "scripts/lib/wakeflow-keep-live.mjs",
  "scripts/lib/wakeflow-language.mjs",
  "scripts/lib/wakeflow-legacy-local-result-recording-command.mjs",
  "scripts/lib/wakeflow-mainline-health.mjs",
  "scripts/lib/wakeflow-pod-reservations.mjs",
  "scripts/lib/wakeflow-pod-runtime.mjs",
  "scripts/lib/wakeflow-progress-appends.mjs",
  "scripts/lib/wakeflow-redaction.mjs",
  "scripts/lib/wakeflow-result-contract.mjs",
  "scripts/lib/wakeflow-result-recording-commands.mjs",
  "scripts/lib/wakeflow-return-policy.mjs",
  "scripts/lib/wakeflow-review-commands.mjs",
  "scripts/lib/wakeflow-review-pack.mjs",
  "scripts/lib/wakeflow-review-scope.mjs",
  "scripts/lib/wakeflow-runtime-summary.mjs",
  "scripts/lib/wakeflow-state-paths.mjs",
  "scripts/lib/wakeflow-state-results.mjs",
  "scripts/lib/wakeflow-state-transition.mjs",
  "scripts/lib/wakeflow-status-machine.mjs",
  "scripts/lib/wakeflow-storage-map.mjs",
  "scripts/lib/wakeflow-stream-overlay.mjs",
  "scripts/lib/wakeflow-task-package.mjs",
  "scripts/lib/wakeflow-thread-registry.mjs",
  "scripts/lib/wakeflow-trace-spine-command.mjs",
  "scripts/lib/wakeflow-window-runtime.mjs",
  "scripts/lib/wakeflow-workspace-projection.mjs",
  "scripts/verify-workspace-docs.mjs",
  "scripts/wakeflow-archive-docs.mjs",
  "scripts/wakeflow-archive-summaries.mjs",
  "scripts/wakeflow-archive-todo.mjs",
  "scripts/wakeflow-check-boundary.mjs",
  "scripts/wakeflow-check-layout.mjs",
  "scripts/wakeflow-check-repository-residue.mjs",
  "scripts/wakeflow-check-runtime.mjs",
  "scripts/wakeflow-check-scripts.mjs",
  "scripts/wakeflow-delivery.mjs",
  "scripts/wakeflow-demand-sequence.mjs",
  "scripts/wakeflow-intake.mjs",
  "scripts/wakeflow-next-work.mjs",
  "scripts/wakeflow-pod.mjs",
  "scripts/wakeflow-render-progress.mjs",
  "scripts/wakeflow-repo-status.mjs",
  "scripts/wakeflow-runtime.mjs",
  "scripts/wakeflow-state.mjs",
  "scripts/wakeflow-storage.mjs",
  "scripts/wakeflow-todo.mjs",
  "scripts/wakeflow-verify.mjs",
]);

export const WAKEFLOW_MIGRATION_PARSER_PATHS = Object.freeze([
  "scripts/lib/wakeflow-legacy-archive-transform.mjs",
  "scripts/lib/wakeflow-legacy-classifier.mjs",
  "scripts/lib/wakeflow-legacy-owner-drain.mjs",
  "scripts/lib/wakeflow-migration-apply.mjs",
  "scripts/lib/wakeflow-migration-config-owner.mjs",
  "scripts/lib/wakeflow-migration-host-decommission.mjs",
  "scripts/lib/wakeflow-migration-inventory.mjs",
  "scripts/lib/wakeflow-migration-plan.mjs",
  "scripts/lib/wakeflow-migration-production.mjs",
]);

export const WAKEFLOW_BOOTSTRAP_CLOSURE_PATHS = Object.freeze(
  WAKEFLOW_MIGRATION_PARSER_PATHS.filter((relativePath) => (
    relativePath !== "scripts/lib/wakeflow-legacy-archive-transform.mjs"
  )),
);

export const WAKEFLOW_NORMAL_ROOTS = Object.freeze([
  "lib/wakeflow-mcp-tools.mjs",
  "scripts/wakeflow-cli.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-validate.mjs",
  "scripts/lib/wakeflow-host-profile.mjs",
]);

export const WAKEFLOW_HOST_NORMAL_ROOTS = Object.freeze({
  codex: Object.freeze([
    "scripts/lib/wakeflow-codex-activation-scope.mjs",
    "scripts/lib/wakeflow-codex-decommission.mjs",
    "scripts/lib/wakeflow-codex-pod-host.mjs",
  ]),
  claude: Object.freeze([
    "scripts/lib/wakeflow-claude-activation-scope.mjs",
    "scripts/lib/wakeflow-claude-activity.mjs",
    "scripts/lib/wakeflow-claude-decommission.mjs",
    "scripts/lib/wakeflow-claude-host.mjs",
    "scripts/lib/wakeflow-claude-lifecycle.mjs",
    "scripts/lib/wakeflow-claude-locator.mjs",
    "scripts/lib/wakeflow-claude-pod-host.mjs",
    "scripts/lib/wakeflow-claude-settings.mjs",
    "scripts/lib/wakeflow-claude-transport.mjs",
  ]),
});

function slash(value) {
  return value.split(path.sep).join("/");
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizedRelativeRoot(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\0")
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function sourceIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(":");
}

// 读取导入图源文件时，不跟随最终符号链接，并把大小与读取前后身份绑定起来。
// 这是测试证据的物理准入边界；它不承担 JavaScript 解析或运行时加载职责。
function readAdmittedModuleSource(file) {
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw new Error("module source must be one single-link regular file");
    }
    if (before.size > BigInt(MAX_MODULE_SOURCE_BYTES)) {
      throw new Error(`module source exceeds ${MAX_MODULE_SOURCE_BYTES} bytes`);
    }
    const source = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor, { bigint: true });
    if (sourceIdentity(before) !== sourceIdentity(after)) {
      throw new Error("module source changed while it was being inspected");
    }
    return source;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function moduleSpecifiers(source) {
  const values = [];
  const staticPattern = /\b(?:import|export)\s+(?:[^"'();]+?\s+from\s+)?["']([^"']+)["']/gsu;
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const pattern of [staticPattern, dynamicPattern, requirePattern]) {
    for (const match of source.matchAll(pattern)) values.push(match[1]);
  }
  return [...new Set(values)].sort();
}

function resolveLocalModule(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const target = path.resolve(path.dirname(fromFile), specifier);
  const candidates = path.extname(target)
    ? [target]
    : [target, `${target}.mjs`, `${target}.js`, `${target}.cjs`, path.join(target, "index.mjs")];
  for (const candidate of candidates) {
    let stat;
    try {
      stat = lstatSync(candidate);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
      throw error;
    }
    if (stat.isFile() || stat.isSymbolicLink() || !stat.isDirectory()) return candidate;
  }
  return target;
}

export function inspectLiteralModuleGraph({ artifactRoot, roots }) {
  if (typeof artifactRoot !== "string" || !path.isAbsolute(artifactRoot) || path.resolve(artifactRoot) !== artifactRoot) {
    throw new TypeError("artifactRoot must be one normalized absolute path");
  }
  const rootStat = lstatSync(artifactRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new TypeError("artifactRoot must name one real directory");
  }
  if (!Array.isArray(roots) || roots.length === 0 || roots.some((relativePath) => !normalizedRelativeRoot(relativePath))) {
    throw new TypeError("roots must be non-empty safe artifact-relative refs");
  }
  if (new Set(roots).size !== roots.length) {
    throw new TypeError("roots must not contain duplicate refs");
  }

  const absoluteRoot = realpathSync(artifactRoot);
  const pending = roots.map((relativePath) => path.resolve(absoluteRoot, ...relativePath.split("/")));
  const visited = new Set();
  const edges = [];
  const missingRoots = [];
  const boundaryViolations = [];

  for (const root of pending) {
    if (!existsSync(root)) {
      missingRoots.push(slash(path.relative(absoluteRoot, root)));
      continue;
    }
    const stat = lstatSync(root);
    if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(root) !== root) {
      boundaryViolations.push(Object.freeze({
        from: null,
        reason: stat.isSymbolicLink() ? "root-symbolic-link" : "root-not-real-file",
        specifier: null,
        to: slash(path.relative(absoluteRoot, root)),
      }));
    }
  }

  while (pending.length > 0) {
    const file = pending.shift();
    if (visited.has(file) || !existsSync(file)) continue;
    const relativeFile = slash(path.relative(absoluteRoot, file));
    const fileStat = lstatSync(file);
    if (
      !isWithinRoot(absoluteRoot, file)
      || fileStat.isSymbolicLink()
      || !fileStat.isFile()
      || realpathSync(file) !== file
    ) {
      boundaryViolations.push(Object.freeze({
        from: null,
        reason: !isWithinRoot(absoluteRoot, file)
          ? "module-escaped-artifact"
          : fileStat.isSymbolicLink()
            ? "module-symbolic-link"
            : "module-not-real-file",
        specifier: null,
        to: relativeFile,
      }));
      continue;
    }
    visited.add(file);
    const source = readAdmittedModuleSource(file);
    for (const specifier of moduleSpecifiers(source)) {
      const target = resolveLocalModule(file, specifier);
      if (target === null) continue;
      const from = slash(path.relative(absoluteRoot, file));
      const to = slash(path.relative(absoluteRoot, target));
      const exists = existsSync(target);
      let admitted = false;
      let violationReason = null;
      if (!isWithinRoot(absoluteRoot, target)) {
        violationReason = "import-escaped-artifact";
      } else if (exists) {
        const targetStat = lstatSync(target);
        if (targetStat.isSymbolicLink()) violationReason = "import-symbolic-link";
        else if (!targetStat.isFile() || realpathSync(target) !== target) violationReason = "import-not-real-file";
        else admitted = true;
      }
      edges.push(Object.freeze({ admitted, exists, from, specifier, to }));
      if (violationReason !== null) {
        boundaryViolations.push(Object.freeze({ from, reason: violationReason, specifier, to }));
      }
      if (admitted && !visited.has(target)) pending.push(target);
    }
  }

  return Object.freeze({
    boundaryViolations: Object.freeze(boundaryViolations.sort((left, right) => (
      String(left.from).localeCompare(String(right.from))
      || left.to.localeCompare(right.to)
      || String(left.specifier).localeCompare(String(right.specifier))
    ))),
    edges: Object.freeze(edges.sort((left, right) => (
      left.from.localeCompare(right.from)
      || left.to.localeCompare(right.to)
      || left.specifier.localeCompare(right.specifier)
    ))),
    missingRoots: Object.freeze(missingRoots.sort()),
    visited: Object.freeze([...visited].map((file) => slash(path.relative(absoluteRoot, file))).sort()),
  });
}
