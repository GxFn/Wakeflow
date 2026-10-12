import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseWakeflowNodeEngineBounds,
  WAKEFLOW_NODE_ENGINES,
} from "../../../src/contracts/vocabulary/wakeflow-runtime-engines.js";

test("the Node engine range parses to numeric bounds and malformed ranges are rejected（A6，§13.167）", () => {
  equal(WAKEFLOW_NODE_ENGINES, ">=24.19.0 <25");
  deepEqual(parseWakeflowNodeEngineBounds(), { minimum: [24, 19, 0], exclusiveMajor: 25 });
  deepEqual(parseWakeflowNodeEngineBounds(">=1.2.3 <4"), { minimum: [1, 2, 3], exclusiveMajor: 4 });
  equal(Object.isFrozen(parseWakeflowNodeEngineBounds()), true);
  for (const malformed of ["^24", ">=24 <25", ">=24.19.0", "24.19.0 - 25", ""]) {
    throws(() => parseWakeflowNodeEngineBounds(malformed), TypeError);
  }
});
