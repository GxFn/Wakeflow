import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { privateDirectory } from "../verification/files.js";
import {
  captureSchemas,
  frozenTestContext,
  implementationBaseline,
  selectEnvelope,
} from "./contracts.js";
import {
  array,
  canonicalDigest,
  decodeJson,
  type FileObservation,
  object,
  readJson,
  readObservedFile,
  relativeFile,
  requireCapture,
  selfDigest,
  textValue,
  within,
  writeExclusive,
  writeExclusiveJson,
} from "./io.js";
import { type CaptureCommand, type CaptureSelection, parseCaptureSelection } from "./model.js";
import {
  executionContext,
  observeProduct,
  type ProductInput,
  productLocation,
} from "./observations.js";

interface CopiedInput {
  readonly ref: string;
  readonly sourcePath: string;
  readonly observation: FileObservation;
}

export interface CapturePlan {
  readonly kind: "WakeflowTestCapturePlan";
  readonly schemaVersion: 1;
  readonly selection: CaptureSelection;
  readonly schemaCatalogDigest: string;
  readonly executionRoot: string;
  readonly outputRoot: string;
  readonly subject: {
    readonly programId: string;
    readonly demandId: string;
    readonly targetTaskId: string;
    readonly taskPackageId: string;
    readonly testAttemptId: string;
    readonly ordinal: number;
  };
  readonly artifactRefs: {
    readonly config: string;
    readonly taskPackage: string;
    readonly envelope: string;
    readonly previousResult: string | null;
    readonly implementations: readonly string[];
  };
  readonly steps: readonly Record<string, unknown>[];
  readonly products: readonly ProductInput[];
  readonly productObservations: readonly ReturnType<typeof observeProduct>[];
  readonly commandInputs: readonly {
    readonly stepId: string;
    readonly files: readonly CopiedInput[];
  }[];
  readonly inputs: readonly CopiedInput[];
  readonly planDigest: string;
}

function collectInputs() {
  const inputs: CopiedInput[] = [];
  const buffers = new Map<string, Buffer>();
  let total = 0;
  return {
    inputs,
    buffers,
    add(file: string): CopiedInput {
      const prior = inputs.find((entry) => entry.sourcePath === file);
      if (prior !== undefined) return prior;
      const read = readObservedFile(file);
      total += read.bytes.length;
      requireCapture(total <= 128 * 1024 * 1024 && inputs.length < 512, "capture-input-budget");
      const input = {
        ref: `inputs/${inputs.length}.bin`,
        sourcePath: file,
        observation: read.observation,
      };
      inputs.push(input);
      buffers.set(input.ref, read.bytes);
      return input;
    },
    value(input: CopiedInput) {
      const bytes = buffers.get(input.ref);
      requireCapture(bytes !== undefined, "capture-input-unavailable");
      return decodeJson(bytes);
    },
  };
}

export function capturePlanDirectory(repository: string, id: string): string {
  requireCapture(/^capture-[a-f0-9]{64}$/u.test(id), "capture-invalid-id");
  return path.join(repository, ".build/capture/plans", id);
}

