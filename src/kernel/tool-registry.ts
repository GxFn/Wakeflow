import { fail } from "./error.js";

/**
 * Wakeflow Kernel / Tool Registry：公共工具登记表（ADR-0013 决定 C、ADR-0004）。
 *
 * 登记表是纯数据：工具名、所属切片、调用形状、executor 绑定名、标题、一到两句
 * 描述、完整请求与结果 Schema、MCP 注解。组合根按登记表向宿主 SDK 注册工具；
 * 公共目录投影只带请求 Schema，结果 Schema 留给服务端校验（ADR-0004 选项 A 第 1 项）。
 * 本模块不认识 MCP SDK，也不持有任何 executor。
 */

type WakeflowToolShape = "read" | "append" | "effect";

interface WakeflowToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: false;
}

export interface WakeflowToolRegistration {
  readonly name: string;
  readonly slice: string;
  readonly shape: WakeflowToolShape;
  /** 组合根 executor 集合里的绑定名。 */
  readonly executor: string;
  readonly title: string;
  readonly description: string;
  readonly requestSchema: Readonly<Record<string, unknown>>;
  readonly resultSchema: Readonly<Record<string, unknown>>;
  readonly annotations: WakeflowToolAnnotations;
}

export interface WakeflowToolCatalog {
  readonly tools: readonly Readonly<WakeflowToolRegistration>[];
}

/** `tools/list` 里公开的一条定义；结果 Schema 有意不在其中。 */
export interface WakeflowPublicToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: WakeflowToolAnnotations;
}

const TOOL_NAME_PATTERN = /^wakeflow_[a-z][a-z0-9_]{2,62}$/u;
const SLICE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
const EXECUTOR_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/u;
const SCHEMA_ID_PATTERN = /^urn:wakeflow:entrypoints:([a-z0-9-]+)-(request|result):v1$/u;
const TITLE_MAXIMUM_LENGTH = 80;
/**
 * 一个工具的描述的上限。原来是 640 字节（ADR-0004：描述压到一到两句），放不下的话被挤进请求 Schema 的根
 * 描述与 `$comment`，同一件事分三处说、改一处漏两处（gate-log §13.263 余项 ⑧）。1.4 第 3 段起对 Agent
 * 说话的只留这一层，上限相应提到 1,024 字节（用户 2026-11-18：预算可以酌情放宽，避免压缩导致语义问题）；
 * 目录的总预算没有放宽，那两层不再发布之后总量是下降的。
 */
export const WAKEFLOW_TOOL_DESCRIPTION_MAXIMUM_BYTES = 1024;
const WAKEFLOW_TOOL_CATALOG_MAXIMUM_TOOLS = 32;

function schemaStem(
  schema: Readonly<Record<string, unknown>>,
  kind: "request" | "result",
  path: string,
): string {
  const id = schema.$id;
  const match = typeof id === "string" ? SCHEMA_ID_PATTERN.exec(id) : null;
  if (match === null || match[2] !== kind || typeof schema.type !== "string") {
    fail("unexpected", `tool-catalog-${kind}-schema`, path);
  }
  return match[1] as string;
}

function assertAnnotationsFitShape(
  registration: Readonly<WakeflowToolRegistration>,
  path: string,
): void {
  const { annotations, shape } = registration;
  if (
    typeof annotations !== "object" ||
    annotations === null ||
    annotations.openWorldHint !== false ||
    typeof annotations.readOnlyHint !== "boolean" ||
    typeof annotations.destructiveHint !== "boolean" ||
    typeof annotations.idempotentHint !== "boolean"
  ) {
    fail("unexpected", "tool-catalog-annotations", path);
  }
  const consistent =
    shape === "read"
      ? annotations.readOnlyHint && !annotations.destructiveHint && annotations.idempotentHint
      : shape === "append"
        ? !annotations.readOnlyHint && annotations.idempotentHint
        : !annotations.readOnlyHint;
  if (!consistent) fail("unexpected", "tool-catalog-shape", path);
}

