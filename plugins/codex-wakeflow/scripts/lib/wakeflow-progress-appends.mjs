import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolveStateRootFilePath } from "./wakeflow-state-paths.mjs";

// The execution timeline: reducers append one human-readable line per real
// action into the demand's developer-progress.md, under the three append-only
// sections the template ships ("Task Packages" / "Backfill Summaries" /
// "Decisions And Append Log"). render-progress only rewrites the
// unified-status marker block, so these lines survive every re-render — and
// they ride the archive copy, keeping the execution story readable after the
// demand leaves the active layer.
//
// Timeline lines are PROJECTION, never authority: the events jsonl stays the
// audit truth. Appends must therefore never fail a state mutation — callers
// wrap this in appendProgressTimeline() which degrades to a returned warning.

export const PROGRESS_SECTIONS = {
  taskPackages: "Task Packages",
  backfill: "Backfill Summaries",
  decisions: "Decisions And Append Log",
};

function progressDocFile(stateRoot, state) {
  return resolveStateRootFilePath(
    stateRoot,
    state?.projection?.progressDoc ?? "developer-progress.md",
    {
      label: "progress document",
      requireExisting: true,
    },
  );
}

export function appendProgressLine(stateRoot, state, section, line) {
  const file = progressDocFile(stateRoot, state);
  if (!existsSync(file)) return { appended: false, reason: "progress doc missing" };
  const content = readFileSync(file, "utf8");
  const heading = `## ${section}`;
  const entry = `- ${line}`;
  let next;
  const headingIndex = content.indexOf(`\n${heading}\n`);
  if (headingIndex < 0) {
    // Older docs may lack the section: create it at the end.
    next = `${content.trimEnd()}\n\n${heading}\n\n${entry}\n`;
  } else {
    const sectionStart = headingIndex + heading.length + 2;
    const nextHeading = content.indexOf("\n## ", sectionStart);
    const insertAt = nextHeading < 0 ? content.length : nextHeading;
    const before = content.slice(0, insertAt).replace(/\n+$/, "\n");
    const after = content.slice(insertAt);
    next = `${before}${entry}\n${after}`;
  }
  const temp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, next);
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // best effort
    }
    throw error;
  }
  return { appended: true };
}

// Never let a projection append break the state mutation it narrates.
export function appendProgressTimeline(stateRoot, state, section, line) {
  try {
    return appendProgressLine(stateRoot, state, section, line);
  } catch (error) {
    return { appended: false, reason: error.message };
  }
}
