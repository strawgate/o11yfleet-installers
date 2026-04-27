# Bug Hunt: 2026-04-27 Beta Sweep

## Run Summary

Two parallel agent sweeps across the o11yfleet codebase:
1. **API & Auth surface** — 9 findings
2. **DO, State Machine, WebSocket** — 10 findings

## Bugs Fixed Immediately (low-hanging fruit)

| Bug | Fix |
|-----|-----|
| verifyClaim accepts claims with missing `exp` (accepts forever-valid claims) | Added `typeof claim.exp !== 'number'` guard + required fields check |
| No max frame size in `decodeFrame` (OOM/CPU timeout attack) | Added `MAX_FRAME_BYTES = 256KB` check |
| handleListAgents returns 200 for non-existent config | Added existence check |
| Enrollment token handler swallows invalid JSON silently | Changed to `parseJsonBody` like all other handlers |
| No string length limits on name/description/label fields | Added 255/1024 char limits |
| No upper bound on `expires_in_hours` | Capped at 8760 (1 year) |
| `sweepStaleAgents` returns only UIDs → N+1 queries in alarm | Changed to return `{uid, tenant_id, config_id}` in one query |
| Missing SQLite indexes on agents table | Added `idx_agents_status`, `idx_agents_last_seen` |
| `emitEvents` drops remaining events on first Queue failure | Changed to `Promise.allSettled` |
| `ws.close()` in `webSocketError` crashes on already-closed socket | Added try/catch |

## Bugs to File as GitHub Issues

### Critical
- **AUTH-01**: API auth bypass when `API_SECRET` not configured — all API routes are unauthenticated by default

### High
- **RACE-01**: TOCTOU race in config creation limit check — concurrent requests can exceed plan limits
- **DUPE-01**: Duplicate `AGENT_DISCONNECTED` events on clean agent disconnect (agent_disconnect msg + webSocketClose)
- **STATE-01**: `uint8ToHex(undefined)` crash when agent sends CONFIG_FAILED without hash field
- **CAPS-01**: Inconsistent server capabilities (0x00000003 in enrollment vs 0x00000007 in processFrame)

### Medium
- **DEDUP-01**: CONFIG_APPLIED event emitted even when config hash unchanged (analytics over-count)
- **RATE-01**: Fixed-window rate limiter allows 2× burst at boundary

### Low
- **R2-01**: R2 config objects never deleted on config delete (unbounded storage growth)
- **CORS-01**: Wildcard CORS on admin API (amplifies AUTH-01)
