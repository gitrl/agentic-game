# Design Templates

## 1. Agent I/O Template

Use this per Agent.

```markdown
### <Agent Name>
- Responsibility:
- Inputs:
- Outputs:
- Failure Signals:
- Fallback Strategy:
- Notes:
```

## 2. Prompt Pack Template

```markdown
## System Prompt
- Role:
- Non-negotiable constraints:
- Output format constraints:

## Style Prompt
- Narrative tone:
- Legal reasoning tone:
- Forbidden patterns:

## Audit Prompt
- Consistency checks:
- Anti-repetition checks:
- Schema checks:

## Recovery Prompt
- Trigger conditions:
- Repair targets:
- Safe fallback output:
```

## 3. Exception Matrix Template

```markdown
| Exception Type | Detection Signal | Auto-Retry | Degrade Path | User-Facing Behavior |
|---|---|---|---|---|
| No response | timeout | yes | safe narrative template | show retried turn |
| Invalid JSON | parse error | yes | strict schema re-ask | hide raw model output |
| Logic conflict | audit fail | optional | invoke recovery agent | continue with repaired turn |
| Repetition loop | similarity threshold | yes | force new evidence/conflict | show fresh options |
```

## 4. Replay Record Template

```json
{
  "session_id": "string",
  "turn": 0,
  "player_action": {},
  "narrative_summary": "string",
  "state_patch": {},
  "event_tags": [],
  "token_usage": {
    "input_new": 0,
    "input_cached": 0,
    "output": 0
  },
  "timestamp": "ISO-8601"
}
```

## 5. Delivery Checklist Template

```markdown
- [ ] World package v1
- [ ] Agent I/O spec + error codes
- [ ] Prompt pack (system/style/audit/recovery)
- [ ] Exception matrix
- [ ] Replay schema + evaluation export format
- [ ] Milestone plan for stable 30/50 turns
```
