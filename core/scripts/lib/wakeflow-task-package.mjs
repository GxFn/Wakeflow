import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const TASK_CONTEXT_VERSION = 1;
export const TASK_WORK_TYPES = ["implementation", "research", "documentation", "test"];
export const TASK_REQUIREMENT_ROLES = ["goal", "completion", "constraint", "validation", "design", "evidence"];
export const TASK_COMMIT_EXPECTATIONS = ["commit", "leave-uncommitted"];

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function stringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array of strings.`);
  }
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

function normalizeRequirementRefs(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("requirementRefs must be a non-empty array.");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`requirementRefs[${index}] must be an object with ref and role.`);
    }
    const ref = nonEmptyString(item.ref, `requirementRefs[${index}].ref`);
    const role = nonEmptyString(item.role, `requirementRefs[${index}].role`);
    if (!TASK_REQUIREMENT_ROLES.includes(role)) {
      throw new Error(`requirementRefs[${index}].role must be one of: ${TASK_REQUIREMENT_ROLES.join(", ")}.`);
    }
    return {
      ref,
      role,
      ...(typeof item.label === "string" && item.label.trim() ? { label: item.label.trim() } : {}),
    };
  });
}

function normalizeBoundaries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("boundaries must be an object with inScope, outOfScope, and forbidden arrays.");
  }
  return {
    inScope: stringList(value.inScope, "boundaries.inScope"),
    outOfScope: stringList(value.outOfScope ?? [], "boundaries.outOfScope", { allowEmpty: true }),
    forbidden: stringList(value.forbidden ?? [], "boundaries.forbidden", { allowEmpty: true }),
  };
}

export function hasTaskPackageContext(value) {
  return Number(value?.contextVersion ?? 0) === TASK_CONTEXT_VERSION;
}

export function normalizeTaskPackageContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("task package context must be an object.");
  }
  const contextVersion = Number(value.contextVersion ?? TASK_CONTEXT_VERSION);
  if (contextVersion !== TASK_CONTEXT_VERSION) {
    throw new Error(`contextVersion must be ${TASK_CONTEXT_VERSION}.`);
  }
  const workType = nonEmptyString(value.workType, "workType");
  if (!TASK_WORK_TYPES.includes(workType)) {
    throw new Error(`workType must be one of: ${TASK_WORK_TYPES.join(", ")}.`);
  }
  const commitExpectation = nonEmptyString(value.commitExpectation, "commitExpectation");
  if (!TASK_COMMIT_EXPECTATIONS.includes(commitExpectation)) {
    throw new Error(`commitExpectation must be one of: ${TASK_COMMIT_EXPECTATIONS.join(", ")}.`);
  }
  if (workType === "implementation" && (!Array.isArray(value.acceptanceAnchors) || value.acceptanceAnchors.length === 0)) {
    throw new Error("implementation task packages require at least one controller-authored acceptanceAnchor.");
  }
  return {
    contextVersion,
    workType,
    objective: nonEmptyString(value.objective, "objective"),
    contextSummary: stringList(value.contextSummary, "contextSummary"),
    requirementRefs: normalizeRequirementRefs(value.requirementRefs),
    boundaries: normalizeBoundaries(value.boundaries),
    completionExpectations: stringList(value.completionExpectations, "completionExpectations"),
    dependsOnTaskIds: stringList(value.dependsOnTaskIds ?? [], "dependsOnTaskIds", { allowEmpty: true }),
    commitExpectation,
  };
}

function markdownAnchor(text) {
  return decodeURIComponent(String(text ?? ""))
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requirementRefIssue(workspaceRoot, entry) {
  if (/^[a-z]+:\/\//i.test(entry.ref)) {
    return `requirement reference must be a workspace-local file, not a URL: ${entry.ref}`;
  }
  const marker = entry.ref.indexOf("#");
  const fileRef = marker >= 0 ? entry.ref.slice(0, marker) : entry.ref;
  const fragment = marker >= 0 ? entry.ref.slice(marker + 1) : "";
  if (!fileRef) return `requirement reference has no file path: ${entry.ref}`;
  if (path.isAbsolute(fileRef)) {
    return `requirement reference must be workspace-relative so state roots remain portable: ${entry.ref}`;
  }
  if (entry.role !== "evidence" && !fragment) {
    return `requirement reference role=${entry.role} must name a document section with #anchor: ${entry.ref}`;
  }
  const file = path.resolve(workspaceRoot, fileRef);
  if (!existsSync(file)) return `requirement reference does not exist: ${entry.ref}`;
  if (!fragment) return null;
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    return `requirement reference is unreadable: ${entry.ref} (${error.message})`;
  }
  const expected = markdownAnchor(fragment);
  const headings = content
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1])
    .filter(Boolean)
    .map(markdownAnchor);
  return headings.includes(expected)
    ? null
    : `requirement reference section was not found: ${entry.ref}`;
}

export function taskPackageAuthoritySnapshot(taskPackage = {}) {
  return {
    taskPackageId: taskPackage.taskPackageId,
    demandKey: taskPackage.demandKey,
    summary: taskPackage.summary,
    sourceRef: taskPackage.sourceRef ?? null,
    contextVersion: taskPackage.contextVersion ?? null,
    workType: taskPackage.workType ?? null,
    objective: taskPackage.objective ?? null,
    contextSummary: taskPackage.contextSummary ?? [],
    requirementRefs: taskPackage.requirementRefs ?? [],
    boundaries: taskPackage.boundaries ?? null,
    completionExpectations: taskPackage.completionExpectations ?? [],
    dependsOnTaskIds: taskPackage.dependsOnTaskIds ?? [],
    commitExpectation: taskPackage.commitExpectation ?? null,
    designIntent: taskPackage.designIntent ?? null,
    acceptanceAnchors: taskPackage.acceptanceAnchors ?? [],
    evidenceContract: taskPackage.evidenceContract ?? null,
    testExecution: taskPackage.testExecution ?? null,
    continuation: taskPackage.continuation ?? null,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

export function taskPackageDigest(taskPackage) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(taskPackageAuthoritySnapshot(taskPackage))))
    .digest("hex");
}

