/**
 * Wakeflow Capabilities / Demand：完成与取消前内嵌的 verify 门。
 *
 * 门本身住在治理层 `demand-verify-gates`，`wakeflow_verify{demandId}` 复用同一份（§13.94 D3）；
 * 本切片只把它们接进完成与取消的 preview。
 */
export { evaluateVerifyGates, } from "../../governance/demand/demand-verify-gates.js";
