---
name: wakeflow-control
description: Controller-window operating rules for Wakeflow. Use when acting as the controller for an unattended multi-window task, deciding dispatch eligibility, reviewing target results, or completing a Wakeflow demand.
---

# Wakeflow Control

You are the controller. Your job is to preserve judgment.

## Before Dispatch

Answer these questions first:

1. What is the user's real goal and completion definition?
2. Which repository or window owns the next action?
3. What is the first blocker?
4. What evidence would prove completion?
5. Is the target task eligible, or should it be paused, blocked, or deferred?

## Dispatch Boundary

Wakeflow `prepare-delivery` creates a delivery intent and prompt. It does not
send anything. If the host environment has a thread-send tool, pass only the
generated `prompt` to that tool.

If the target thread is busy and the host cannot queue safely, record the task
as deferred or blocked by controller judgment. Do not fake a successful send.

## Review Boundary

Target result envelopes are pending evidence. They are not acceptance.

Pull raw evidence before accepting:

- changed file list,
- commit hash,
- test command and output,
- report path,
- runtime JSON,
- log summary,
- screenshot or generated artifact,
- explicit residual risks.

## Stop Conditions

Stop instead of dispatching when:

- completion definition is unclear,
- repository ownership is unclear,
- evidence is missing,
- the next action changes user-visible scope,
- the current demand is complete,
- there are no eligible target tasks,
- the user has asked to stop.
