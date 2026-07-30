import {
  lstatSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

export class WakeflowStatePathError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WakeflowStatePathError";
    this.details = details;
  }
}

/**
 * Build the one state-root boundary shared by delivery/status consumers.
 *
 * Runtime transport remains workspace-owned; this resolver is deliberately
 * only for controller state roots. Besides the workspace itself, callers must
 * explicitly pass configured roots such as workspaceCurrentDir and
 * projectLedgerRoot. Every comparison uses resolved filesystem paths so an
 * in-bound lexical path cannot escape through a symbolic-link ancestor.
 */
export function createSanctionedStateRootResolver({
  workspaceRoot,
  sanctionedRoots = [],
} = {}) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new WakeflowStatePathError("workspace root must be a non-empty path string");
  }
  const workspace = path.resolve(workspaceRoot);
  const allowedRoots = [...new Set([workspace, ...sanctionedRoots]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => projectedRealPath(path.resolve(value))))];

  function resolveStateRoot(value, {
    label = "--state-root",
    requireStateFile = true,
  } = {}) {
    if (typeof value !== "string" || !value.trim()) {
      throw new WakeflowStatePathError(`${label} is required`, { label, value });
    }
    const requested = path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(workspace, value);
    let stat;
    try {
      stat = lstatSync(requested);
    } catch (cause) {
      throw new WakeflowStatePathError(`${label} does not exist: ${value}`, {
        label,
        value,
        requested,
        cause,
      });
    }
    if (stat.isSymbolicLink()) {
      throw new WakeflowStatePathError(`${label} must not be a symbolic link: ${value}`, {
        label,
        value,
        requested,
      });
    }
    if (!stat.isDirectory()) {
      throw new WakeflowStatePathError(`${label} must be a directory: ${value}`, {
        label,
        value,
        requested,
      });
    }

    const resolved = realpathSync(requested);
    if (!allowedRoots.some((root) => pathIsInside(root, resolved))) {
      throw new WakeflowStatePathError(
        `${label} must stay inside a sanctioned state root: ${value}`,
        {
          label,
          value,
          requested,
          resolved,
          allowedRoots,
        },
      );
    }
    if (requireStateFile) {
      resolveStateRootFilePath(resolved, "wakeflow-state.json", {
        label: "controller state",
        requireExisting: true,
      });
    }
    // Preserve the caller-visible lexical spelling (for example macOS /var
    // versus /private/var) after validating its resolved target. State refs
    // are stored relative to the workspace and must not acquire host-specific
    // canonical prefixes merely because the boundary check used realpath.
    return requested;
  }

  return {
    allowedRoots: [...allowedRoots],
    resolveStateRoot,
    resolveStateRootFile(stateRoot, relativePath, options = {}) {
      const resolvedRoot = resolveStateRoot(stateRoot, {
        label: options.stateRootLabel ?? "--state-root",
        requireStateFile: options.requireStateFile ?? true,
      });
      return resolveStateRootFilePath(resolvedRoot, relativePath, options);
    },
  };
}

/**
 * Resolve a state-owned regular file without allowing the relative reference
 * to escape the state root or traverse an existing symbolic link.
 *
 * Missing targets are allowed by default so callers can validate a future
 * write. With requireExisting, the target must already be a regular file.
 * The state root itself must always exist as a real directory.
 */