export function prepareCapture(repository: string, selectionFile: string) {
  assertCanonicalDirectory(repository);
  const selection = parseCaptureSelection(readJson(selectionFile), path.dirname(selectionFile));
  assertCanonicalDirectory(selection.root);
  const schemas = captureSchemas(repository);
  const copied = collectInputs();
  const config = copied.add(path.join(selection.root, "wakeflow.config.json"));
  schemas.validate("urn:wakeflow:config:v2", copied.value(config));
  const taskPackage = copied.add(selection.taskPackageFile);
  const envelope = copied.add(selection.envelopeFile);
  const previous =
    selection.previousResultFile === null ? null : copied.add(selection.previousResultFile);
  const context = frozenTestContext(
    copied.value(taskPackage),
    selectEnvelope(copied.value(envelope), selection.envelopeDigest, schemas),
    previous === null ? undefined : copied.value(previous),
    schemas,
  );
  const execution = executionContext(copied.value(config), context.taskPackage, selection.root);
  const outputRoot = path.join(execution.executionRoot, selection.outputDirectory);
  requireCapture(
    within(execution.executionRoot, outputRoot) &&
      outputRoot !== execution.executionRoot &&
      !selection.outputDirectory.split("/").some((part) => part.startsWith(".wakeflow")),
    "capture-output-boundary",
  );
  const allowed = context.steps.map((step) => String(step.stepId));
  requireCapture(
    selection.commands.length === allowed.length &&
      selection.commands.every((row) => allowed.includes(row.stepId)),
    "capture-command-scope",
  );
  requireCapture(
    selection.implementations.length === context.baselines.length && context.baselines.length > 0,
    "capture-baseline-set",
  );
  const resultRefs: string[] = [];
  const products: ProductInput[] = [];
  const productObservations = selection.implementations.map((row) => {
    const result = copied.add(row.resultFile);
    resultRefs.push(result.ref);
    const baseline = implementationBaseline(
      context,
      row.repositoryId,
      copied.value(result),
      row.commit,
      schemas,
    );
    const input = {
      repositoryId: row.repositoryId,
      checkout: row.checkout,
      ...productLocation(execution, selection.root, baseline.baseline, row.checkout),
      commit: row.commit,
      branch: baseline.branch,
      files: row.files,
    };
    const observed = observeProduct(input);
    products.push(input);
    for (const file of observed.files) {
      const copy = copied.add(path.join(input.checkout, file.path));
      requireCapture(
        copy.observation.digest === file.digest && copy.observation.inode === file.inode,
        "capture-input-changed",
      );
    }
    return observed;
  });
  const commandInputs = selection.commands.map((command) => ({
    stepId: command.stepId,
    files: command.inputFiles.map((file) => copied.add(path.join(execution.executionRoot, file))),
  }));
  const body = {
    kind: "WakeflowTestCapturePlan" as const,
    schemaVersion: 1 as const,
    selection,
    schemaCatalogDigest: schemas.digest,
    executionRoot: execution.executionRoot,
    outputRoot,
    subject: {
      programId: textValue(context.taskPackage.programId),
      demandId: textValue(context.taskPackage.demandId),
      targetTaskId: textValue(context.taskPackage.targetTaskId),
      taskPackageId: textValue(context.taskPackage.taskPackageId),
      testAttemptId: textValue(context.attempt.testAttemptId),
      ordinal: Number(context.attempt.ordinal),
    },
    artifactRefs: {
      config: config.ref,
      taskPackage: taskPackage.ref,
      envelope: envelope.ref,
      previousResult: previous?.ref ?? null,
      implementations: resultRefs,
    },
    steps: context.steps,
    products,
    productObservations,
    commandInputs,
    inputs: copied.inputs,
  };
  const plan: CapturePlan = { ...body, planDigest: canonicalDigest(body) };
  const id = `capture-${plan.planDigest.slice(7)}`;
  privateDirectory(repository, ".build/capture/plans");
  const directory = capturePlanDirectory(repository, id);
  if (existsSync(directory)) readCapturePlan(repository, id);
  else {
    mkdirSync(directory, { mode: 0o700 });
    privateDirectory(directory, "inputs");
    for (const [ref, bytes] of copied.buffers) writeExclusive(path.join(directory, ref), bytes);
    writeExclusiveJson(path.join(directory, "plan.json"), plan);
    writeExclusiveJson(path.join(directory, "ready.json"), {
      kind: "WakeflowCaptureInputsSealed",
      planDigest: plan.planDigest,
    });
  }
  return {
    kind: "WakeflowTestCapturePrepared",
    schemaVersion: 1,
    status: "prepared",
    exitCode: 0,
    id,
    plan: path.relative(repository, path.join(directory, "plan.json")),
    stepIds: allowed,
    copiedInputs: copied.inputs.length,
    source: "imported-unverified",
    authorization: "not-established-by-capture",
    controllerAcceptance: "not-performed",
    commandsExecuted: 0,
  };
}

