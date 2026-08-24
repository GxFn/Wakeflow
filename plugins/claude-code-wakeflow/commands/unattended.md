---
description: Preview a Claude unattended-policy change while enforcing the v3 activation-scope gate
argument-hint: "[on|off]"
---

Changing Claude permission mode is an intentional desired-model change, not a
helper-side config edit.

1. Resolve `on` to the explicit unattended permission choice and `off` to the
   safe attended choice. If absent, ask the user.
2. For `on`, require explicit confirmation that host actions may proceed
   without per-action prompts.
3. Obtain the v3 Claude activation-scope observation. Only exact
   `per-workspace` coverage may be machine-verified. `unknown` or `host-wide`
   coverage blocks unattended activation; do not add a global workspace
   registry or extrapolate from one migrated workspace.
4. Build the complete desired v3 selection and call
   `wakeflow_maintain_workspace action=reconfigure mode=preview`. Show the exact
   plan and wait for confirmation, then apply only that returned plan/digest.
5. Window restarts/replacements are separate host effects through the v3
   activation owner and typed binding tools. If that owner is unavailable,
   leave the config plan unapplied or report the post-apply activation blocker
   honestly; never use the public-v2 `set-unattended`/window-host writer.

Turning off does not require the extra risk confirmation but still follows the
same preview/apply and exact-host-effect boundaries.

$ARGUMENTS
