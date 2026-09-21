import { types } from "node:util";
import { JsonValueError, parseJsonValue, } from "../data/json-value.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
const ERROR_MESSAGES = {
    "input": "Event Sourcing version evolution input is invalid.",
    "definition": "Event Sourcing version evolution definition is invalid.",
    "unsupported-version": "Persisted Event Sourcing version is unsupported.",
    "codec": "Persisted Event Sourcing version data is invalid.",
    "missing-step": "Event Sourcing version evolution chain is incomplete.",
    "upcast": "Event Sourcing version upcast failed.",
};
export class EventSourcingVersionEvolutionError extends Error {
    name = "EventSourcingVersionEvolutionError";
    code = "wakeflow-event-sourcing-version-evolution";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new EventSourcingVersionEvolutionError(reason, path);
}
function parseVersion(value, path) {
    if (!Number.isSafeInteger(value) || value < 1) {
        fail("definition", path);
    }
    return value;
}
function parseFunction(value, path) {
    if (typeof value !== "function" || types.isProxy(value)) {
        fail("definition", path);
    }
    return value;
}
function exactRecord(value, fields, path) {
    let record;
    try {
        record = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("definition", path);
        throw error;
    }
    const keys = Object.keys(record).sort();
    const expected = [...fields].sort();
    if (keys.length !== expected.length
        || keys.some((key, index) => key !== expected[index])) {
        fail("definition", path);
    }
    return record;
}
function parseDefinition(value) {
    const definition = exactRecord(value, ["codecs", "currentVersion", "steps"], "$definition");
    let codecValues;
    let stepValues;
    try {
        codecValues = parseDenseArray(definition.codecs, 256, "$/codecs");
        stepValues = parseDenseArray(definition.steps, 255, "$/steps");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("definition", error.path);
        throw error;
    }
    if (codecValues.length === 0)
        fail("definition", "$/codecs");
    const codecs = codecValues.map((value, index) => {
        const record = exactRecord(value, ["parse", "version"], `$/codecs/${index}`);
        return Object.freeze({
            version: parseVersion(record.version, `$/codecs/${index}/version`),
            parse: parseFunction(record.parse, `$/codecs/${index}/parse`),
        });
    });
    const steps = stepValues.map((value, index) => {
        const record = exactRecord(value, ["fromVersion", "toVersion", "upcast"], `$/steps/${index}`);
        const fromVersion = parseVersion(record.fromVersion, `$/steps/${index}/fromVersion`);
        const toVersion = parseVersion(record.toVersion, `$/steps/${index}/toVersion`);
        if (toVersion !== fromVersion + 1) {
            fail("definition", `$/steps/${index}/toVersion`);
        }
        return Object.freeze({
            fromVersion,
            toVersion,
            upcast: parseFunction(record.upcast, `$/steps/${index}/upcast`),
        });
    });
    return Object.freeze({
        currentVersion: parseVersion(definition.currentVersion, "$/currentVersion"),
        codecs: Object.freeze(codecs),
        steps: Object.freeze(steps),
    });
}
function snapshotJson(value, path, reason = "codec") {
    try {
        return parseJsonValue(value, path);
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail(reason, path);
        throw error;
    }
}
/** 一个事件家族的不可变、可复用版本演进计划。 */
export class EventSourcingVersionEvolutionRegistry {
    #currentVersion;
    #supportedVersions;
    #codecs;
    #steps;
    constructor(definitionValue) {
        const definition = parseDefinition(definitionValue);
        const codecs = new Map();
        for (const [index, codec] of definition.codecs.entries()) {
            if (codec.version > definition.currentVersion || codecs.has(codec.version)) {
                fail("definition", `$/codecs/${index}/version`);
            }
            codecs.set(codec.version, codec);
        }
        if (!codecs.has(definition.currentVersion)) {
            fail("definition", "$/currentVersion");
        }
        const steps = new Map();
        for (const [index, step] of definition.steps.entries()) {
            if (step.toVersion > definition.currentVersion
                || steps.has(step.fromVersion)
                || !codecs.has(step.fromVersion)
                || !codecs.has(step.toVersion)) {
                fail("definition", `$/steps/${index}`);
            }
            steps.set(step.fromVersion, step);
        }
        for (const version of codecs.keys()) {
            for (let current = version; current < definition.currentVersion; current += 1) {
                if (!steps.has(current))
                    fail("missing-step", `$/steps/${current}`);
            }
        }
        this.#currentVersion = definition.currentVersion;
        this.#supportedVersions = Object.freeze([...codecs.keys()].sort((left, right) => left - right));
        this.#codecs = codecs;
        this.#steps = steps;
    }
    get currentVersion() {
        return this.#currentVersion;
    }
    get supportedVersions() {
        return this.#supportedVersions;
    }
    /** 从任一受支持的持久化版本确定性演进到当前版本。 */
    evolve(sourceVersionValue, sourceDataValue) {
        if (!Number.isSafeInteger(sourceVersionValue)
            || sourceVersionValue < 1) {
            fail("input", "$sourceVersion");
        }
        const sourceVersion = sourceVersionValue;
        let codec = this.#codecs.get(sourceVersion);
        if (codec === undefined)
            fail("unsupported-version", "$sourceVersion");
        let data = snapshotJson(sourceDataValue, "$data");
        let parsed;
        try {
            parsed = codec.parse(data);
        }
        catch {
            fail("codec", "$data");
        }
        data = snapshotJson(parsed, "$data");
        for (let version = sourceVersion; version < this.#currentVersion; version += 1) {
            const step = this.#steps.get(version);
            if (step === undefined)
                fail("missing-step", `$/steps/${version}`);
            let upcasted;
            try {
                upcasted = step.upcast(data);
            }
            catch {
                fail("upcast", `$/steps/${version}`);
            }
            codec = this.#codecs.get(step.toVersion);
            if (codec === undefined) {
                fail("missing-step", `$/codecs/${step.toVersion}`);
            }
            const intermediate = snapshotJson(upcasted, `$/steps/${version}`, "upcast");
            try {
                parsed = codec.parse(intermediate);
            }
            catch {
                fail("codec", `$/codecs/${step.toVersion}`);
            }
            data = snapshotJson(parsed, `$/codecs/${step.toVersion}`);
        }
        return Object.freeze({
            sourceVersion,
            currentVersion: this.#currentVersion,
            data,
        });
    }
}
