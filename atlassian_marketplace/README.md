# Atlassian Marketplace for eazyBI

Imports the app licenses and the sales transactions of an
[Atlassian Marketplace](https://marketplace.atlassian.com/) vendor into eazyBI as a cube named
**Atlassian Marketplace**, so that you can report on revenue, renewals, evaluations, partner sales
and the customers behind them.

## Connecting

1. Create an API token for your Atlassian account at
   [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens). The account
   needs a role on the developer space which may read the licenses and the sales reports.
2. Find your **developer space ID** in the address of the Atlassian Marketplace partner portal
   pages. Both forms are accepted: the developer space UUID
   (`00000000-1111-2222-3333-444444444444`) and the numeric vendor ID (`123456`), which eazyBI
   resolves into the UUID itself.
3. Enter the developer space ID, your Atlassian account email and the API token on the eazyBI
   connection page.
4. Select the apps to import.

## Import options

| Option | Default | Effect |
|---|---|---|
| Import licenses | on | imports the app licenses and their maintenance periods |
| Import sales transactions | on | imports the sales with their prices, vendor amounts and discounts |
| Include Atlassian licenses | off | includes the licenses of Atlassian's own accounts |
| Import transactions of | all history | how far back the **first** import reads the sales transactions; licenses are always imported in full |

Changing any of them makes the next import re-import everything, so that the data matches the new
selection.

## What is imported

The Marketplace answers a vendor's licenses and transactions only through an asynchronous export:
eazyBI requests the export, waits until the Marketplace has prepared it, and then reads the
downloaded CSV file row by row — so an export of any size can be imported.

| Object | Becomes |
|---|---|
| Apps | the App dimension and the list of apps you select from |
| Licenses | the License dimension, the Licenses and Licenses ending measures |
| Sales transactions | the Transaction dimension, the sale amounts and the maintenance measures |
| Customers, partners, countries | the Customer, Partner and Country dimensions of both |

### Dimensions

| Dimension | Members |
|---|---|
| App | the apps of the developer space |
| License | one member per license, with its dates, contacts, entitlements and hosting as properties |
| Transaction | one member per transaction line, with its dates, amounts and reasons as properties |
| Customer | the billing organization of a license or a transaction |
| Partner | the reselling partner. The main hierarchy has the partner alone, so that all sales of one partner add up even when the Marketplace reported them under different partner types; the **Group** hierarchy joins the subsidiaries of one partner (see below); the **Type** hierarchy splits them by Expert, Reseller, Corporate reseller and Direct. The sales the Marketplace reports under the "Unknown" partner type are the sales of solution partners whose type it did not record, so they are counted as Expert |
| Country | Region and Country of the customer |
| Hosting | Cloud, Data Center, Server |
| License Type | Commercial, Academic, Evaluation, Free, Legacy free, Community, Open source, Demonstration, Social impact |
| License Status | Active, Inactive, Cancelled |
| License Tier | the user count of the license, as the exact Tier and as the user Range it belongs to |
| Sale Type | New, Renewal, Upgrade, Downgrade, Refund |
| Billing Period | Monthly, Annual |
| Payment Status | Paid, Fully paid, Partially paid, Open, Uncollectible, Refunded |
| Product Edition | the edition of the parent product: Standard, Premium, Enterprise, Free |
| Time | the license and transaction dates |

#### Partner groups

The Marketplace names a partner by the legal name of the subsidiary that made the sale, so one
partner is spread over many members — "Adaptavist UK Services Limited", "Adaptavist Germany GmbH",
"Adaptavist Sdn. Bhd", "The Adaptavist Group". The **Group** level of the Partner dimension joins
them into the trade name that is left when the legal form (Limited, GmbH, Pty Ltd, S.A. de C.V.),
the descriptors of the business (Consulting, Technologies, Group), the country of the subsidiary
(UK, Deutschland, LATAM) and a qualifier after a dash, a bar or in parentheses are taken off the
end of the name. A partner doing business under a trade name ("Runtime Technologies LLC D/B/A Isos
Technology") is grouped by that trade name. The names are compared without their case, accents and
punctuation, so that "Deiser SL" and "DEISER SL" are one group, and the group is named from the
words that are left with every word capitalized and a word of up to three letters written in
capitals ("Adaptavist", "Knowmad Mood", "SHI", "NTT Data"). A name which no rule shortens is its
own group.

The groups are computed by every import from the rules in the importer, so a partner is regrouped
by the next import when the rules change; run a full reimport to regroup every partner at once.

### Measures

| Measure | Counts |
|---|---|
| Licenses | licenses whose maintenance started in the period |
| Licenses ending | licenses whose maintenance ended in the period |
| Customers with new licenses | the customers whose license started in the period, counted once each |
| Active licenses | licenses in force at the end of the period (cumulative) |
| Evaluation, Paid, Free, Demonstration licenses | the licenses of those license types |
| Transactions | transaction lines of the period |
| Purchase price, Vendor amount | the sale price and the vendor's share of it |
| Partner, Promotion, Loyalty, Manual discount amount | the discounts applied to the sales. The partner discount is the expert discount the Marketplace reports for a sale made through a partner, or the legacy partner discount column of an older server or data center invoice which reports it only there |
| Maintenance started, Maintenance ended | the maintenance periods the sales paid for |
| Active maintained licenses | maintenance periods in force at the end of the period (cumulative) |
| Customers | the customers who bought in the period, counted once each |
| Average purchase price, Average vendor amount | the purchase price and the vendor amount per transaction line |
| Vendor amount per customer | the vendor amount per customer who bought in the period |
| Vendor amount cloud % | the share of the vendor amount that the cloud sales make |
| Refunded amount | the vendor amount of the refunds |

The **License properties** and **Transaction properties** measure groups show the details of the
license or the transaction a report row is on — its dates, customer, app, hosting, tier, partner
and status, and for a transaction its billing period, product edition, payment attempts and
license — so that a report listing licenses or transactions has them as columns. The app is named
as in the App dimension, by its Marketplace listing, also for a record that carries an older name
of the app. A cell of a license measure
drills through to its licenses, a cell of a transaction measure to its transaction lines.

A refund carries negative amounts and counts its maintenance rows negative, so the cumulative
measures need no special case for it. The two cumulative measures count a period that is still
running up to and including today, so that it can be compared with the periods before it.

## Imports after the first one

Every import asks the Marketplace for the records changed since the previous import started, less
three days — the exports filter by whole days, and the overlap makes sure a record changed while
an import was running is seen by the next one. A record that changed replaces its own rows.

A license or a transaction which Atlassian removes from the reports is **not** removed from
eazyBI by an incremental import. Run a full reimport when you need the data to match the
Marketplace reports exactly again.

## Advanced settings

| Setting | Default | Effect |
|---|---|---|
| `max_wait_seconds` | 3600 | how long an import may wait for the Marketplace to prepare an export |
| `api_timeout_in_seconds` | 120 | HTTP request timeout |

A vendor with a large data set may need to raise `max_wait_seconds`: the whole license and
transaction history of a large vendor takes the Marketplace several minutes to export.
