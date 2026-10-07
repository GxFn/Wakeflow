import { Ajv2020 } from "ajv/dist/2020.js";
import { loadSchemaCatalog } from "../codegen/schema-types.js";
import { sha256 } from "../verification/files.js";
import {
  array,
  canonicalDigest,
  decodeJson,
  object,
  requireCapture,
  selfDigest,
  textValue,
} from "./io.js";

const PACKAGE = "urn:wakeflow:governance:tasking:task-package:v1";
const ENVELOPE = "urn:wakeflow:governance:delivery:delivery-envelope:v1";
const RESULT = "urn:wakeflow:governance:result:target-result:v1";

export function captureSchemas(repository: string) {
  const catalog = loadSchemaCatalog(repository);
  const validator = new Ajv2020({ strict: false, allErrors: false, validateFormats: false });
  for (const entry of catalog) validator.addSchema(entry.schema, entry.id);
  return {
    digest: canonicalDigest(catalog.map((entry) => [entry.id, entry.schema])),
    validate(id: string, value: unknown) {
      requireCapture(validator.validate(id, value), "capture-contract-schema");
      return object(value);
    },
  };
}

export type CaptureSchemas = ReturnType<typeof captureSchemas>;

function importedBody(value: unknown): Record<string, unknown> {
  let body = object(value);
  if (body.isError === true) requireCapture(false, "capture-imported-tool-error");
  if (body.structuredContent !== undefined) body = object(body.structuredContent);
  else if (body.content !== undefined) {
    const items = array(body.content);
    requireCapture(items.length === 1, "capture-ambiguous-tool-return");
    const item = object(items[0]);
    requireCapture(
      item.type === "text" && typeof item.text === "string",
      "capture-invalid-tool-return",
    );
    body = decodeJson(Buffer.from(item.text));
  }
  return body;
}

/** Accept a copied envelope or one matching envelope in an immutable commit, never a snapshot. */
export function selectEnvelope(value: unknown, digest: string, schemas: CaptureSchemas) {
  const source = importedBody(value);
  if (source.artifactKind === "wakeflow-demand-event-stream-commit") {
    schemas.validate("urn:wakeflow:governance:demand:event-stream-commit:v1", source);
  }
  const candidates =
    source.kind === "WakeflowDeliveryEnvelope"
      ? [source]
      : source.artifactKind === "wakeflow-demand-event-stream-commit"
        ? array(source.events).flatMap((event) => {
            const data = object(object(event).data);
            return data.envelope === undefined ? [] : [object(data.envelope)];
          })
        : [];
  const matching = candidates.filter((entry) => entry.envelopeDigest === digest);
  requireCapture(matching.length === 1, "capture-envelope-unavailable");
  const result = schemas.validate(ENVELOPE, matching[0]);
  if (source.artifactKind === "wakeflow-demand-event-stream-commit") {
    requireCapture(source.demandId === result.demandId, "capture-envelope-commit-mismatch");
  }
  selfDigest(result, "envelopeDigest");
  requireCapture(
    result.promptDigest === sha256(String(result.portablePrompt).trim()),
    "capture-prompt-digest-mismatch",
  );
  return result;
}

export function selectResult(value: unknown, schemas: CaptureSchemas) {
  const body = importedBody(value);
  const result = schemas.validate(
    RESULT,
    body.kind === "WakeflowTargetResultReviewInspectionResult"
      ? object(body.reviewUnit).targetResult
      : body,
  );
  selfDigest(result, "resultDigest");
  selfDigest(object(result.report), "reportDigest");
  return result;
}

