import { useDisposableDurability } from "../support/disposable-durability.js";
import { registerScenarioAcceptance } from "./wakeflow-scenario-acceptance.chain.js";

useDisposableDurability();

/** Codex 组合：项目聊天宿主、产品仓库为工作区的兄弟目录。 */
registerScenarioAcceptance("codex");
