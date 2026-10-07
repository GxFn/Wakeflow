import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { DEFAULT_ALLOWED_ID_PREFIXES, scanPrivacyText } from "../../src/kernel/privacy-scan.js";
import { modelTestOptions } from "../../tooling/testing/model-options.js";

interface Model {
  credential: boolean;
  opaque: boolean;
  locator: boolean;
}
interface Real {
  text: string;
  roots: string[];
}
type Operation = "credential" | "format" | "opaque" | "allow" | "path" | "uuid" | "reset";
const syntheticSecret = "synthetic-property-value";

/** The model knows only which hazards were introduced, never the scanner's regexes or offsets. */
class TextCommand implements fc.Command<Model, Real> {
  readonly operation: Operation;
  readonly position: number;
  constructor(operation: Operation, position: number) {
    this.operation = operation;
    this.position = position;
  }
  check(): boolean {
    return true;
  }
  toString(): string {
    return `${this.operation}(${this.position})`;
  }
  run(model: Model, real: Real): void {
    switch (this.operation) {
      case "credential":
        real.text += `\nPASSWORD=${syntheticSecret}\n`;
        model.credential = true;
        break;
      case "format": {
        const position = this.position % (real.text.length + 1);
        real.text = `${real.text.slice(0, position)}\u001b[31m${real.text.slice(position)}\u001b[0m`;
        break;
      }
      case "opaque":
        real.text = `\u0000${real.text}`;
        model.opaque = true;
        break;
      case "allow":
        real.roots = ["/allowed/work", "/allowed/work-other"];
        break;
      case "path":
        real.text += "\n/allowed/work/../../private/fixture.txt\n";
        model.locator = true;
        break;
      case "uuid":
        real.text += "\nunknown_demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc\n";
        model.locator = true;
        break;
      case "reset":
        real.text = "";
        model.credential = false;
        model.opaque = false;
        model.locator = false;
        break;
    }
    const result = scanPrivacyText(real.text, {
      allowedPathRoots: real.roots,
      allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
    });
    // §13.161 B9-5：opaque 不是漏掉凭证的借口。
    if (model.credential) ok(result.findings.some((f) => f.kind === "credential-assignment"));
    if (model.opaque) equal(result.opaque, true);
    if (model.locator)
      ok(
        result.opaque ||
          result.findings.some(
            (f) => f.kind === "bare-uuid" || f.kind === "unlisted-absolute-path",
          ),
      );
    equal(JSON.stringify(result).includes(syntheticSecret), false);
    for (const finding of result.findings)
      ok(finding.line >= 1 && finding.column >= 1 && finding.length > 0);
  }
}

const options = modelTestOptions(process.env);
test(`privacy command model: seed=${options.seed}, runs=${options.numRuns}`, (t) => {
  t.diagnostic(
    JSON.stringify({
      ...options,
      technique: "pure-stateful-model",
      durability: "not-applicable",
      maxCommands: 24,
    }),
  );
  const command = fc
    .tuple(
      fc.constantFrom<Operation>(
        "credential",
        "format",
        "opaque",
        "allow",
        "path",
        "uuid",
        "reset",
      ),
      fc.nat({ max: 2048 }),
    )
    .map(([operation, position]) => new TextCommand(operation, position));
  fc.assert(
    fc.property(
      fc.commands([command], {
        maxCommands: 24,
        ...(options.replayPath === undefined ? {} : { replayPath: options.replayPath }),
      }),
      (commands) => {
        fc.modelRun(
          () => ({
            model: { credential: false, opaque: false, locator: false },
            real: { text: "", roots: ["/allowed/work"] },
          }),
          commands,
        );
      },
    ),
    {
      seed: options.seed,
      numRuns: options.numRuns,
      ...(options.path === undefined ? {} : { path: options.path }),
    },
  );
});
