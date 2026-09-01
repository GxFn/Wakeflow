import { executeTargetResultImportPublicRequest } from "../governance/result/target-result-import-public-coordinator.js";

/** Codex制品固定的TargetResult Import公共composition root。 */
const CODEX_TARGET_RESULT_IMPORT_FACADE = Object.freeze({
  hostId: "codex" as const,
});

/** 使用Codex Host身份导入Implementation或Test Agent Report。 */
export async function executeCodexTargetResultImport(value: unknown) {
  return executeTargetResultImportPublicRequest(
    CODEX_TARGET_RESULT_IMPORT_FACADE,
    value,
  );
}
