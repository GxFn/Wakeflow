import { executeTargetResultImportPublicRequest } from "../governance/result/target-result-import-public-coordinator.js";

/** Claude Code制品固定的TargetResult Import公共composition root。 */
const CLAUDE_CODE_TARGET_RESULT_IMPORT_FACADE = Object.freeze({
  hostId: "claude-code" as const,
});

/** 使用Claude Code Host身份导入Implementation或Test Agent Report。 */
export async function executeClaudeCodeTargetResultImport(value: unknown) {
  return executeTargetResultImportPublicRequest(
    CLAUDE_CODE_TARGET_RESULT_IMPORT_FACADE,
    value,
  );
}
