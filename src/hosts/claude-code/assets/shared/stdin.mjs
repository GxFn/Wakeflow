// 有界地读 stdin（两个助手共用）：launch 与 resume 从这里读登记检查的结果。

import { readSync } from "node:fs";
import { HelperFailure, refuse } from "./failure.mjs";

export const MAX_STDIN_BYTES = 262144;

function readStdinBytes() {
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  const buffer = Buffer.alloc(65536);
  for (;;) {
    let count = 0;
    try {
      count = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error?.code === "EAGAIN") continue;
      if (error?.code === "EOF") break;
      break;
    }
    if (count === 0) break;
    total += count;
    if (total > MAX_STDIN_BYTES) refuse("stdin-too-large");
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  return Buffer.concat(chunks);
}

/** @returns {string} */
export function readStdinText() {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readStdinBytes());
  } catch (error) {
    if (error instanceof HelperFailure) throw error;
    refuse("stdin-invalid");
  }
}

/** @returns {JsonRecord} */
export function readStdinJson() {
  const text = readStdinText();
  if (text.trim().length === 0) refuse("stdin-empty");
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      refuse("stdin-invalid");
    return parsed;
  } catch (error) {
    if (error instanceof HelperFailure) throw error;
    refuse("stdin-invalid");
  }
}
