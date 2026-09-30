# Cookie Tracker v2

Mobile-first web app for tracking school cookie inventory, orders, sales, payment methods, and the amount owed to a brother/partner.

## v2 changes
- Existing local data is preserved by keeping the same `cookieTrackerDataV1` localStorage key.
- Each cookie flavor has its own brother commission amount.
- Cash and Apple Pay sales are $6 per cookie; Tap to Pay is $7 per cookie.
- Direct sales record the payment method.
- Orders can store customer contact, meet location, due time, notes, payment method, and cookie quantities.
- Open orders can be edited.
- Delivered orders can be undone, which restores inventory and removes the linked sale.
- Cancelled orders can be restored.
- Money view shows payment-method totals and commission totals by flavor.
- Service worker uses network-first updates so future GitHub Pages changes appear more reliably while offline support remains.

## Important
Before replacing files on GitHub, export a backup from the app. Code updates on the same GitHub Pages URL should preserve local data because the storage origin and key stay the same.


## v3 update
- Future orders can be saved even when there is not enough stock yet. Choose **Future order · auto-reserve** and the app will move the order to Reserved automatically once the full order is available.
- Auto-reserve checks whenever stock is changed and whenever the app opens. Waiting orders are prioritized by due date, then creation time.
- Money now shows **My profit** (sales revenue minus the brother commission locked into each sale).
- Money has All time / Today controls, previous/next day arrows, and a date picker for daily totals.
- The storage key is unchanged (`cookieTrackerDataV1`), so existing stock, orders, sales, commissions, and payment history remain on the same GitHub Pages app after updating.
