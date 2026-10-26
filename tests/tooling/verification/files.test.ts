/**
 * 第 4 级 tooling 测试：维护工具的公开错误码映射（纯函数，无文件系统）。
 */
import { equal } from "node:assert/strict";
import { test } from "node:test";
import { safeErrorCode } from "../../../tooling/verification/files.js";

test("已是公开 token 的错误码原样保留；没有字符串 code 的错误落到 inspection-unavailable", () => {
  equal(safeErrorCode({ code: "lab-git-unavailable" }), "lab-git-unavailable");
  equal(safeErrorCode({ code: -32001 }), "inspection-unavailable");
  equal(safeErrorCode(new Error("plain")), "inspection-unavailable");
  equal(safeErrorCode(null), "inspection-unavailable");
});

test("MCP 客户端的请求超时报 inspection-timeout，其余大写蛇形码转成 kebab token（W-lab 超时分类）", () => {
  equal(safeErrorCode({ code: "REQUEST_TIMEOUT", name: "SdkError" }), "inspection-timeout");
  equal(safeErrorCode({ code: "CONNECTION_CLOSED" }), "connection-closed");
  equal(safeErrorCode({ code: "not a token!" }), "inspection-unavailable");
});