export function resolveStateRootFilePath(
  stateRoot,
  relativePath,
  {
    label = "state-root file",
    requireExisting = false,
  } = {},
) {
  if (typeof stateRoot !== "string" || !stateRoot.trim()) {
    throw new WakeflowStatePathError("state root must be a non-empty path string", {
      stateRoot,
      label,
    });
  }
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new WakeflowStatePathError(`${label} path must be a non-empty relative path`, {
      stateRoot,
      relativePath,
      label,
    });
  }
  if (path.isAbsolute(relativePath)) {
    throw new WakeflowStatePathError(`${label} path must be relative: ${relativePath}`, {
      stateRoot,
      relativePath,
      label,
    });
  }

  const root = path.resolve(stateRoot);
  const target = path.resolve(root, relativePath);
  const normalizedRelative = path.relative(root, target);
  if (
    !normalizedRelative
    || normalizedRelative === ".."
    || normalizedRelative.startsWith(`..${path.sep}`)
    || path.isAbsolute(normalizedRelative)
  ) {
    throw new WakeflowStatePathError(
      `${label} must resolve to a file below the state root: ${relativePath}`,
      {
        stateRoot: root,
        relativePath,
        resolvedPath: target,
        label,
      },
    );
  }

  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch (cause) {
    throw new WakeflowStatePathError(
      `cannot inspect state root for ${label}: ${cause.message}`,
      {
        stateRoot: root,
        relativePath,
        label,
        cause,
      },
    );
  }
  if (rootStat.isSymbolicLink()) {
    throw new WakeflowStatePathError(
      `state root must not be a symbolic link for ${label}: ${root}`,
      {
        stateRoot: root,
        relativePath,
        label,
      },
    );
  }
  if (!rootStat.isDirectory()) {
    throw new WakeflowStatePathError(
      `state root must be a directory for ${label}: ${root}`,
      {
        stateRoot: root,
        relativePath,
        label,
      },
    );
  }

  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch (cause) {
    throw new WakeflowStatePathError(
      `cannot resolve state root for ${label}: ${cause.message}`,
      {
        stateRoot: root,
        relativePath,
        label,
        cause,
      },
    );
  }

  const segments = normalizedRelative.split(path.sep);
  let current = root;
  let targetExists = true;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    if (!targetExists) continue;

    let stat;
    try {
      stat = lstatSync(current);
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        targetExists = false;
        continue;
      }
      throw new WakeflowStatePathError(
        `cannot inspect ${label} path ${current}: ${cause.message}`,
        {
          stateRoot: root,
          relativePath,
          resolvedPath: target,
          label,
          cause,
        },
      );
    }

    if (stat.isSymbolicLink()) {
      throw new WakeflowStatePathError(
        `${label} path must not cross a symbolic link: ${relativePath}`,
        {
          stateRoot: root,
          relativePath,
          resolvedPath: target,
          symlinkPath: current,
          label,
        },
      );
    }

    const isTarget = index === segments.length - 1;
    if (!isTarget && !stat.isDirectory()) {
      throw new WakeflowStatePathError(
        `${label} ancestor must be a directory: ${current}`,
        {
          stateRoot: root,
          relativePath,
          resolvedPath: target,
          label,
        },
      );
    }
    if (isTarget && !stat.isFile()) {
      throw new WakeflowStatePathError(
        `${label} must be a regular file: ${current}`,
        {
          stateRoot: root,
          relativePath,
          resolvedPath: target,
          label,
        },
      );
    }

    let currentReal;
    try {
      currentReal = realpathSync(current);
    } catch (cause) {
      throw new WakeflowStatePathError(
        `cannot resolve ${label} path ${current}: ${cause.message}`,
        {
          stateRoot: root,
          relativePath,
          resolvedPath: target,
          label,
          cause,
        },
      );
    }
    const realRelative = path.relative(rootReal, currentReal);
    if (
      realRelative === ".."
      || realRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(realRelative)
    ) {
      throw new WakeflowStatePathError(
        `${label} resolves outside the state root: ${relativePath}`,
        {
          stateRoot: root,
          relativePath,
          resolvedPath: target,
          realPath: currentReal,
          label,
        },
      );
    }
  }

  if (!targetExists && requireExisting) {
    throw new WakeflowStatePathError(
      `${label} does not exist: ${target}`,
      {
        stateRoot: root,
        relativePath,
        resolvedPath: target,
        label,
      },
    );
  }

  return target;
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!path.isAbsolute(relative)
      && relative !== ".."
      && !relative.startsWith(`..${path.sep}`));
}

function projectedRealPath(file) {
  const missing = [];
  let current = path.resolve(file);
  while (true) {
    try {
      lstatSync(current);
    } catch (cause) {
      if (!["ENOENT", "ENOTDIR"].includes(cause?.code)) {
        throw new WakeflowStatePathError(
          `cannot resolve sanctioned state root ${file}: ${cause.message}`,
          { file, cause },
        );
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new WakeflowStatePathError(
          `cannot resolve sanctioned state root ${file}`,
          { file, cause },
        );
      }
      missing.unshift(path.basename(current));
      current = parent;
      continue;
    }
    return path.resolve(realpathSync(current), ...missing);
  }
}