/** Integrity only; old source files, transient snapshots and the live workspace are never needed here. */
export function readCapturePlan(repository: string, id: string): CapturePlan {
  const directory = capturePlanDirectory(repository, id);
  assertCanonicalDirectory(directory);
  const value = readJson(path.join(directory, "plan.json"));
  requireCapture(
    value.kind === "WakeflowTestCapturePlan" && value.schemaVersion === 1,
    "capture-invalid-plan",
  );
  selfDigest(value, "planDigest");
  requireCapture(value.planDigest === `sha256:${id.slice(8)}`, "capture-plan-id-mismatch");
  const selection = parseCaptureSelection(value.selection, repository);
  requireCapture(
    canonicalDigest(selection) === canonicalDigest(value.selection),
    "capture-invalid-plan-selection",
  );
  const stepIds = array(value.steps, 20).map((step) => textValue(object(step).stepId));
  requireCapture(
    stepIds.length > 0 &&
      new Set(stepIds).size === stepIds.length &&
      selection.commands.length === stepIds.length &&
      selection.commands.every((command) => stepIds.includes(command.stepId)),
    "capture-invalid-plan-steps",
  );
  const ready = readJson(path.join(directory, "ready.json"));
  requireCapture(
    ready.kind === "WakeflowCaptureInputsSealed" && ready.planDigest === value.planDigest,
    "capture-inputs-not-sealed",
  );
  const inputs = array(value.inputs, 512).map(object);
  requireCapture(
    inputs.length > 0 && new Set(inputs.map((entry) => entry.ref)).size === inputs.length,
    "capture-invalid-plan",
  );
  for (const entry of inputs) {
    const ref = relativeFile(entry.ref);
    requireCapture(/^inputs\/[0-9]+\.bin$/u.test(ref), "capture-invalid-plan");
    const file = readObservedFile(path.join(directory, ref));
    requireCapture(
      file.observation.digest === object(entry.observation).digest &&
        file.observation.bytes === object(entry.observation).bytes,
      "capture-frozen-input-drift",
    );
  }
  requireCapture(
    readdirSync(directory).sort().join("\n") === "inputs\nplan.json\nready.json" &&
      readdirSync(path.join(directory, "inputs")).sort().join("\n") ===
        inputs
          .map((entry) => path.basename(String(entry.ref)))
          .sort()
          .join("\n"),
    "capture-unknown-plan-files",
  );
  return value as unknown as CapturePlan;
}

export function captureCommand(plan: CapturePlan, stepId: string): CaptureCommand {
  const command = plan.selection.commands.find((row) => row.stepId === stepId);
  requireCapture(
    command !== undefined && plan.steps.some((step) => step.stepId === stepId),
    "capture-step-outside-attempt",
  );
  return command;
}

export function validateExecutablePlan(repository: string, id: string, plan: CapturePlan): void {
  const schemas = captureSchemas(repository);
  requireCapture(schemas.digest === plan.schemaCatalogDigest, "capture-schema-changed");
  const directory = capturePlanDirectory(repository, id);
  const value = (ref: string) => readJson(path.join(directory, relativeFile(ref)));
  const context = frozenTestContext(
    value(plan.artifactRefs.taskPackage),
    selectEnvelope(value(plan.artifactRefs.envelope), plan.selection.envelopeDigest, schemas),
    plan.artifactRefs.previousResult === null ? undefined : value(plan.artifactRefs.previousResult),
    schemas,
  );
  requireCapture(
    canonicalDigest(context.steps) === canonicalDigest(plan.steps) &&
      context.attempt.testAttemptId === plan.subject.testAttemptId &&
      context.attempt.ordinal === plan.subject.ordinal &&
      context.taskPackage.taskPackageId === plan.subject.taskPackageId &&
      context.taskPackage.targetTaskId === plan.subject.targetTaskId &&
      context.taskPackage.demandId === plan.subject.demandId &&
      context.taskPackage.programId === plan.subject.programId,
    "capture-plan-context-mismatch",
  );
  const config = value(plan.artifactRefs.config);
  schemas.validate("urn:wakeflow:config:v2", config);
  const execution = executionContext(config, context.taskPackage, plan.selection.root);
  requireCapture(
    execution.executionRoot === plan.executionRoot &&
      path.join(plan.executionRoot, relativeFile(plan.selection.outputDirectory)) ===
        plan.outputRoot,
    "capture-plan-location-mismatch",
  );
  requireCapture(
    plan.products.length === context.baselines.length &&
      plan.products.length === plan.artifactRefs.implementations.length &&
      new Set(plan.products.map((product) => product.repositoryId)).size === plan.products.length,
    "capture-baseline-set",
  );
  for (const [index, product] of plan.products.entries()) {
    const ref = plan.artifactRefs.implementations[index];
    requireCapture(ref !== undefined, "capture-baseline-set");
    const matched = implementationBaseline(
      context,
      product.repositoryId,
      value(ref),
      product.commit,
      schemas,
    );
    const location = productLocation(
      execution,
      plan.selection.root,
      matched.baseline,
      product.checkout,
    );
    const selected = plan.selection.implementations[index];
    requireCapture(
      product.branch === matched.branch &&
        product.repositoryRoot === location.repositoryRoot &&
        product.placement === location.placement &&
        selected?.repositoryId === product.repositoryId &&
        selected.checkout === product.checkout &&
        selected.commit === product.commit &&
        canonicalDigest(selected.files) === canonicalDigest(product.files),
      "capture-plan-baseline-mismatch",
    );
  }
}
