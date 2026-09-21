/**
 * Wakeflow Contracts / Vocabulary：配置文件的身份三元组（ADR-0008 决定 5，TSD-16）。
 *
 * `wakeflow.config.json` 的 `$schema`、`kind` 与 `schemaVersion` 只有这一份权威；公共 Schema
 * 里的三个 `const` 与这里相同。放在词汇层是因为两个不加载校验器的轻读者也要认它：hook
 * 观察脚本按声明拓扑定位工作区（闭包只许 foundation 与 kernel 之下），Claude 状态栏资产是
 * 一段独立执行的脚本文本。配置的版本只由 `schemaVersion` 表达，符号名不带版本后缀。
 */
export const WAKEFLOW_CONFIG_SCHEMA_ID = "urn:wakeflow:config:v1";
export const WAKEFLOW_CONFIG_KIND = "WakeflowConfig";
export const WAKEFLOW_CONFIG_SCHEMA_VERSION = 1;