/** 准入一份登记表：名字、绑定名与 Schema 身份唯一，注解与调用形状一致。 */
export function createWakeflowToolCatalog(
  registrations: readonly Readonly<WakeflowToolRegistration>[],
): Readonly<WakeflowToolCatalog> {
  if (!Array.isArray(registrations)) {
    fail("unexpected", "tool-catalog-input", "$catalog");
  }
  if (registrations.length > WAKEFLOW_TOOL_CATALOG_MAXIMUM_TOOLS) {
    fail("unexpected", "tool-catalog-capacity", "$catalog");
  }
  const names = new Set<string>();
  const executors = new Set<string>();
  const stems = new Set<string>();
  const tools = registrations.map((registration, index) => {
    const path = `$catalog/${index}`;
    if (
      typeof registration !== "object" ||
      registration === null ||
      !TOOL_NAME_PATTERN.test(registration.name) ||
      !SLICE_PATTERN.test(registration.slice) ||
      !EXECUTOR_PATTERN.test(registration.executor) ||
      (registration.shape !== "read" &&
        registration.shape !== "append" &&
        registration.shape !== "effect") ||
      typeof registration.title !== "string" ||
      registration.title.length === 0 ||
      registration.title.length > TITLE_MAXIMUM_LENGTH ||
      typeof registration.description !== "string" ||
      registration.description.length === 0 ||
      Buffer.byteLength(registration.description, "utf8") > WAKEFLOW_TOOL_DESCRIPTION_MAXIMUM_BYTES
    ) {
      fail("unexpected", "tool-catalog-registration", path);
    }
    if (names.has(registration.name)) {
      fail("unexpected", "tool-catalog-duplicate-name", path);
    }
    if (executors.has(registration.executor)) {
      fail("unexpected", "tool-catalog-duplicate-executor", path);
    }
    const requestStem = schemaStem(registration.requestSchema, "request", path);
    const resultStem = schemaStem(registration.resultSchema, "result", path);
    if (requestStem !== resultStem || stems.has(requestStem)) {
      fail("unexpected", "tool-catalog-schema-stem", path);
    }
    assertAnnotationsFitShape(registration, path);
    names.add(registration.name);
    executors.add(registration.executor);
    stems.add(requestStem);
    return Object.freeze({
      name: registration.name,
      slice: registration.slice,
      shape: registration.shape,
      executor: registration.executor,
      title: registration.title,
      description: registration.description,
      requestSchema: registration.requestSchema,
      resultSchema: registration.resultSchema,
      annotations: Object.freeze({
        readOnlyHint: registration.annotations.readOnlyHint,
        destructiveHint: registration.annotations.destructiveHint,
        idempotentHint: registration.annotations.idempotentHint,
        openWorldHint: false as const,
      }),
    });
  });
  return Object.freeze({ tools: Object.freeze(tools) });
}

/**
 * 请求 Schema 的公开形状：根上的 `description`、`$comment` 与代码生成用的导出标记不随目录发布。
 *
 * 一个工具原来有三层说明——工具描述、请求 Schema 的根描述、`$comment`——说的是同一件事，改一处漏两处
 * （gate-log §13.263 的余项 ⑧）。对 Agent 说话的只留工具描述一层；Schema 里各成员自己的 `description` 不动。
 * 这三个成员不参与校验，去掉之后公开的 Schema 接受与拒绝的请求和原来完全一样。
 */
function publicInputSchema(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const {
    description: _description,
    $comment: _comment,
    "x-wakeflow-runtime-export": _runtimeExport,
    ...published
  } = schema;
  return Object.freeze(published);
}

/** 公开投影：只带请求 Schema；结果 Schema 由服务端校验，不进 `tools/list`。 */
export function publicToolDefinition(
  registration: Readonly<WakeflowToolRegistration>,
): Readonly<WakeflowPublicToolDefinition> {
  return Object.freeze({
    name: registration.name,
    title: registration.title,
    description: registration.description,
    inputSchema: publicInputSchema(registration.requestSchema),
    annotations: registration.annotations,
  });
}
