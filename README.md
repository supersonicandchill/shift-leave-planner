# Shift & Leave Planner

A 24/48 shift calendar and leave tracker. Plain HTML, CSS and JavaScript. No backend, no accounts. Your data stays in your browser (localStorage). Designed for iPhone first; works on iPad and desktop.

**Live:** https://supersonicandchill.github.io/shift-leave-planner/

## Use it
Open the page, then use the **?** buttons (Calendar filters) and the **Help** tab. Quick version:
1. Settings: title each calendar and set its start date (defaults 1/2/3 Unit = Jan 1/2/3 2027). Each works every 3rd day; Feb 29 is shown but never counted, and the cycle resumes Mar 1.
2. Year view shows all 12 months full size: dots are taken spots (top row First 12, bottom row Second 12, red = full), chips at the top jump to a month, tap any day to open or add.
3. Pick your calendar ("Only my calendar"), tap a date, choose what / who / First 12, Second 12 or Whole 24.
4. Max 3 people off per half-day. Full halves are disabled before you can pick them.
5. **My plan** (top of the Leave tab): your tentative vacation, personal and EDO picks in priority order (↑ ↓ to reorder, any month of the year). **Got it** marks a day as yours; **Taken** strikes it out when someone else gets it first. Taken days stop counting toward your hours and free the spot so you can enter who took it. **Restore** brings one back if the day still has room.
6. Leave tab: balances and projections (shortfalls flagged). Export tab: ICS, print (blank or filled), JSON backup/restore.

## Run locally
    npm install
    npm test          # 66 engine + 43 UI tests
Open index.html in a browser (no build step).

## Things to confirm (not in the CBA text)
- Pay-period calendar and whether accrual posts at period start or end (toggle in Settings; default end).
- Excess over the 264 h carryover is used first, then forfeited/converted Mar 31.
- Feb 29 is treated as not existing for rotation (CBA Art. 24 only describes the 8-day cycle).
- A person can't hold overlapping halves of one date (this also blocks sick + vacation in the same half).

## Known limits
- ICS output follows RFC 5545 but was not tested in Apple/Google Calendar here.
- Print checked via Chromium PDF only, not on a physical printer or iOS Safari.
- Data is per browser/device; use JSON backup to move it.
