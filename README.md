# Thai Agri Market

Direct-to-buyer marketplace for Thai fruit orchard owners. Farmers sell directly to buyers (domestic + international) without middlemen — platform acts as trusted intermediary.

**Status: Pre-development** — architecture and business flows designed, no code yet.

---

## Concept

| | |
|---|---|
| Problem | Thai fruit farmers sell through middlemen at low prices |
| Solution | Platform connecting orchards directly to buyers |
| Market | Domestic (Thailand) + International export |
| Revenue | Commission per transaction |

---

## Architecture

```
[LINE App]
  +-- LIFF (buyer/farmer webview) --> thai-agri-market-api (Go) --> MySQL
  +-- LINE Bot (notifications)    <-- thai-agri-market-api

[Browser]
  +-- Admin Dashboard (Next.js)  --> thai-agri-market-api

Payment: PromptPay QR (domestic) | Stripe/PayPal TBD (international)
Auth: LINE Login (farmers/buyers) | Firebase (admin staff)
Deploy: GitHub Actions -> Docker -> Kubernetes (DigitalOcean)
Envs: dev / staging / prd
```

## Repos (planned)

| Repo | Language | Role |
|---|---|---|
| `thai-agri-market-api` | Go 1.23+ | Backend REST API |
| `thai-agri-market-linebot` | Go | LINE notifications |
| `thai-agri-market-liff` | PHP 8.2 or Next.js | Buyer/Farmer LIFF webview |
| `thai-agri-market-admin` | Next.js | Admin dashboard |

---

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 - MVP | Farmer listing + Buyer order + Payment (domestic) | Not started |
| 2 - Export | International buyer flow, FX, logistics | Not started |
| 3 - Scale | Analytics, pricing intelligence, logistics partners | Not started |

---

## Phase 1 Core Flows

1. **Farmer registration** — LINE Login -> LIFF -> profile -> admin approval
2. **Product listing** — fruit type, variety, price/kg, qty, harvest date, photos
3. **Buyer browse & order** — filter by fruit/region/price -> place order -> payment
4. **Payment** — PromptPay QR -> platform escrow -> notify farmer
5. **Fulfillment** — farmer confirms -> ships -> buyer receives -> payout released
6. **LINE notifications** — order alerts, payment confirmed, shipment updates, payout

---

## Decisions Made

- [x] Stack: Go API + LINE LIFF/Bot + Next.js admin + MySQL
- [x] Auth: LINE Login for customers, Firebase->JWT for admin staff
- [x] Deploy: Docker + Kubernetes (DigitalOcean), 3 envs via build args
- [x] Phase 1 scope: domestic marketplace only

## Decisions Pending (resolve before build starts)

- [ ] LIFF framework: PHP 8.2 (simpler) or Next.js (unified stack)?
- [ ] Payment gateway domestic: Omise / 2C2P / PromptPay direct?
- [ ] Payment gateway international: Stripe or PayPal?
- [ ] Commission structure: flat % or tiered by volume?
- [ ] Escrow model: platform wallet or payment gateway holds funds?
- [ ] Logistics Phase 1: farmer self-manages or integrate Kerry/Flash/J&T?
- [ ] Dispute resolution flow

---

## Engineering Requirements (non-negotiable)

Learned from building prior LINE + payment platforms:

1. **All payment state changes wrapped in DB transaction** — dual-write without tx causes financial report drift
2. **Verify LINE token server-side** — never trust self-asserted `line_id` from LIFF client
3. **All payment webhooks HMAC-verified** — unsigned payment callbacks are a security gap
4. **API never calls LINE directly** — decouple via internal linebot service push endpoints

---

## Build Order (once decisions above are resolved)

1. Resolve pending decisions
2. Design DB schema (derive from Phase 1 flows above)
3. Setup Go project structure — API + auth + DB connection
4. Build listing + order endpoints
5. Build payment integration
6. Build LIFF (farmer + buyer)
7. Build LINE bot notifications
8. Build Next.js admin dashboard
9. Deploy dev environment

---

## Full Design Docs

Architecture, stack decisions, and detailed business flows:
`MY VAULT/wiki/syntheses/thai-agri-market/`

When starting any task, read vault context first:
- `_hub.md` — project overview + architecture
- `stack.md` — tech decisions + engineering patterns
- `business-flows.md` — Phase 1 flows in detail
