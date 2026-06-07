---
name: vertical-slice-requirement-planning
description: Use in a Wakeflow Design window to break a confirmed requirement into user-value slices, producer/consumer order, and evidence boundaries before controller intake.
---

# Vertical Slice Requirement Planning

Use this skill when a requirement is large enough to need phases, but not yet
clear enough for Wakeflow task packages.

## Inputs

- Confirmed goal and completion definition.
- User scenario and edge or failure scenario.
- Known repositories, consumers, integrations, and runtime surfaces.
- Existing validation or code-fact evidence.

## Method

1. Restate the final user-visible outcome.
2. Identify the smallest end-to-end slice that changes real behavior or
   decision quality.
3. For each candidate slice, name:
   - user value or operational value;
   - source owner and consumer;
   - input, output, and state/data change;
   - required evidence;
   - invalid conclusion the slice must not imply.
4. Order slices by producer/consumer dependency, not by implementation
   convenience.
5. Keep contract-only slices only when they name the real consumer and the next
   consumption step.

## Output

- Slice table with title, owner, consumer, value, evidence, and stop rule.
- Producer/consumer order.
- Items that require code-fact research before dispatch.
- Items that require user or controller decision before execution.

## Stop Conditions

- The proposed slice has no observable behavior, consumer, or evidence.
- The plan hides missing functionality behind an abstraction or empty bridge.
- Phase order would change the user's original completion definition.
