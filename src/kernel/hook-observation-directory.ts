import type { WakeflowHostId } from "../contracts/vocabulary/wakeflow-host-id.js";
import {
  sameFileNodeIdentity,
  type FileNodeSnapshot,
} from "../foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectoryPage,
  readStableRootDirectoryPage,
  type StableDirectoryEntry,
} from "../foundation/filesystem/stable-directory-read.js";
import { fail } from "./error.js";
import { hostHookObservationsRootRef } from "./layout.js";

export const HOST_HOOK_FILE_NAME_PATTERN =
  /^(\d{8}T\d{9}Z)-(session-start|user-prompt-submit|stop|session-end|turn-complete)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;

/** New files partition by UTC day and record digest prefix; old flat files stay readable. */
export function partitionedHostHookRef(
  hostId: WakeflowHostId,
  fileName: string,
): PortableResourcePath {
  const match = HOST_HOOK_FILE_NAME_PATTERN.exec(fileName);
  if (match === null) throw new Error("Invalid hook observation file name.");
  return parsePortableResourcePath(
    `${hostHookObservationsRootRef(hostId)}/${fileName.slice(0, 8)}/${(match[3] as string).slice(0, 2)}/${fileName}`,
    "$record",
  );
}

function isDay(name: string): boolean {
  if (!/^\d{8}$/u.test(name)) return false;
  const iso = `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T00:00:00.000Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString() === iso;
}

const PAGE_SIZE = 2048;

async function visitDirectory(
  root: RootedDirectory,
  ref: PortableResourcePath | null,
  visit: (entry: Readonly<StableDirectoryEntry>) => Promise<void>,
  options: { readonly signal?: AbortSignal },
): Promise<void> {
  let afterName: string | undefined;
  let expectedNode: Readonly<FileNodeSnapshot> | undefined;
  for (;;) {
    const pageOptions = {
      maximumEntries: PAGE_SIZE,
      ...(afterName === undefined ? {} : { afterName }),
      ...(expectedNode === undefined ? {} : { expectedNode }),
      ...options,
    };
    const page =
      ref === null
        ? await readStableRootDirectoryPage(root, pageOptions)
        : await readStableResourceDirectoryPage(root, ref, pageOptions);
    expectedNode ??= page.directoryNode;
    for (const entry of page.entries) await visit(entry);
    if (!page.hasMore) return;
    afterName = page.entries.at(-1)?.name;
  }
}

/**
 * Only recognized private directories are traversed. Everything else is handed
 * to the record reader for diagnosis, never followed or removed as a directory.
 * Each directory has bounded pages and a stable snapshot across its pages.
 */
export async function visitHostHookDirectory(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  visit: (entry: Readonly<StableDirectoryEntry>) => Promise<void>,
  options: {
    readonly signal?: AbortSignal;
    readonly sinceDay?: string;
    readonly recordId?: string;
  } = {},
): Promise<void> {
  if (options.signal?.aborted === true) fail("io-failure", "aborted", "$signal");
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  const rootRef = hostHookObservationsRootRef(hostId);
  let parent: Awaited<ReturnType<RootedDirectory["inspectExistingResource"]>>;
  try {
    parent = await root.inspectExistingResource(rootRef, "$hooks");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") return;
    throw error;
  }
  const scoped = await RootedDirectory.open(parent.physicalPath, "$hooks");
  const scopedVisit = (entry: Readonly<StableDirectoryEntry>): Promise<void> =>
    visit(
      Object.freeze({
        ...entry,
        resourcePath: parsePortableResourcePath(`${rootRef}/${entry.resourcePath}`),
      }),
    );
  try {
    if (!sameFileNodeIdentity(parent.node, await scoped.assertCurrent("$hooks")))
      fail("io-failure", "observation-scope-changed", "$hooks");
    await visitDirectory(
      scoped,
      null,
      async (day) => {
        if (
          !isDay(day.name) ||
          day.node.kind !== "directory" ||
          day.node.permissionBits !== 0o700
        ) {
          await scopedVisit(day);
          return;
        }
        if (options.sinceDay !== undefined && day.name < options.sinceDay) return;
        await visitDirectory(
          scoped,
          day.resourcePath,
          async (shard) => {
            if (
              !/^[0-9a-f]{2}$/u.test(shard.name) ||
              shard.node.kind !== "directory" ||
              shard.node.permissionBits !== 0o700
            ) {
              await scopedVisit(shard);
              return;
            }
            if (options.recordId !== undefined && !options.recordId.startsWith(shard.name)) return;
            await visitDirectory(scoped, shard.resourcePath, scopedVisit, signal);
          },
          signal,
        );
      },
      signal,
    );
    const after = await root.inspectExistingResource(rootRef, "$hooks");
    if (!sameFileNodeIdentity(parent.node, after.node))
      fail("io-failure", "observation-scope-changed", "$hooks");
  } finally {
    await scoped.close();
  }
}
