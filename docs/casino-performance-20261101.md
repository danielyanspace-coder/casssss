# Casino performance: 2026-11-01

Scope: browser shell around provider games. Provider iframe, game graphics, frame rate, wallet rules and backend are unchanged.

Changes:
- Pause hero slider timeouts, three decorative counter intervals, and two feed intervals while a game launches/plays; also pause these timers in a hidden tab.
- Pause CSS animations only in the covered app, header, sidebar and footer, excluding the game iframe and its controls.
- Keep current user data in memory during play; defer hidden shell updates until game exit.
- Disconnect nearby-image observation during play and prevent cover retries/resume from restarting downloads beneath the game.
- Preserve the balance text node when the displayed amount is unchanged.
- Poll balances sequentially, stop the timer in a hidden tab, refresh on return, and discard responses belonging to earlier game sessions.
- Discard a game launch response if the user has already left the casino.

Validation:
- Casino wallet: 110 checks; demo wallet isolation/transactions; home cache invalidation; casino navigation; unchanged demo balance UI checks.
- New lifecycle regression checks cover old demo/real responses, close refresh, slow polls, hidden-tab resume, stale launch and launch failure.
- Module import validation and startup checks, including standalone script parsing.
- Browser checks for startup/login/cashier, deferred fonts, mobile touch navigation and transient cashier failures.
- Existing performance UI suite passed after updating its local test copy to the current bonus markup: the old suite expected a removed `.cash-bonus-limit` element. Product bonus code is unchanged.
- Browser fixture comparison over 8.5 seconds: hidden app/footer child/text mutations 31 before versus 0 after; five shell intervals plus old balance interval reduced to zero intervals, with one sequential balance timeout. Provider canvas continued rendering.
- Twenty open/close cycles retained zero game iframes and exactly the original five shell intervals after close; hidden-tab polling stopped/resumed correctly.
- Built release tested at 390px and 1280px: two demo launch/close cycles at each size, correct demo balance refresh, active provider animation, no browser JS exceptions.

Tests use an animated provider fixture and isolated development database, without real wagers. Desktop/browser measurements are not phone temperature or battery measurements. Provider-side CPU/GPU cost remains outside the embedding site's direct control.

Deployment: versioned assets followed by atomic HTML replacement; no backend restart or database changes. Backup: `/srv/luckybox/backups/casino-performance-20261101`.

Post-deployment checks: HTTPS entry serves the new release; assets return HTTP 200 with gzip; luckybox and nginx services remain active; deployed lifecycle regression test passes.

Published HTTPS build passed the same 390px/1280px browser checks with intercepted demo launch/balance responses: two launch/close cycles per viewport and no JavaScript exceptions.
