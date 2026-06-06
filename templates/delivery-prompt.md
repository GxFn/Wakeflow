Continue current window task: {{targetWindow}} / {{taskId}}.

Variables:
- currentWindow: {{targetWindow}}
- taskId: {{taskId}}
- stateRoot: {{stateRoot}}
- dispatchGroup: {{dispatchGroup}}
- skill: skills/wakeflow-target/SKILL.md

Rules:
- Read the skill and state root first.
- Do only this target task.
- Return a target result envelope with evidence refs.
- Do not create a next-hop delivery.
