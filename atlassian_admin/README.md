# Atlassian Admin

Imports the users of an Atlassian organization into eazyBI: their admin roles, org groups, account
statuses, product access and licenses with the last activity in every product, and the license plans and
seats of the selected Atlassian products.

## Connecting

1. Find the **organization ID** in the Atlassian Administration URL:
   `https://admin.atlassian.com/o/<organization ID>`.
2. Create an **organization API key** as an organization admin at
   [admin.atlassian.com](https://admin.atlassian.com) > Settings > API keys. A key created without
   scopes has full access; a scoped key needs the read scopes of accounts, directories, groups, roles
   and workspaces.
3. Enter both on the connection page and select the products to import.

An organization API key expires on the date chosen when it was created, at most a year later. The imports
then fail until a new key is entered on the connection page.

The product selection lists every Atlassian Cloud site of the organization with its products — Jira,
Confluence, Jira Service Management, Assets, and the products served for the site from other addresses,
such as Guard Detect or Rovo — and the products that have no site, such as a Bitbucket workspace. Select a
site to import all of its products, also the ones added to it later, select single products, or use
**Select all** to import every product of the organization.

All users of the organization are imported. The selected products decide whose product access and which
licenses are imported: access to a product that is not selected is left out. Access to a site the
organization no longer has is imported only when all products are selected, under a removed site (see the
Site dimension), and so is access that names no site, under the **(no site)** member. A product that a site
of the organization no longer has is left out, although Atlassian keeps the last activity of its users.

## Custom fields

The **Custom fields** tab of the import options page offers the user profile and security attributes
that the Atlassian directory answers with every user — Department, Job title, Organization, Location,
Time zone, Two-step verification, Management source, Claim status, Nickname, Email verified and Added
to org. Each selected field becomes a property of the **User** dimension members, shown in report
columns by its property measure in the Custom fields group (for example **User department**), and most
can also be selected as their own dimension to group the user and product access measures by (for
example, active users by department, or licensed users by two-step verification).

The values are as complete as the user profiles of the organization — a field nobody fills stays
"(none)" — and the managed accounts that no directory answers have no profile values. Note that
**Organization** is the free text company attribute of the user profile, not the Atlassian
organization the data is imported from.

## Import options

- **Import product roles** — imports the roles of the users on every selected product into the
  **Product Role** dimension and fills the **Product admins** measure, with one extra request per role
  and product. The admin role is also requested for the products that are not selected, so that the
  Admin Role dimension finds the admins of any product. A role counts whether it is assigned to the user
  directly or through a group. The **Product users by product role** and **Admins by product** sample
  reports show them. Without the option the Admin Role dimension tells apart only org admins, site admins
  and the users without an admin role.

## Dimensions

- **User** — every user of the organization directories and every managed account, with the email, account
  type, status, role and last active time as properties. Members link to the user in Atlassian
  Administration.
- **Admin Role** — the highest admin role of the user in the organization: Org admin, Site admin, Product
  admin (an admin of any product) or No admin role. Use **Product Role** for the roles on one product.
- **User Status** — Active, Suspended, Not invited, Deactivated, For deletion or Closed, and (unknown)
  for a status Atlassian adds later.
- **Group** — the org groups of the user (a user can be in several groups). The **Users by group** sample
  report shows the active and inactive users of every group.
- **Product Role** — with the Import product roles option, the roles of the user on a product: User and
  Admin (both take a product license), User access admin, Contributor, Basic, Stakeholder, Customer (a Jira
  Service Management portal customer) and Guest. A user can hold several roles on a product. Roles other
  than these, such as the ones of Compass, are not imported.
- **Site** — the Atlassian Cloud sites of the selected products, named by their address, and the
  products without a site, named by their address (a Bitbucket workspace) or name — two of the same name are
  told apart by their key added to the name. Atlassian keeps the
  product access of the users to a site the organization no longer has, such as a deleted sandbox. With all
  products selected, such a site is a member of its own marked **(removed)**, named by its cloud id, or by its
  address when Atlassian answers no cloud id for the access.
- **Product** — Jira, Jira Service Management, Confluence, Assets, Bitbucket and the other products.
- **Plan** — the license plan of the product workspace: Free, Standard, Premium or Enterprise.
- **Inactivity interval** — the days since the last activity of a user in a product, counted at every
  report query: under 30, 30–89, 90–179 and 180 or more days by default, which can be changed in the
  report editor. The access to a product the user never used is the **(none)** member, and so is the
  access whose activity Atlassian does not track. The **User product activity** sample report shows the
  users of every product by it.
- **Activity Tracking** — whether Atlassian tracks the activity of the product access: **Tracked** or **Not
  tracked**. Atlassian answers no activity both for a product the user never used and for one whose
  activity it does not track, such as Goals, Projects and the portal customers of Jira Service Management.
  So the access to a product of a site is Not tracked while none of its users with the same license state,
  licensed or not, has any activity in it, and Tracked from the first activity on.
- **Time** — the last activity time of a user in the selected products (user measures) or of a user in a
  product (product access measures), and the workspace creation time (license measures). The access to a product the user never
  used, or whose activity Atlassian does not track, has no time and counts only in the **All Times** total.

## Measures

- **Users**, **Active users**, **Inactive users** — one per user, by account status: an active
  user has the Active status, whatever their last activity, and the other statuses are inactive users. See
  **Users active in last 30 days** for the recent activity.
- **Active users %** — the share of the active users among the users.
- **Users active in last 30 days** — the users whose last activity in any of the selected products is less
  than 30 days ago.
- **Product users** — one per user, product and site the user has access to with any role, also when the
  user never used the product: a user of three products counts three times.
- **Licensed users** — the product users who hold a license of the product: its User or Admin role,
  assigned directly or through a group. These are the users who take a seat of the product: the users
  Atlassian bills on a paid plan, and the users who count against the user limit of a Free plan.
- **Unused licenses** — the licensed users who never used the product.
- **Product admins** — with the Import product roles option, the product users who hold the Admin role of
  the product.
- **Product last active date**, **User last active date** — the last activity of the user in the product,
  and in any of the selected products. The activity in a product that is not selected is not imported, also
  not into the last activity of the user.
- **Product inactive days**, **User inactive days** — the whole days since the last activity of the user in
  the product, and in any of the selected products. They are empty when there is no activity to count from: a product the
  user never used, or whose activity Atlassian does not track.
- **Workspaces** — the selected products, one per product of a site.
- **License seats** — the licensed seats of a product, where Atlassian reports them (see the notes).
- **Remaining seats** — the license seats left after the product users.

The product users of Jira Service Management also count its portal customers, and the product users of a
product include its guests and the admins without product access; the licensed users leave them out.
Assets, which comes with Jira Service Management, Guard Detect, which is billed for the whole organization
with Atlassian Guard, and Atlas, Goals, Projects, Studio and Rovo, which come with the other products, have
product users but no licensed users unless Atlassian reports a paid plan for them. Sandboxes have no
licensed users, and Atlassian answers none of a Bitbucket workspace: its product users are the users who
were active in it.

## Sample reports

- **Users overview** — value tiles of the users, the active users and the users active in the last 30
  days.
- **User product activity** — the users of every product by their Inactivity interval, of the Tracked
  product access only.
- **Product users by site** — the product users, licensed users and unused licenses of every site.
- **Users by admin role** and **Users by group** — the active and inactive users of every admin role and
  of every group.
- **Licensed users by last activity** — the licensed users of every product and site with their last
  activity in it and in any selected product, the ones who never used the product first. Select Jira Service
  Management on its Product page to list the agents.
- **Product users by product role** and **Admins by product** — with the Import product roles option.
  Product users by product role is a table of the users of every product and of each role on it, colored
  by the share of the product users holding the role. Admins by product stacks the admins of every product
  by site.

The **Atlassian Admin overview** dashboard combines them all but Licensed users by last activity.

## Notes

- Every import reads the whole organization; there is no incremental range. The Atlassian admin API
  rate limits apply, so very large organizations import more slowly. Every product that is not selected
  saves the requests of its users and roles — all but the request of its admins with the Import product
  roles option — so select only the products to analyze in a large organization. Studio takes one more request for every user with access to it, as Atlassian answers the
  last activity in Studio only per user.
- Atlassian takes a while to report a new activity: the last activity can lag behind the Last seen of
  Atlassian Administration for up to a day, until an import after Atlassian has reported it.
- An import fails when Atlassian does not answer the users of the organization, or the users or the roles
  of a product, also after retrying. A failed import removes nothing: what it imported before the error is
  updated, and the rest stays as the previous import left it until an import succeeds.
- Atlassian reports the licensed seats of a Bitbucket workspace, but not of the site products (Jira,
  Confluence, Jira Service Management and the others), which are billed by their users: their
  **Licensed users** is the license usage, and they show no **License seats**.
- A user removed from the organization, a product access or group that is gone, and a product that is
  removed or no longer selected disappear from the imported data with the next import. When a user fails
  to import, the data of that user stays as the previous import left it, and the users, groups and
  products that are gone disappear only with an import that imports every user.
