import { executeControllerProductDefectRemediationPublicRequest } from "../governance/review/controller-product-defect-remediation-public-coordinator.js";

/** Claude Code制品的Controller Product Defect Remediation公共入口。 */
export async function executeClaudeCodeControllerProductDefectRemediation(
  value: unknown,
) {
  return executeControllerProductDefectRemediationPublicRequest(value);
}
