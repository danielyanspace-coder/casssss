# Casino demo wallet — 2026-11-01

Demo launches keep `demo: true` and use a separate `ld<userId>x<UTC day in base36>` provider identity. Real/bonus launches retain their existing `lb...` identity. `launchGame` rejects mismatched identities/modes before sending a request.

`casino-demo.js` owns two new tables (`casino_demo_wallets`, `casino_demo_tx`). A player's virtual balance is 30,000 RUB and resets lazily on the first access in a new UTC calendar day. It survives restarts and is shared between demo games. Old-day identities cannot mutate the new day's balance. No demo operation writes users, real casino history, money ledger, bonus or wager. Demo transaction batches are atomic and validate duplicate operations, insufficient funds and linked wins/refunds.

The authenticated `/api/casino/demo-balance` endpoint serves the demo frame. Public user/account responses do not expose this balance. The demo frame no longer displays or polls the real wallet. Real-wallet callback IDs explicitly marked as demo are rejected. No fallback from demo to real play exists.

## Provider verification — corrected after live check

Source: https://backoffice.aggregator.databetrix.com/documents/introduction — Launch game / StartGameRequest. Keep the documented `demo: true` flag and route the distinct demo `userId` to the operator demo wallet. A separate launch balance parameter is unnecessary when the provider requests the wallet balance through callbacks.

Live Sugar Rush check: legacy and isolated demo identities both opened successfully. The isolated demo game returned `balance=30000.00`, `balance_cash=30000.00`, `balance_bonus=0.00` from its own `/gs2c/ge/v5/gameService` initialization response. The callback created a corresponding 30,000 RUB demo wallet on our server. This verifies the connection from provider initialization to the separate operator demo wallet, beyond the website header. Earlier failed samples from other titles were incorrectly generalized as a balance integration limitation; they do not establish that limitation.

Validation: `node test/casino-demo.mjs`, `node test/casino-demo-ui.mjs`, existing `npm run test:casino`. The tests use isolated databases and mocked launches.

Deployment: service health OK, no restarts. Browser loaded release-20261101-demo without JavaScript errors. Anonymous demo-balance access returns HTTP 401. Zero changed real/bonus balances against predeployment backup. Existing casino suite: 110 checks plus cache/navigation tests passed; new demo backend/UI tests passed.

Live provider spin verified: Sugar Rush demo doSpin HTTP 200 changed balance from 30000.00 to 29840.00 (160 RUB virtual stake, zero win). The operator demo table recorded bet delta -160 RUB and win delta 0. Real balance, bonus balance, deposit debt, wager, casino bet/win counters and real casino history remained unchanged. The provider fun-mode flag remained true.
The 160 RUB verification stake was returned to the virtual wallet only, with a verification_refund entry in casino_demo_tx.

Agent accounting verification: GET /api/agent/get-balance was read before and after a separate minimum-stake Sugar Rush demo spin (16 RUB stake, zero win, demo wallet 30000 -> 29984). Agent RUB balance delta was exactly 0. The demo launch retained demo:true. The transaction listing includes the callbacks as bet/win rows; their presence alone does not prove an agent charge. Account snapshots are kept privately under /root/luckybox-demo-fix/.
Delayed repeat of the agent balance check: [{"currency":"RUB","delta":0}]. Real/bonus/wager fields and real casino history remained unchanged. The 16 RUB verification stake was restored to the virtual wallet only.
