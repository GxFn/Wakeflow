export const supportedInterfaceLanguages = ["auto", "zh", "en"];

export function normalizeInterfaceLanguage(value, fallback = "auto") {
  const raw = String(value ?? fallback ?? "auto").trim().toLowerCase();
  if (raw === "zh" || raw === "zh-cn" || raw === "zh_cn" || raw === "zh-hans" || raw === "chinese") {
    return "zh";
  }
  if (raw === "en" || raw === "en-us" || raw === "en_us" || raw === "english") {
    return "en";
  }
  if (raw === "auto") return "auto";
  return null;
}

export function detectInterfaceLanguage({ requested = "auto", env = process.env } = {}) {
  const normalized = normalizeInterfaceLanguage(requested);
  if (normalized === "zh" || normalized === "en") return normalized;
  if (normalized !== "auto") return null;

  const envLanguage = [
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANGUAGE,
    env.LANG,
  ].filter(Boolean).join(" ");
  return /zh|cn|chinese/i.test(envLanguage) ? "zh" : "en";
}

export function localizedTemplateName(name, language) {
  if (language !== "zh") return name;
  if (name.endsWith(".template.md")) {
    return name.replace(/\.template\.md$/, ".zh-CN.template.md");
  }
  const dot = name.lastIndexOf(".");
  if (dot < 0) return `${name}.zh-CN`;
  return `${name.slice(0, dot)}.zh-CN${name.slice(dot)}`;
}

export function wakeflowStateLocale(language) {
  if (language === "zh") {
    return {
      none: "无",
      automationDisabled: "未启用",
      automationEnabled: "已启用",
      defaultGoal: "由总控判断补充。",
      defaultCompletionDefinition: "由总控判断补充。",
      defaultStagePlan: "由总控判断补充。",
      initialNextAction: "由总控判断定义阶段和任务包。",
      staleNextAction: "复核状态变化并选择下一步总控动作。",
    };
  }

  return {
    none: "none",
    automationDisabled: "disabled",
    automationEnabled: "enabled",
    defaultGoal: "TBD by total-control judgment.",
    defaultCompletionDefinition: "TBD by total-control judgment.",
    defaultStagePlan: "TBD by total-control judgment.",
    initialNextAction: "Define stages and task packages by total-control judgment.",
    staleNextAction: "Review state changes and choose the next total-control action.",
  };
}
