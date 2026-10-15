import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  DEMAND_PERMIT_PROMPT_KINDS,
  DEMAND_PERMIT_PROMPTS_ROOT_REF,
  DemandEventSourcingPathError,
  demandPermitPromptKindRootRef,
  demandPermitPromptRef,
  parseDemandPermitPromptFileName,
  parseDemandPermitPromptKind,
} from "../../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";

const PERMIT_ID = "target-delivery_12345678-1234-4123-8123-123456789abc";

function pathError(reason: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof DemandEventSourcingPathError && error.reason === reason;
}

test("许可 prompt 文件固定在 artifacts/permits/<kind>/<target-delivery id>.txt，两类目录与文件名都严格解析（K6）", () => {
  equal(DEMAND_PERMIT_PROMPTS_ROOT_REF, "artifacts/permits");
  deepEqual([...DEMAND_PERMIT_PROMPT_KINDS], ["callback", "delivery"]);
  equal(demandPermitPromptKindRootRef("delivery"), "artifacts/permits/delivery");
  equal(
    demandPermitPromptRef("callback", PERMIT_ID),
    `artifacts/permits/callback/${PERMIT_ID}.txt`,
  );
  equal(parseDemandPermitPromptFileName(`${PERMIT_ID}.txt`), PERMIT_ID);
  deepEqual(
    DEMAND_PERMIT_PROMPT_KINDS.map((kind) => parseDemandPermitPromptKind(kind)),
    ["callback", "delivery"],
  );
  for (const bad of ["other", "Delivery", "", 1, null]) {
    throws(() => parseDemandPermitPromptKind(bad), pathError("permit-prompt-kind"));
  }
  for (const bad of [
    `${PERMIT_ID}.json`,
    "target-delivery_x.txt",
    "demand_12345678-1234-4123-8123-123456789abc.txt",
    `${PERMIT_ID}.txt/`,
    ` ${PERMIT_ID}.txt`,
    42,
  ]) {
    throws(() => parseDemandPermitPromptFileName(bad), pathError("permit-prompt-file-name"));
  }
  throws(() => demandPermitPromptRef("delivery", "demand_12345678-1234-4123-8123-123456789abc"));
});
