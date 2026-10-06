# Cookie Tracker v4

Mobile-first web app for tracking school cookie inventory, reserved/future orders, sales, payment methods, discounts/deals, profit, and the amount owed to a brother/partner.

## Existing features retained
- Existing local data is preserved by keeping the same `cookieTrackerDataV1` localStorage key.
- Each cookie flavor has its own brother commission amount.
- Cash and Apple Pay sales are $6 per cookie; Tap to Pay is $7 per cookie.
- Direct sales record the payment method.
- Orders can store customer contact, meet location, due time, notes, payment method, and cookie quantities.
- Open orders can be edited; delivered orders can be undone; cancelled orders can be restored.
- Future orders can wait for stock and auto-reserve only when the complete order is available.
- Money shows daily/all-time revenue, brother share, payment methods, and **My profit**.

## v4 discounts + custom deals
- A direct sale or order can use **No discount**, a **$ Discount**, or a **Custom deal**.
- Discounts/deals are never selected automatically. The seller must choose one for that transaction.
- A reason is required whenever a discount or deal is used.
- The discount reduces the brother commission by the exact same amount, so the seller's profit does not decrease.
- The app blocks a discount that is larger than the brother commission available on that transaction.
- Custom deals are created in Settings with a cookie quantity and final deal price (example: 4 cookies for $20).
- A custom deal currently requires the transaction to contain exactly the deal quantity. This prevents accidental deal application to the wrong quantity.
- Tap to Pay still adds the existing $1-per-cookie premium; a custom deal reduces the $6 base price by its saved deal discount. Example: a 4-for-$20 deal is a $4 discount, so it totals $20 with Cash/Apple Pay or $24 with Tap to Pay.
- Sales history and CSV exports include the discount amount, type/deal, reason, brother total, and seller profit.
- Existing orders/sales are migrated as `No discount` and remain unchanged.

## Important
Before replacing files on GitHub, export a backup from the app. Code updates on the same GitHub Pages URL should preserve local data because the storage origin and key stay the same.
