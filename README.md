# Thai Agri Market

Managed seasonal orchard channel for Thai fruit orchards and urban buyers.

**Status: Pre-build — operator validation before software.**
Read vault context before starting any task: `MY VAULT/wiki/syntheses/thai-agri-market/`

---

## Pilot Model

Platform does not buy stock. Operators curate orchards, open finite harvest-window lots, run physical QC and packing checkpoints, use a logistics partner, and handle claims and reconciliation.

| Dimension | Decision |
| --- | --- |
| Business model | Managed marketplace — platform does not hold stock |
| First demand lane | B2C orchard drops |
| Parallel discovery | B2B cafe, restaurant, hotel, catering interviews |
| Supply area | 1-2 orchard provinces (TBD) |
| Delivery area | Bangkok and vicinity |
| Catalog | 3-5 seasonal fruits (TBD) |
| Launch channel | LINE OA + thin checkout + structured workbook |
| Logistics | Partner logistics |
| Payment | PSP-designed QR or payment-link after counsel review |
| Build posture | Manual-first. Automate only repeated, measurable pain |

---

## Build Gate

Software build is blocked until:

- 3 comparable paid drops completed
- Paid repeat behavior observed
- Positive lane-level contribution after variable costs
- Cash reconciliation closes
- Repeated manual pain measured

---

## Operator Docs (Vault)

| File | Content |
| --- | --- |
| `_hub.md` | Project overview and phase status |
| `operator-master-plan.md` | Business plan, team design, KPI, AI boundary, 90-day pilot |
| `business-flows.md` | Detailed pilot flows, actor map, approval boundaries |
| `stack.md` | Deferred tech decisions and engineering lessons |
| `gate0/` | Gate 0 operator packet — dry-run, checklists, decision register |

---

## Engineering Notes (Deferred)

Lessons from prior platform builds — apply when software build is authorized:

1. Wrap all payment state changes in DB transaction — dual-write without tx causes financial drift
2. Verify LINE token server-side — never trust self-asserted `line_id` from LIFF client
3. HMAC-verify all payment webhooks — unsigned callbacks are a security gap
4. API never calls LINE directly — decouple via internal linebot service endpoints
