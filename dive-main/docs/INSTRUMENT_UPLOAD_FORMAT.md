# Instrument Data Upload — File Format Guide

`/admin` → **Instruments** → **Upload data manually**. This lets you add or refresh real instrument
data for one asset class at a time, straight from a CSV file you prepare (Excel or Google Sheets,
saved/exported as CSV) — no waiting on a live data source, and no code change needed.

## Why this exists

Three of the app's asset classes never had a live public data source to begin with —
**REIT, InvIT, and BOND** — and a fourth, **ULIP_INSURANCE**, is proprietary insurer product data
that no public feed publishes either. Those four have always relied on a small, hand-typed list
(`backend/src/seed/staticInstruments.ts`). A fifth, **MUTUAL_FUND**, does have a live source
(AMFI's public scheme list) — but AMFI's servers are currently unreachable from this app's server
specifically (confirmed: the connection is silently dropped at the network level, consistent with
AMFI filtering known cloud-provider IP ranges — see `docs/PROTOTYPE_LIMITATIONS.md`). It still works
fine from a normal home/office connection, which is why local development looks unaffected.

This upload feature is the fix for both situations: real coverage for these classes, sourced by
whoever maintains the app, independent of whether a live feed exists or is currently reachable.

## The rules, in plain terms

1. **One file, one asset class.** You choose the asset class in the upload panel; the file only
   needs to contain instruments of that one kind.
2. **Only the instrument's name is required.** Every other column is optional. If a mutual fund's
   row has no underlying-holdings column, or that column is misspelled, it still gets added — with
   everything else it *did* have. Only a row with no name at all is skipped, and it's the only kind
   of row that is.
3. **A bad value in a column never fails the row either.** If a "NAV" cell contains text instead of
   a number, that one field is simply left blank — the row (and the rest of its columns) still goes
   in, and the summary after upload tells you exactly which row and column that was.
4. **Uploading a new file UPDATES matching instruments and ADDS new ones — it never deletes by
   default.** This is the whole point of a re-upload: getting a fresh price/NAV for instruments you
   already have, the same way a live source refresh does for Equity or Mutual Fund. For this to work,
   the SAME instrument needs to be recognized as the SAME instrument across uploads — see "Why you
   should always include a Symbol/ISIN/Scheme Code" below. Concretely:
   - a row whose Symbol/ISIN/Scheme Code (or, lacking one, whose derived symbol) matches an instrument
     already on file gets that instrument's data **updated field-by-field** — only the columns THIS
     file actually has for that row are touched; any field the file leaves out (e.g. a "just the
     price" file that skips Sector) simply keeps whatever was recorded for it last time, exactly like
     a live-source refresh already behaves for fields it doesn't touch;
   - a row that doesn't match anything on file is **added** as a new instrument;
   - an instrument from an earlier upload that this file simply doesn't mention is **left exactly as
     it is** — normal and expected for a lean, "just the updated price" file. It is not an error and
     nothing about it is touched.

   It also never touches:
   - live-sourced data for the same class (e.g. uploading Mutual Funds never touches what AMFI
     already provided, if AMFI becomes reachable again);
   - the bundled starter list (`source: "SEED"`) for the same class;
   - any other asset class's data, uploaded or otherwise.
5. **Removing an instrument that's genuinely gone is a separate, opt-in step.** Check
   **"Also remove instruments not in this file"** only when the file you're uploading is the complete,
   current list for that asset class and anything it doesn't mention is actually delisted/wound up —
   not just something a leaner file happened to skip. Leave it unchecked for a normal price/data
   refresh.
6. **An instrument someone already holds is never deleted out from under them**, even with the
   remove-missing option checked. If a user's portfolio references a row that would otherwise be
   removed, that specific row is kept (just taken out of search results for new holdings) instead of
   being removed — the upload summary tells you how many rows this applied to, if any.
7. **A file this large is bounded**: at most 20,000 rows are read from one file (comfortably more
   than any of these asset classes actually has).

## How to upload

1. `/admin` → **Instruments** → **Upload data manually** (click to expand).
2. Choose the **asset class** this file is for.
3. Choose the **CSV file**.
4. Leave **"Also remove instruments not in this file"** unchecked for a normal update/refresh; only
   check it if this file is the complete, current list and anything missing from it is genuinely gone.
5. Click **Upload**, then confirm.
6. Read the summary: how many instruments were added, how many existing ones were updated, how many
   (if you checked remove-missing) were removed or instead kept because a holding references them,
   and the full list of any skipped rows or fields that couldn't be read. For a Mutual Fund file with
   an Underlying Holdings column, it also tells you how many funds fed a draft update to the
   Look-Through Model (see "Where this data is used today" below).

## Column names — how matching works

Column headers are matched **case-insensitively**, ignoring spaces, underscores and punctuation —
`"Scheme Name"`, `scheme_name`, and `SchemeName` are all read the same way. You don't have to match
the exact header text below; any of the listed aliases works.

**Recognized columns** (all optional except Name):

| What it means | Recommended header | Also accepted | Where it's stored |
|---|---|---|---|
| Instrument name | `Name` | Instrument Name, Scheme Name, Company Name, Fund Name, Security Name, Title | the instrument's name |
| A code to identify it by | `Symbol` | Ticker, Code, Scheme Code, Instrument Code | the instrument's symbol (see "About the Symbol/ISIN column" below) |
| ISIN | `ISIN` | ISIN Code | symbol fallback + kept as its own field |
| Issuer / fund house | `Issuer` | AMC, Fund House, Sponsor, Company, Bank, Insurer | the instrument's issuer |
| Exchange | `Exchange` | Listed On, Listing Exchange | the instrument's exchange |
| Sector / segment | `Sector` | Segment, Industry | sector |
| Category / class | `Category` | Class, Type, Plan Type, Bond Class, Class of Bond, Subtype | category |
| Price / NAV | `NAV` | Price, Unit Price, Current Price, NAV Value | price (must be a plain number, e.g. `145.23`) |
| Price / NAV as-of date | `NAV Date` | Price Date, As Of, Valuation Date | price date |
| Annual return | `Annual Return` | Coupon Rate, Coupon, Yield, Expected Return, Return % | annual return % (a plain number, e.g. `7.2` for 7.2%) |
| Credit rating | `Credit Rating` | Rating | credit rating |
| Maturity date | `Maturity Date` | Maturity | maturity date |
| Expense ratio | `Expense Ratio` | TER | expense ratio % |
| Underlying holdings | `Underlying Holdings` | Top Holdings, Holdings, Portfolio Holdings | a structured list — see below |

**Any other column name** is still kept — under its own header (lowercased, spaces turned to
underscores) — even though it isn't in the table above. Nothing you put in the file is silently
thrown away; only the columns above get special handling (numbers parsed, dates recognized, etc.).

### Why you should always include a Symbol/ISIN/Scheme Code

This column is technically optional — leave it blank and a symbol is generated from the instrument's
name instead — but **filling it in is what makes a re-upload actually update the right instrument
instead of adding a duplicate.** The regulator/exchange-issued code (a mutual fund's AMFI Scheme
Code, a bond/REIT/InvIT's ISIN, an insurer's plan code) is the one thing that reliably identifies
"this is the same instrument" across two different files — a name alone can drift slightly between
exports (extra whitespace, a renamed plan, "Direct" vs "Growth" suffixes) in a way a code won't. Put
the same code in the Symbol or ISIN column every time you upload data for that instrument, and its
price/NAV/other fields will update in place on every re-upload instead of silently creating a second,
separate row.

Whatever you provide (or whatever gets generated from the name when you don't) is still kept as an
internal identifier distinct from a live source's own codes, on purpose: it means an uploaded row can
never be silently overwritten (or wiped) if a live source for the same asset class later becomes
reachable again, and a live source can never silently overwrite an uploaded row either. The two are
kept in two separate lanes. You'll never see this internal prefix anywhere in the app.

### The Underlying Holdings column

Format: `Company Name:Weight%`, separated by semicolons. For example:

```
Reliance Industries:8.5;HDFC Bank:6.2;Infosys:4.1
```

A piece with no `:weight` (just a company name) is still kept, just without a weight. A piece
with an unreadable weight is kept with just its name too — nothing in this list is ever dropped
for a formatting slip elsewhere in the same cell.

## Example files, per asset class

### Mutual Fund

```csv
Name,Symbol,Issuer,Sector,NAV,Underlying Holdings
HDFC Flexi Cap Fund,118989,HDFC Mutual Fund,Flexi Cap,145.23,"Reliance Industries:8.5;HDFC Bank:6.2;Infosys:4.1"
ICICI Prudential Corporate Bond Fund,120505,ICICI Prudential Mutual Fund,Debt,28.91,
SBI Contra Fund,101761,SBI Mutual Fund,Contra,312.45,"Tata Motors:5.1;State Bank of India:4.8"
```

(`Symbol` here is each fund's AMFI Scheme Code — re-uploading with the same code next month, with just
an updated NAV column, refreshes these same three funds instead of adding three new ones.)

### Bond

```csv
Name,Symbol,Issuer,Category,Annual Return,Credit Rating,Maturity Date
NHAI Tax-Free Bond 2031,INE906B07EJ2,National Highways Authority of India,Tax-Free,7.2,AAA,2031-03-15
HDFC Bank Perpetual Bond,INE040A08587,HDFC Bank,Corporate,8.1,AA+,
Government of India 10-Year G-Sec,IN0020240012,Government of India,Government,7.05,Sovereign,2036-01-01
```

(`Symbol` here is each bond's ISIN.)

### REIT

```csv
Name,Symbol,Exchange,Sector,NAV,Annual Return
Embassy Office Parks REIT,INE0CCU25019,NSE,Commercial Real Estate,340.5,6.8
Mindspace Business Parks REIT,INE0FS301017,NSE,Commercial Real Estate,315.2,7.1
```

### InvIT

```csv
Name,Symbol,Exchange,Sector,Annual Return
IndiGrid InvIT,INE121K01018,NSE,Power Transmission,11.2
IRB InvIT Fund,INE0BWM23011,NSE,Roads & Highways,9.5
```

### ULIP / Insurance

```csv
Name,Symbol,Issuer,Category,Annual Return
HDFC Life SmartWealth Plan,HDFCL-SWP-01,HDFC Life,Wealth ULIP,9.8
SBI Life Smart Wealth Builder,SBIL-SWB-01,SBI Life,Wealth ULIP,10.1
```

(No public registry issues a per-plan code for ULIPs the way ISIN/AMFI codes exist elsewhere — use
whatever stable internal product code your source data has, as long as you reuse the same one on
every re-upload for that plan.)

For the other asset classes (Equity, ETF, Gold, Silver, FD, Crypto, PF) the same file shape works —
just `Name` plus whichever of the recognized columns you have real data for. Most of these already
have a working live source, so you'd only use this for a specific gap (say, a newly listed ETF the
live feed hasn't picked up yet).

## Which columns feed Ask DIVE's fundamental/technical view, per asset class

`/` → **Ask DIVE**, when a user looks up an instrument, tries a live source first (Yahoo Finance for
NSE-listed Equity/ETF/REIT/InvIT/Gold/Silver, MFAPI.in for Mutual Funds, CoinGecko for Crypto). **This
live lookup can never succeed for an uploaded instrument** — every uploaded row's Symbol is
deliberately namespaced (see "Why you should always include a Symbol/ISIN/Scheme Code" above)
specifically so a live refresh can never collide with or overwrite it, but that exact same namespacing
means Yahoo/MFAPI/CoinGecko can never recognize it either. Without a fallback, this would mean Ask
DIVE just says "not available" for every uploaded instrument, no matter what you filled in.

So it falls back to showing **exactly what you uploaded**, clearly labeled "Provided by admin
(manually uploaded, not live-priced)" — never blended with or mistaken for a live quote. Fill in the
columns below (per asset class) so a user looking up this instrument on Ask DIVE actually sees
something useful instead of a blank "not available":

| Asset class | Columns that show up on Ask DIVE |
|---|---|
| **Mutual Fund** | `NAV`, `NAV Date`, `Annual Return`, `Expense Ratio`, `Sector`, `Underlying Holdings` (shown as its own "Top holdings" list) |
| **Bond** | `Annual Return` (coupon/yield), `Credit Rating`, `Maturity Date` |
| **REIT / InvIT** | `NAV`, `NAV Date`, `Annual Return`, `Sector` |
| **ULIP / Insurance** | `Annual Return` |
| **FD** | `Annual Return` (the fixed rate) |
| **Equity / ETF / Gold / Silver / Crypto / PF** | Same fields as above, whichever apply — only relevant if you're uploading one of these to fill a gap the live feed missed (see previous section); once a live source picks it up again, that takes over automatically |

**`Category`/`Class`/`Type` is stored and shown in the admin Instruments list, but does NOT currently
appear on Ask DIVE or feed any scoring calculation** — it's the one canonical column that's purely
informational today. `Sector` is the one that matters for both Ask DIVE's fallback view AND the Dive
Score's diversification/quality analysis (X-Ray), so prioritize filling that in over `Category` if you
only have time for one.

**`ISIN`, `Issuer`, `Exchange`** don't appear in the fundamental/technical card either — those are used
for identity (search/autocomplete, the Instruments admin list) and cross-instrument connectedness
matching (the Look-Through Model's exact-issuer-match tier), not fundamentals display.

## What the upload summary tells you

After uploading, you'll see:

- how many **new** instruments were added from the file;
- how many **existing** instruments were updated (matched by Symbol/ISIN/Scheme Code);
- if you checked "also remove instruments not in this file": how many were removed, and how many were
  instead **kept (retired)** because a user's holding still references them;
- for a Mutual Fund file with an Underlying Holdings column: how many funds fed an update to the
  Look-Through Model's draft config (see below), and how many were skipped for having no usable weight;
- every **skipped row**, with the reason (always "no name");
- every **field that was left blank**, with the reason (a value that wasn't a valid number, listed
  by row).

Nothing in this list means the whole upload failed — it tells you exactly what, if anything, needs
a second look in your source file.

## Where this data is used today

An uploaded instrument shows up in search/autocomplete (when adding a holding) and in the Instruments
admin list, the same as any live-sourced one. Fields like Sector feed the app's look-through /
diversification analysis the same way a live-sourced instrument's sector does.

**Ask DIVE's instrument-lookup screen** now shows whatever you uploaded (NAV, Annual Return, Credit
Rating, Maturity Date, Expense Ratio, Sector, Underlying Holdings — see the table above) when its own
live lookup can't resolve the instrument, which for an uploaded row is always the case. It's clearly
labeled as admin-provided, not live, so a user never mistakes it for a real-time quote.

**Underlying Holdings** on a Mutual Fund upload also feeds the Look-Through Model's curated
`mutualFundTopHoldings` map directly (`/admin` → **Look-Through Model**) — this is what lets the
Dive Score's look-through analysis detect that a fund you hold also holds a stock you hold directly.
For each fund present in your file with at least one holding that has a readable weight, that fund's
holdings entry in the Look-Through Model is **replaced** with what's in the file; every other fund's
entry — whether hand-curated by an admin or from an earlier upload — is left completely untouched, and
a fund from an earlier upload that this file simply doesn't mention keeps its existing holdings.

This update lands as a **draft**, the same as any other Look-Through Model edit — it does not affect
live Dive Score calculations until an admin reviews it on the Look-Through Model screen (where, with
8000+ possible funds, a search box lets you find the fund you just uploaded rather than scrolling) and
clicks Publish. This is deliberate: a bulk file upload shouldn't be able to change live scoring without
a human checking it first, same as every other scoring config in this app.

## Related docs

- `docs/PROTOTYPE_LIMITATIONS.md` — the AMFI-from-cloud-IP issue this feature is partly a workaround for.
- `docs/ADMIN_PANEL_PLAN.md` — the changelog entry for when this shipped.
