import { createHash } from "node:crypto";

import { requirementRefIssue } from "./wakeflow-task-package.mjs";

export const DEMAND_AUTHORITY_SCHEMA_VERSION = 1;
export const DEMAND_AUTHORITY_FILE = "demand-authority.json";
export const DEMAND_TYPES = Object.freeze(["requirement", "bug", "supplement", "research"]);
export const DEMAND_AUTHORITY_ENTRY_MODES = Object.freeze([
  "design-delivery",
  "controller-inline",
  "pod-design",
]);
export const DEMAND_AUTHORITY_REF_ROLES = Object.freeze([
  "original-plan",
  "requirement-design",
  "code-facts",
  "landing-plan",
  "non-goals",
  "user-confirmation",
  "reproduction",
  "scope",
  "requirement-delta",
  "research-question",
  "boundaries",
  "test-environment",
]);
export const DEMAND_TEST_MODES = Object.freeze([
  "controller-only",
  "real-environment",
  "not-applicable",
]);

const REQUIRED_ROLES = Object.freeze({
  requirement: [
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
  ],
  bug: ["reproduction", "scope", "non-goals"],
  supplement: ["requirement-design", "requirement-delta", "user-confirmation"],
  research: ["research-question", "boundaries"],
});

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

export function demandAuthorityDigest(authority) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(authority)))
    .digest("hex");
}

export function normalizeDemandAuthority(value, {
  demandKey = null,
  entryMode = null,
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("demandAuthority must be an object.");
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== DEMAND_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`demandAuthority.schemaVersion must be ${DEMAND_AUTHORITY_SCHEMA_VERSION}.`);
  }
  if (value.artifactKind !== undefined && value.artifactKind !== "wakeflow-demand-authority") {
    throw new Error("demandAuthority.artifactKind must be wakeflow-demand-authority.");
  }
  const normalizedDemandKey = nonEmptyString(
    value.demandKey ?? demandKey,
    "demandAuthority.demandKey",
  );
  if (demandKey && normalizedDemandKey !== demandKey) {
    throw new Error(`demandAuthority.demandKey must equal ${demandKey}.`);
  }
  const demandType = nonEmptyString(value.demandType, "demandAuthority.demandType");
  if (!DEMAND_TYPES.includes(demandType)) {
    throw new Error(`demandAuthority.demandType must be one of: ${DEMAND_TYPES.join(", ")}.`);
  }
  const normalizedEntryMode = nonEmptyString(
    value.entryMode ?? entryMode,
    "demandAuthority.entryMode",
  );
  if (!DEMAND_AUTHORITY_ENTRY_MODES.includes(normalizedEntryMode)) {
    throw new Error(
      `demandAuthority.entryMode must be one of: ${DEMAND_AUTHORITY_ENTRY_MODES.join(", ")}.`,
    );
  }
  if (entryMode && normalizedEntryMode !== entryMode) {
    throw new Error(`demandAuthority.entryMode must equal ${entryMode}.`);
  }
  if (!Array.isArray(value.authorityRefs) || value.authorityRefs.length === 0) {
    throw new Error("demandAuthority.authorityRefs must be a non-empty array.");
  }
  const authorityRefs = value.authorityRefs.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`demandAuthority.authorityRefs[${index}] must be an object.`);
    }
    const role = nonEmptyString(item.role, `demandAuthority.authorityRefs[${index}].role`);
    if (!DEMAND_AUTHORITY_REF_ROLES.includes(role)) {
      throw new Error(
        `demandAuthority.authorityRefs[${index}].role must be one of: ${DEMAND_AUTHORITY_REF_ROLES.join(", ")}.`,
      );
    }
    return {
      role,
      ref: nonEmptyString(item.ref, `demandAuthority.authorityRefs[${index}].ref`),
    };
  });
  const duplicate = authorityRefs.find((entry, index) => (
    authorityRefs.findIndex((candidate) => candidate.role === entry.role && candidate.ref === entry.ref) !== index
  ));
  if (duplicate) {
    throw new Error(`demandAuthority.authorityRefs contains duplicate ${duplicate.role}:${duplicate.ref}.`);
  }
  if (!value.testDecision || typeof value.testDecision !== "object" || Array.isArray(value.testDecision)) {
    throw new Error("demandAuthority.testDecision must be an object.");
  }
  const mode = nonEmptyString(value.testDecision.mode, "demandAuthority.testDecision.mode");
  if (!DEMAND_TEST_MODES.includes(mode)) {
    throw new Error(`demandAuthority.testDecision.mode must be one of: ${DEMAND_TEST_MODES.join(", ")}.`);
  }
  const testDecision = {
    mode,
    summary: nonEmptyString(value.testDecision.summary, "demandAuthority.testDecision.summary"),
    ...(typeof value.testDecision.environmentSpecRef === "string"
      && value.testDecision.environmentSpecRef.trim()
      ? { environmentSpecRef: value.testDecision.environmentSpecRef.trim() }
      : {}),
  };
  return {
    schemaVersion: DEMAND_AUTHORITY_SCHEMA_VERSION,
    artifactKind: "wakeflow-demand-authority",
    demandKey: normalizedDemandKey,
    demandType,
    entryMode: normalizedEntryMode,
    authorityRefs,
    testDecision,
  };
}

