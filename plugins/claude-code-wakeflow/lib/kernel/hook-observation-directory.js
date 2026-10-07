import { sameFileNodeIdentity, } from "../foundation/filesystem/file-node-snapshot.js";
import { parsePortableResourcePath, } from "../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectoryPage, readStableRootDirectoryPage, } from "../foundation/filesystem/stable-directory-read.js";
import { fail } from "./error.js";
import { hostHookObservationsRootRef } from "./layout.js";
export const HOST_HOOK_FILE_NAME_PATTERN = /^(\d{8}T\d{9}Z)-(session-start|user-prompt-submit|stop|session-end|turn-complete)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
/** New files partition by UTC day and record digest prefix; old flat files stay readable. */
export function partitionedHostHookRef(hostId, fileName) {
    const match = HOST_HOOK_FILE_NAME_PATTERN.exec(fileName);
    if (match === null)
        throw new Error("Invalid hook observation file name.");
    return parsePortableResourcePath(`${hostHookObservationsRootRef(hostId)}/${fileName.slice(0, 8)}/${match[3].slice(0, 2)}/${fileName}`, "$record");
}
function isDay(name) {
    if (!/^\d{8}$/u.test(name))
        return false;
    const iso = `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T00:00:00.000Z`;
    const time = Date.parse(iso);
    return Number.isFinite(time) && new Date(time).toISOString() === iso;
}
const PAGE_SIZE = 2048;
async function visitDirectory(root, ref, visit, options, order = "ascending") {
    let afterName;
    let expectedNode;
    // 降序（最新在前）要先读完整个目录再反向走：分页游标只按名字升序前进。
    const collected = [];
    for (;;) {
        const pageOptions = {
            maximumEntries: PAGE_SIZE,
            ...(afterName === undefined ? {} : { afterName }),
            ...(expectedNode === undefined ? {} : { expectedNode }),
            ...options,
        };
        const page = ref === null
            ? await readStableRootDirectoryPage(root, pageOptions)
            : await readStableResourceDirectoryPage(root, ref, pageOptions);
        expectedNode ??= page.directoryNode;
        if (order === "ascending")
            for (const entry of page.entries)
                await visit(entry);
        else
            collected.push(...page.entries);
        if (!page.hasMore)
            break;
        afterName = page.entries.at(-1)?.name;
    }
    for (let index = collected.length - 1; index >= 0; index -= 1) {
        await visit(collected[index]);
    }
}
/**
 * Only recognized private directories are traversed. Everything else is handed
 * to the record reader for diagnosis, never followed or removed as a directory.
 * Each directory has bounded pages and a stable snapshot across its pages.
 */
export async function visitHostHookDirectory(root, hostId, visit, options = {}) {
    if (options.signal?.aborted === true)
        fail("io-failure", "aborted", "$signal");
    const signal = options.signal === undefined ? {} : { signal: options.signal };
    const order = options.order ?? "ascending";
    const rootRef = hostHookObservationsRootRef(hostId);
    let parent;
    try {
        parent = await root.inspectExistingResource(rootRef, "$hooks");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return;
        throw error;
    }
    const scoped = await RootedDirectory.open(parent.physicalPath, "$hooks");
    const fromWorkspaceRoot = (entry) => Object.freeze({
        ...entry,
        resourcePath: parsePortableResourcePath(`${rootRef}/${entry.resourcePath}`),
    });
    const scopedVisit = (entry) => visit(fromWorkspaceRoot(entry));
    try {
        if (!sameFileNodeIdentity(parent.node, await scoped.assertCurrent("$hooks")))
            fail("io-failure", "observation-scope-changed", "$hooks");
        await visitDirectory(scoped, null, async (day) => {
            if (!isDay(day.name) ||
                day.node.kind !== "directory" ||
                day.node.permissionBits !== 0o700) {
                await scopedVisit(day);
                return;
            }
            if (options.sinceDay !== undefined && day.name < options.sinceDay)
                return;
            if (options.selectDay !== undefined && !options.selectDay(day.name))
                return;
            await options.onDirectory?.(fromWorkspaceRoot(day), "day");
            await visitDirectory(scoped, day.resourcePath, async (shard) => {
                if (!/^[0-9a-f]{2}$/u.test(shard.name) ||
                    shard.node.kind !== "directory" ||
                    shard.node.permissionBits !== 0o700) {
                    await scopedVisit(shard);
                    return;
                }
                if (options.recordId !== undefined && !options.recordId.startsWith(shard.name))
                    return;
                if (options.selectShard !== undefined && !options.selectShard(day.name, shard.name))
                    return;
                await options.onDirectory?.(fromWorkspaceRoot(shard), "shard");
                await visitDirectory(scoped, shard.resourcePath, scopedVisit, signal, order);
            }, signal, order);
        }, signal, order);
        const after = await root.inspectExistingResource(rootRef, "$hooks");
        if (!sameFileNodeIdentity(parent.node, after.node))
            fail("io-failure", "observation-scope-changed", "$hooks");
    }
    finally {
        await scoped.close();
    }
}
