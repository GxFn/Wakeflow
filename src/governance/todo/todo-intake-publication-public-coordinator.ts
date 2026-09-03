import {
  WAKEFLOW_TODO_INTAKE_PUBLICATION_RESULT_SCHEMA,
  type WakeflowTodoIntakePublicationResultV1 as TodoIntakeResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-todo-intake-publication-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  TodoIntakePublicationApplicationService,
  TodoIntakePublicationApplicationServiceError,
  type TodoIntakePublicationApplicationOptions,
  type TodoIntakePublicationApplicationResult,
  type TodoIntakePublicationEffectAuthority,
} from "./todo-intake-publication-application-service.js";
import {
  TodoIntakePublicationPlanningService,
  TodoIntakePublicationPlanningServiceError,
  type TodoIntakePublicationPreviewOptions,
} from "./todo-intake-publication-planning-service.js";
import {
  parseTodoIntakePublicationPublicRequest,
  TodoIntakePublicationPublicContractError,
  WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
  type TodoIntakePublicationPublicResult,
} from "./todo-intake-publication-public-contract.js";

/** Wakeflow Governance / TODO：Public Intake根生命周期、模式路由与metadata回执。 */

export interface TodoIntakePublicationPublicCoordinatorOptions {
  readonly preview?: TodoIntakePublicationPreviewOptions;
  readonly apply?: TodoIntakePublicationApplicationOptions;
  readonly recover?: TodoIntakePublicationApplicationOptions;
}

export type TodoIntakePublicationPublicCoordinatorErrorReason =
  | "root"
  | "privacy"
  | "preview"
  | "apply"
  | "recover"
  | "output";

const ERROR_MESSAGES = {
  root: "TODO intake publication public workspace root is invalid.",
  privacy: "TODO intake publication public content contains private root text.",
  preview: "TODO intake publication public preview failed.",
  apply: "TODO intake publication public apply failed.",
  recover: "TODO intake publication public recovery failed.",
  output: "TODO intake publication public result violated its boundary.",
} as const satisfies Readonly<Record<
  TodoIntakePublicationPublicCoordinatorErrorReason,
  string
>>;

/** Public Intake无法证明根、领域结果或最小披露时的稳定错误。 */
export class TodoIntakePublicationPublicCoordinatorError extends Error {
  override readonly name = "TodoIntakePublicationPublicCoordinatorError";
  readonly code = "wakeflow-todo-intake-publication-public-coordinator" as const;
  readonly reason: TodoIntakePublicationPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly publicationAuthority: TodoIntakePublicationEffectAuthority;

  constructor(
    reason: TodoIntakePublicationPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    publicationAuthority: TodoIntakePublicationEffectAuthority = "unknown",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.publicationAuthority = publicationAuthority;
  }
}

const TODO_INTAKE_PUBLICATION_PUBLIC_MAXIMUM_RESULT_BYTES = 2 * 1024 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<TodoIntakeResultWire>(
  WAKEFLOW_TODO_INTAKE_PUBLICATION_RESULT_SCHEMA,
);

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TodoIntakePublicationPublicCoordinatorErrorReason,
  cause?: unknown,
  publicationAuthority: TodoIntakePublicationEffectAuthority = "unknown",
): never {
  throw new TodoIntakePublicationPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    publicationAuthority,
  );
}

function containsPrivateText(
  value: unknown,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    return [...privateValues].some((privateValue) =>
      value.includes(privateValue));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value as Readonly<Record<string, unknown>>).some(
    (entry) => containsPrivateText(entry, privateValues),
  );
}

function publicResult(
  value: unknown,
  privateValues: ReadonlySet<string>,
  publicationAuthority: TodoIntakePublicationEffectAuthority,
): TodoIntakePublicationPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, publicationAuthority);
    }
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$result").byteLength
      > TODO_INTAKE_PUBLICATION_PUBLIC_MAXIMUM_RESULT_BYTES
    || containsPrivateText(json, privateValues)
    || !validateResult(json).ok
  ) {
    fail("output", undefined, publicationAuthority);
  }
  return json as unknown as TodoIntakePublicationPublicResult;
}

function receipt(
  result: Readonly<TodoIntakePublicationApplicationResult>,
) {
  if (
    (result.disposition === "current") !== !result.wroteAuthority
    || (result.operation === "apply" && result.disposition === "recovered")
    || (result.operation === "recover" && result.disposition === "published")
  ) {
    fail("output", undefined, "current");
  }
  return Object.freeze({
    publicationAuthority: "current" as const,
    disposition: result.disposition,
    todoId: result.item.todoId,
    todoStatus: result.item.state.status,
    intakeDigest: result.item.intakeDigest,
    stateDigest: result.item.stateDigest,
    collectionDigest: result.collectionDigest,
  });
}

/** 执行Public TODO Intake preview/apply/recover。 */
export async function executeTodoIntakePublicationPublicRequest(
  value: unknown,
  options: TodoIntakePublicationPublicCoordinatorOptions = {},
): Promise<TodoIntakePublicationPublicResult> {
  const request = parseTodoIntakePublicationPublicRequest(value);
  let publicationAuthority: TodoIntakePublicationEffectAuthority =
    request.mode === "preview" ? "unchanged" : "unknown";
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("root", error, publicationAuthority);
    }
    throw error;
  }
  const privateValues = new Set(
    [request.root, root.absolutePath].filter((entry) => entry.length > 1),
  );
  let result: TodoIntakePublicationPublicResult | undefined;
  let failure: unknown;
  try {
    if (request.mode === "preview") {
      if (containsPrivateText(request.intake, privateValues)) {
        fail("privacy", undefined, "unchanged");
      }
      let preview;
      try {
        preview = await new TodoIntakePublicationPlanningService(root).preview(
          request.intake,
          options.preview,
        );
      } catch (error: unknown) {
        if (error instanceof TodoIntakePublicationPlanningServiceError) {
          fail("preview", error, "unchanged");
        }
        throw error;
      }
      result = publicResult({
        kind: "WakeflowTodoIntakePublicationPreviewResult",
        schemaVersion: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
        mode: "preview",
        status: "ready",
        plan: preview.plan,
        planDigest: preview.planDigest,
      }, privateValues, "unchanged");
    } else {
      if (containsPrivateText(request.plan, privateValues)) {
        fail("privacy", undefined, "unchanged");
      }
      const application = new TodoIntakePublicationApplicationService(root);
      let applied;
      try {
        applied = request.mode === "apply"
          ? await application.apply(
              request.plan,
              request.planDigest,
              options.apply,
            )
          : await application.recover(
              request.plan,
              request.planDigest,
              options.recover,
            );
      } catch (error: unknown) {
        if (error instanceof TodoIntakePublicationApplicationServiceError) {
          publicationAuthority = error.publicationAuthority;
          fail(request.mode, error, publicationAuthority);
        }
        throw error;
      }
      publicationAuthority = "current";
      result = publicResult({
        kind: request.mode === "apply"
          ? "WakeflowTodoIntakePublicationApplyResult"
          : "WakeflowTodoIntakePublicationRecoveryResult",
        schemaVersion: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
        mode: request.mode,
        status: "current",
        planDigest: applied.planDigest,
        publication: receipt(applied),
      }, privateValues, publicationAuthority);
    }
  } catch (error: unknown) {
    if (error instanceof TodoIntakePublicationPublicCoordinatorError) {
      publicationAuthority = error.publicationAuthority;
    }
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new TodoIntakePublicationPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        publicationAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output", undefined, publicationAuthority);
  return result;
}

export { TodoIntakePublicationPublicContractError };
