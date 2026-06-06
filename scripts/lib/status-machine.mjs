export const controlStates = {
  draft: { label: "草案", category: "planning" },
  pending: { label: "待启动", category: "sendable" },
  running: { label: "执行中", category: "sendable" },
  delivered: { label: "已投递", category: "sendable" },
  review: { label: "待验收", category: "waiting" },
  blocked: { label: "阻塞", category: "blocked" },
  completed: { label: "已完成", category: "closed" },
  paused: { label: "暂停", category: "closed" },
  cancelled: { label: "取消", category: "closed" },
  rejected: { label: "不做", category: "closed" },
  observing: { label: "观察中", category: "waiting" },
  none: { label: "无任务", category: "closed" },
  idle: { label: "空闲", category: "closed" },
  maintained: { label: "维护中", category: "maintenance" },
  template: { label: "长期模板", category: "maintenance" },
  policy: { label: "长期规则", category: "maintenance" },
  archive: { label: "归档汇总", category: "maintenance" },
};

export const stateAliases = new Map(
  Object.entries(controlStates).flatMap(([id, definition]) => [
    [id, id],
    [definition.label, id],
  ]),
);

stateAliases.set("待确认", "draft");
stateAliases.set("已完成 ", "completed");
stateAliases.set("总控验收通过", "completed");
stateAliases.set("空闲中", "idle");
stateAliases.set("maintained", "maintained");
stateAliases.set("maintenance", "maintained");
stateAliases.set("draft", "draft");

export function displayPrimaryState(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  return text
    .split("/")
    .map((item) => item.trim())
    .find(Boolean)
    ?.replace(/（.*?）|\(.*?\)/g, "")
    .trim() ?? "";
}

export function stateIdFromDisplay(value) {
  const primary = displayPrimaryState(value);
  if (!primary) {
    return null;
  }
  if (stateAliases.has(primary)) {
    return stateAliases.get(primary);
  }
  const prefix = [...stateAliases.keys()]
    .filter((alias) => primary.startsWith(alias))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? stateAliases.get(prefix) : null;
}

export function normalizeStateId(id) {
  const text = String(id ?? "").trim();
  if (!text) {
    return null;
  }
  if (controlStates[text]) {
    return text;
  }
  return stateIdFromDisplay(text);
}

export function stateIdFromText(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const exact = normalizeStateId(text);
  if (exact) {
    return exact;
  }
  const candidates = [
    ...Object.keys(controlStates),
    ...Object.values(controlStates).map((definition) => definition.label),
    ...stateAliases.keys(),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}([^\\p{L}\\p{N}_-]|$)`, "u").test(text)) {
      return normalizeStateId(candidate);
    }
  }
  return null;
}

export function validateStateSpec(spec, label = "state") {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return [`${label} must be an object with an id field`];
  }
  const issues = [];
  const id = normalizeStateId(spec.id);
  if (!id) {
    issues.push(`${label}.id must be one of: ${Object.keys(controlStates).join(", ")}`);
  }
  for (const key of Object.keys(spec)) {
    if (!["id", "note", "reason"].includes(key)) {
      issues.push(`${label} has unsupported key: ${key}`);
    }
  }
  for (const key of ["note", "reason"]) {
    if (spec[key] !== undefined && typeof spec[key] !== "string") {
      issues.push(`${label}.${key} must be a string`);
    }
  }
  return issues;
}

export function renderState(specOrDisplay, fallback = "") {
  if (specOrDisplay && typeof specOrDisplay === "object" && !Array.isArray(specOrDisplay)) {
    const id = normalizeStateId(specOrDisplay.id);
    if (!id) {
      return fallback;
    }
    const note = String(specOrDisplay.note ?? specOrDisplay.reason ?? "").trim();
    return note ? `${controlStates[id].label} / ${note}` : controlStates[id].label;
  }

  const id = normalizeStateId(specOrDisplay);
  if (id) {
    const original = String(specOrDisplay ?? "").trim();
    const primary = displayPrimaryState(original);
    const suffix = original.startsWith(primary) ? original.slice(primary.length).trim() : "";
    return suffix ? `${controlStates[id].label}${suffix.startsWith("/") ? ` ${suffix}` : ` ${suffix}`}` : controlStates[id].label;
  }

  return String(specOrDisplay ?? fallback ?? "").trim();
}

export function isCompletedState(value) {
  return stateIdFromText(value) === "completed";
}

export function isSendEligibleState(value) {
  return ["pending", "running", "delivered"].includes(stateIdFromText(value));
}

export function isNoSendState(value) {
  return ["review", "completed", "paused", "cancelled", "rejected", "observing", "none", "idle"].includes(
    stateIdFromText(value),
  );
}

export function isBlockedState(value) {
  return stateIdFromText(value) === "blocked";
}

export function isPausedLikeState(value) {
  return ["paused", "cancelled", "rejected", "blocked"].includes(stateIdFromText(value));
}

export function validStateLabels() {
  return Object.values(controlStates).map((definition) => definition.label);
}
