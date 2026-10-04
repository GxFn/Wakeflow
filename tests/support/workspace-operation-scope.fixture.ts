import { mkdirSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_OPERATION_SCOPES_REF } from "../../src/kernel/layout.js";

/** Fixture bootstrap occurs before any command or child process can use the workspace. */
export function materializeFixtureOperationScope(workspace: string): void {
  mkdirSync(path.join(workspace, WORKSPACE_OPERATION_SCOPES_REF), { recursive: true, mode: 0o700 });
}