export function taskPackageReadiness({
  taskPackage,
  state,
  targetTask,
  workspaceRoot,
  repositoryRoot = "",
}) {
  const errors = [];
  const warnings = [];
  let context = null;
  if (!hasTaskPackageContext(taskPackage)) {
    warnings.push("legacy task package: full pre-dispatch context was not recorded; preserve compatibility but do not use this shape for new MCP-created work.");
  } else {
    try {
      context = normalizeTaskPackageContext(taskPackage);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (context) {
    for (const entry of context.requirementRefs) {
      const issue = requirementRefIssue(workspaceRoot, entry);
      if (issue) errors.push(issue);
    }
    if (new Set(context.dependsOnTaskIds).size !== context.dependsOnTaskIds.length) {
      errors.push("dependsOnTaskIds must not contain duplicates.");
    }
    if (context.dependsOnTaskIds.includes(targetTask?.targetTaskId)) {
      errors.push(`task ${targetTask?.targetTaskId} cannot depend on itself.`);
    }
    for (const dependencyId of context.dependsOnTaskIds) {
      const dependency = (state?.targetTasks ?? []).find((item) => item.targetTaskId === dependencyId);
      if (!dependency) {
        errors.push(`dependency target task does not exist: ${dependencyId}`);
      } else if (dependency.status !== "accepted") {
        errors.push(`dependency target task is not accepted: ${dependencyId}:${dependency.status || "unknown"}`);
      }
    }
    const isTestTask = Boolean(taskPackage.testExecution);
    if (context.workType === "test" && !isTestTask) {
      errors.push("workType=test requires an authoritative testExecution contract.");
    }
    if (context.workType !== "test" && isTestTask) {
      errors.push(`task package with testExecution must use workType=test, not ${context.workType}.`);
    }
  }
  if (context && !repositoryRoot) {
    errors.push("configured target repository root is missing; bind the target window to a real repository before dispatch.");
  } else if (repositoryRoot && !existsSync(repositoryRoot)) {
    const issue = `configured target repository root does not exist: ${repositoryRoot}`;
    if (context) {
      errors.push(issue);
    } else {
      warnings.push(`${issue}; legacy compatibility allows preview, but new full-context packages fail closed.`);
    }
  }
  const requiredSkills = [
    "skills/wakeflow-target/SKILL.md",
    ...((context?.workType === "implementation"
      || (taskPackage.acceptanceAnchors ?? []).length > 0
      || taskPackage.evidenceContract)
      ? ["skills/wakeflow-target-craft/SKILL.md"]
      : []),
    ...((taskPackage.testExecution?.allowedSkills ?? []).filter((item) => typeof item === "string" && item.trim())),
  ];
  return {
    ready: errors.length === 0,
    mode: context ? "full-context" : "legacy-compatible",
    errors,
    warnings,
    requiredSkills: [...new Set(requiredSkills)],
    taskPackageDigest: taskPackageDigest(taskPackage),
  };
}

export function buildTaskBriefing({
  taskPackage,
  targetTask,
  stateRoot,
  workspaceRoot,
  repositoryRoot = "",
  readiness,
}) {
  const context = hasTaskPackageContext(taskPackage)
    ? normalizeTaskPackageContext(taskPackage)
    : null;
  const taskPackageRef = path.join(
    stateRoot,
    "task-packages",
    `${String(taskPackage.taskPackageId).replace(/[^A-Za-z0-9._-]+/g, "-")}.json`,
  );
  const requirementRefs = context?.requirementRefs ?? (taskPackage.sourceRef
    ? [{ ref: taskPackage.sourceRef, role: "evidence" }]
    : []);
  return {
    mode: readiness.mode,
    targetWindow: targetTask.targetWindow,
    targetTaskId: targetTask.targetTaskId,
    taskPackageId: taskPackage.taskPackageId,
    objective: context?.objective || targetTask.summary || taskPackage.summary || `Complete ${targetTask.targetTaskId}.`,
    contextSummary: context?.contextSummary ?? [],
    requirementRefs: requirementRefs.map((entry) => {
      const marker = entry.ref.indexOf("#");
      const fileRef = marker >= 0 ? entry.ref.slice(0, marker) : entry.ref;
      const fragment = marker >= 0 ? entry.ref.slice(marker) : "";
      return {
        ...entry,
        resolvedRef: /^[a-z][a-z0-9+.-]*:/i.test(fileRef)
          ? entry.ref
          : path.isAbsolute(fileRef)
            ? `${fileRef}${fragment}`
            : `${path.resolve(workspaceRoot, fileRef)}${fragment}`,
      };
    }),
    boundaries: context?.boundaries ?? {
      inScope: [targetTask.summary || taskPackage.summary || targetTask.targetTaskId],
      outOfScope: [],
      forbidden: [],
    },
    completionExpectations: context?.completionExpectations ?? [],
    dependsOnTaskIds: context?.dependsOnTaskIds ?? [],
    commitExpectation: context?.commitExpectation ?? null,
    acceptanceAnchors: taskPackage.acceptanceAnchors ?? [],
    requiredSkills: readiness.requiredSkills,
    workspaceRoot,
    repositoryRoot: repositoryRoot || null,
    stateRoot,
    taskPackageRef,
    taskPackageDigest: readiness.taskPackageDigest,
  };
}
