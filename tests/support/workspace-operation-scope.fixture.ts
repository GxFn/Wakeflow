import { mkdirSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_LOCKS_ROOT_REF } from "../../src/kernel/workspace-locks.js";

/**
 * Fixture bootstrap occurs before any command or child process can use the workspace: the lock
 * directory is what a maintenance bootstrap leaves behind, and its presence admits operations.
 */
export function materializeFixtureOperationScope(workspace: string): void {
  mkdirSync(path.join(workspace, WORKSPACE_LOCKS_ROOT_REF), { recursive: true, mode: 0o700 });
}
