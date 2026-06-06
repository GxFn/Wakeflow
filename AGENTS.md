# Wakeflow Agent Instructions

Wakeflow is a local-first unattended control-loop plugin for multi-window agent
work. It packages control-plane skills, templates, and helper tools. It does not
own product code and it does not secretly send prompts to other agent threads.

## Hard Boundary

- Do not implement hidden background delivery.
- Do not call host-only thread tools from ordinary Node.js scripts.
- Treat generated delivery intents as transport-ready data, not proof of work.
- Treat target results as evidence to review, not acceptance.
- Keep real thread ids and local runtime state outside Git.
- Keep repository changes scoped to Wakeflow unless the user explicitly asks for
  a cross-repository change.

## Normal Workflow

1. Clarify the user's goal, completion definition, repository boundary, and
   first blocker.
2. Use Wakeflow helpers to create or inspect a local state root.
3. Create task packages only for eligible target windows.
4. Generate delivery intents and let the host environment perform any real
   thread send.
5. Import target result evidence.
6. Review raw evidence before marking work accepted, blocked, or complete.

## Validation

Before handing back plugin changes, run:

```sh
npm test
python3 /Users/gaoxuefeng/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

If the Codex plugin validator path is unavailable on another machine, run
`npm run validate` and document that plugin manifest validation could not be
performed.
