# Cookie Tracker v6 — regular + jumbo, adjustable prices and cuts

This is a **full app** update that includes everything from v5 (which you never installed): rename a cookie, change its payouts, delete/archive an empty inactive cookie, and restore it later.

## What's new

- Regular and **Jumbo (8 oz)** entries for the same flavor. Each size has separate inventory, reservations, cash/Apple Pay price, Tap to Pay price, and brother cut.
- Inventory → **+ Jumbo** next to an existing regular flavor pre-fills a new 8 oz option at $7 cash, $8 Tap, brother $5, mine $2. Every number is editable.
- Inventory → **Edit** to rename, change size, change both customer prices, adjust your share or your brother's share, or remove unused cookies. Editing one cut updates the other so the two add up to the cash price.
- Sales and Orders offer an optional **Custom charge** control to enter an actual final charge and reason, while keeping the brother payout fixed. For example, $7 regular price, $5 brother share, $2 your share becomes $10 actual charge, $5 brother share, $5 your share. **The actual $10 sale and $5 profit appear in Money, orders, and exports**. This is intentional so the records stay accurate.
- Previous features preserved: custom deals, discounts, payments, future auto-reserved orders, undo delivery, daily profit filtering and backups.

## How to update your GitHub Pages site

**First:** On the existing Home Screen app, export a JSON backup (Settings → Export backup) and store it privately in Files/iCloud Drive. Do not upload backups to public GitHub.

1. Extract `Cookie_Tracker_Update_v6.zip` on your device.
2. In your GitHub `Cookie-Tracker` repository, replace **at repository root**: `app.js`, `index.html`, `styles.css`, `sw.js`, `README.md`.
3. Commit the changes to the branch that GitHub Pages publishes (typically `main`). Do not delete or replace your `icons` folder or `manifest.webmanifest` when using the update-only zip.
4. After GitHub's Pages deployment succeeds, fully close and reopen the Home Screen app. If it still shows the old version, refresh your existing Pages URL in Safari and reopen.
5. Confirm your old inventory/orders/sales/commissions are still there. Keep the export backup for recovery.

## Data protection and limits

The application intentionally retains the existing `cookieTrackerDataV1` key, with migration for older flavor entries that had no size/prices. Historical sales totals and brother commissions are not rewritten. Local browser storage is not a cloud backup; use Export Backup to protect your data. A website update alone does not sync data across devices.

**Accounting:** Revenue, payments, your profit, and sales CSV always reflect the real amount charged. You can set any legitimate selling price, fee or payout, but the app does not include hidden or falsified accounting views.
