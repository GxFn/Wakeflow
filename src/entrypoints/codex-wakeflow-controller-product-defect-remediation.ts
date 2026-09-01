import { executeControllerProductDefectRemediationPublicRequest } from "../governance/review/controller-product-defect-remediation-public-coordinator.js";

/** Codex制品的Controller Product Defect Remediation公共入口。 */
export async function executeCodexControllerProductDefectRemediation(
  value: unknown,
) {
  return executeControllerProductDefectRemediationPublicRequest(value);
}
