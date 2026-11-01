import { useDisposableDurability } from "../support/disposable-durability.js";
import { registerScenarioAcceptance } from "./wakeflow-scenario-acceptance.chain.js";

useDisposableDurability();

/** Claude Code 桌面会话组合（ADR-0025 D8）：同一宿主选 desktop 传输、桌面会话 id 握手、产品仓库嵌套在工作区根下。 */
registerScenarioAcceptance("claude-code-desktop");
