/**
 * Wakeflow Contracts / Vocabulary：运行时 Node 引擎范围（open-items A6，§13.167）。
 *
 * 运行时这一侧的声明：Claude 助手脚本在构建时把范围与边界填进 preflight，按它核对当前 node。tooling
 * 有自己的编译根，不能 import 本文件，所以两个插件 `package.json` 的 `engines.node` 与两个 launcher
 * 顶部的守卫读 tooling 的 `PLUGIN_ENGINES_NODE`，根 `package.json` 再声明一次；制品测试核对三处逐字
 * 相同。`Error.isError` 等 Node 24.19 起才有的入口在范围之外会在错误处理路径深处才失败，所以守卫必须
 * 在任何业务代码之前跑。
 */
export const WAKEFLOW_NODE_ENGINES = ">=24.19.0 <25";
const ENGINES_PATTERN = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/u;
/** 解析 `>=A.B.C <D` 形的范围；形状不对即 TypeError。 */
export function parseWakeflowNodeEngineBounds(range = WAKEFLOW_NODE_ENGINES) {
    const match = ENGINES_PATTERN.exec(range);
    if (match === null)
        throw new TypeError("Wakeflow node engines must look like >=A.B.C <D.");
    return Object.freeze({
        minimum: Object.freeze([Number(match[1]), Number(match[2]), Number(match[3])]),
        exclusiveMajor: Number(match[4]),
    });
}
