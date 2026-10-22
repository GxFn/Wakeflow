import { useDisposableDurability } from "../support/disposable-durability.js";
import { registerScenarioAcceptance } from "./wakeflow-scenario-acceptance.chain.js";

useDisposableDurability();

/** Claude Code 组合：会话宿主、tmux 坐标握手、产品仓库嵌套在工作区根下。 */
registerScenarioAcceptance("claude-code");