export function frozenTestContext(
  packageValue: unknown,
  envelope: Record<string, unknown>,
  previousValue: unknown | undefined,
  schemas: CaptureSchemas,
) {
  const taskPackage = schemas.validate(PACKAGE, packageValue);
  const target = object(envelope.target);
  const attempt = object(envelope.attempt);
  const contract = object(taskPackage.testContract);
  const packageDigest = canonicalDigest(taskPackage);
  requireCapture(
    taskPackage.workType === "test" &&
      envelope.workType === "test" &&
      ["programId", "configDigest", "demandId"].every(
        (key) => taskPackage[key] === envelope[key],
      ) &&
      target.targetTaskId === taskPackage.targetTaskId &&
      target.taskPackageId === taskPackage.taskPackageId &&
      target.taskPackageDigest === packageDigest &&
      object(attempt.contract).taskPackageDigest === packageDigest &&
      object(attempt.contract).taskPackageId === taskPackage.taskPackageId &&
      attempt.targetTaskId === taskPackage.targetTaskId &&
      object(envelope.route).windowId === object(taskPackage.assignment).windowId &&
      object(attempt.environmentSetup).policy === contract.setupPolicy &&
      Number(attempt.ordinal) <= Number(contract.maxAttempts),
    "capture-contract-relation",
  );
  const steps = array(contract.steps, 20).map(object);
  const allIds = steps.map((entry) => textValue(entry.stepId));
  requireCapture(
    allIds.length > 0 && new Set(allIds).size === allIds.length,
    "capture-step-identities",
  );
  let allowedIds = allIds;
  if (attempt.mode === "rerun") {
    requireCapture(previousValue !== undefined, "capture-rerun-result-required");
    const previous = selectResult(previousValue, schemas);
    const from = object(attempt.rerunSource);
    const execution = object(previous.testExecution);
    requireCapture(
      previous.workType === "test" &&
        previous.programId === taskPackage.programId &&
        previous.demandId === taskPackage.demandId &&
        previous.targetTaskId === taskPackage.targetTaskId &&
        object(previous.taskPackage).digest === packageDigest &&
        previous.targetResultId === object(from.previousResult).targetResultId &&
        previous.resultDigest === object(from.previousResult).resultDigest &&
        execution.testAttemptId === from.previousAttemptId &&
        Number(execution.ordinal) + 1 === attempt.ordinal,
      "capture-rerun-relation",
    );
    allowedIds =
      from.stepIds === null ? allIds : array(from.stepIds, 20).map((id) => textValue(id));
    const reported = array(object(previous.report).steps, 20).map(object);
    requireCapture(
      allowedIds.every(
        (id) =>
          allIds.includes(id) &&
          reported.some((row) => row.stepId === id && row.verdict !== "pass"),
      ),
      "capture-rerun-passing-or-unknown-step",
    );
  } else requireCapture(previousValue === undefined, "capture-unexpected-previous-result");
  requireCapture(
    allowedIds.length > 0 && new Set(allowedIds).size === allowedIds.length,
    "capture-step-identities",
  );
  return {
    taskPackage,
    envelope,
    packageDigest,
    attempt,
    steps: steps.filter((step) => allowedIds.includes(String(step.stepId))),
    baselines: array(taskPackage.implementationBaselines).map(object),
  };
}

export type FrozenTestContext = ReturnType<typeof frozenTestContext>;

export function implementationBaseline(
  context: FrozenTestContext,
  repositoryId: string,
  resultValue: unknown,
  commit: string,
  schemas: CaptureSchemas,
) {
  const baseline = context.baselines.find((entry) => entry.repositoryId === repositoryId);
  requireCapture(baseline !== undefined, "capture-unknown-implementation");
  const result = selectResult(resultValue, schemas);
  const assignment = object(result.assignment);
  const task = object(result.taskPackage);
  requireCapture(
    result.workType === "implementation" &&
      result.programId === context.taskPackage.programId &&
      result.demandId === context.taskPackage.demandId &&
      assignment.repositoryId === repositoryId &&
      assignment.windowId === baseline.windowId &&
      result.targetTaskId === baseline.targetTaskId &&
      result.targetResultId === baseline.targetResultId &&
      result.resultDigest === baseline.resultDigest &&
      task.taskPackageId === baseline.taskPackageId &&
      task.digest === baseline.taskPackageDigest,
    "capture-baseline-relation",
  );
  const change = object(object(result.report).repositoryChange);
  requireCapture(
    change.disposition === "committed" &&
      change.repositoryId === repositoryId &&
      array(change.commits).some((entry) => object(entry).value === commit),
    "capture-committed-baseline-required",
  );
  return {
    baseline,
    result,
    branch: change.branch === null ? null : textValue(change.branch),
    commit,
  };
}