export function demandAuthorityReadiness(authority, {
  workspaceRoot = null,
  demandKey = null,
  demandType = null,
  entryMode = null,
  expectedDigest = null,
} = {}) {
  const errors = [];
  let normalized = null;
  try {
    normalized = normalizeDemandAuthority(authority, { demandKey, entryMode });
  } catch (error) {
    errors.push(error.message);
    return { ready: false, errors, authority: null, digest: null };
  }

  if (demandType && normalized.demandType !== demandType) {
    errors.push(`demandAuthority.demandType must equal ${demandType}.`);
  }

  const availableRoles = new Set(normalized.authorityRefs.map((entry) => entry.role));
  for (const role of REQUIRED_ROLES[normalized.demandType] ?? []) {
    if (!availableRoles.has(role)) errors.push(`${normalized.demandType} authority requires role=${role}.`);
  }
  if (normalized.demandType === "research" && normalized.testDecision.mode !== "not-applicable") {
    errors.push("research authority requires testDecision.mode=not-applicable.");
  }
  if (normalized.demandType !== "research" && normalized.testDecision.mode === "not-applicable") {
    errors.push(`${normalized.demandType} authority requires a real testing decision, not not-applicable.`);
  }
  if (normalized.testDecision.mode === "real-environment") {
    if (!normalized.testDecision.environmentSpecRef) {
      errors.push("real-environment testing requires testDecision.environmentSpecRef.");
    }
    if (!availableRoles.has("test-environment")) {
      errors.push("real-environment testing requires role=test-environment.");
    }
    if (
      normalized.testDecision.environmentSpecRef
      && !normalized.authorityRefs.some((entry) => (
        entry.role === "test-environment"
        && entry.ref === normalized.testDecision.environmentSpecRef
      ))
    ) {
      errors.push("testDecision.environmentSpecRef must match a role=test-environment authority ref.");
    }
  } else if (normalized.testDecision.environmentSpecRef) {
    errors.push("testDecision.environmentSpecRef is valid only for mode=real-environment.");
  }

  if (workspaceRoot) {
    for (const entry of normalized.authorityRefs) {
      const issue = requirementRefIssue(workspaceRoot, entry);
      if (issue) errors.push(issue.replace(/^requirement reference/u, "demand authority reference"));
    }
  }

  const digest = demandAuthorityDigest(normalized);
  if (expectedDigest && digest !== expectedDigest) {
    errors.push(`demandAuthority digest must equal the frozen state digest ${expectedDigest}.`);
  }

  return {
    ready: errors.length === 0,
    errors,
    authority: normalized,
    digest,
  };
}

export function assertDemandAuthorityReady(value, options = {}) {
  const readiness = demandAuthorityReadiness(value, options);
  if (!readiness.ready) {
    throw new Error(`demand authority is incomplete:\n- ${readiness.errors.join("\n- ")}`);
  }
  return readiness;
}
