# Episode-id architecture + egress cut

Status: Pending | In Progress | Complete

| # | Change | Status | Files/Tables |
|---|--------|--------|--------------|
| 1 | Per-ticker `hydratedAt` + 2 min TTL; skip hydrate on normal poll | Complete | `store.js`, `persist.js`, `engine.js` |
| 2 | `refresh=1` only on explicit refresh; no active-rail fan-out | Complete | `routes.js`, `SndkMomentumPanel.tsx` |
| 3 | `GET /api/momentum/:ticker/live` lightweight poll | Complete | `routes.js`, `SndkMomentumPanel.tsx` |
| 4 | Light `SELECT` (no `payload`) on hydrate/list | Complete | `persist.js` |
| 5 | Slim episode/event payloads; no research/tickets/devices dup | Complete | `mobilePayload.js`, `persist.js` |
| 6 | Persist ACTIVE episode only on material change + 8 min heartbeat | Complete | `persist.js` |
| 7 | Unified `momentum_research` + dual-write; keep class tables | Complete | SQL + `notifications.js` |
| 8 | Research fetched only on demand (API + desk UI) | Complete | `routes.js`, `persist.js`, `SndkMomentumPanel.tsx` |
| 9 | Paginated history; no auto hundreds of heavy rows | Complete | `store.js`, `routes.js`, desk list (limit=40 + Load more) |
| 10 | Split episodes by asset class; drop class research tables | Complete | `episodes_{stocks,indexes,forex,etfs,crypto,commodities}` + unified `research` |

## Remaining

- Legacy `episodes` is the unused backup of the old single table. Drop later once class tables have been live for a while.
- Desk-critical: `device_profiles` / `device_monitor`.
