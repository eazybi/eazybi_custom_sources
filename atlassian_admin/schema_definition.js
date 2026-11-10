// The member links point at Atlassian Administration and not at the API base URL, which has no pages.
//
// The `generation` column of every table has no name and no property, so it is neither a measure nor a
// level property (see importers/sweep.js).
var ADMIN_URL = "https://admin.atlassian.com";

app.defineSchema((schema) => {
  var dimension = schema.dimension, timeDimension = schema.timeDimension,
      cube = schema.cube, expr = schema.expr;
  var importProductRoles = source.getExtraOption("import_product_roles") === true;
  // The user profile fields selected on the Custom fields tab of the import options page.
  var customFields = source.getCustomFields();
  var customFieldAnnotations = {group: "Custom fields"};

  schema.setAnnotationAttributes({site_url: `${ADMIN_URL}/o/${source.getSourceParam("org_id") || ""}`});

  dimension("User", (d) => {
    d.table("users");
    d.level((l) => {
      l.string("account_id", {key: true, property: "DISPLAY_KEY", index: true});
      // Long enough for a display name and the " (<account id>)" duplicate name suffix.
      l.string("display_name", {name: true, ordinal: true, limit: 550});
      l.string("email", {property: "Email"});
      l.string("account_type", {property: "Account type"});
      l.string("status", {property: "Status"});
      l.string("admin_role", {property: "Admin role"});
      l.datetime("last_active", {property: "Last active"});
      l.integer("generation");
      customFields.forEach((field) => {
        if (field.property) l[field.dataType](`cf_${field.key}`, {property: field.name});
      });
      l.annotations({source_url: "{{site_url}}/members/{{key}}"});
    });
  });

  customFields.forEach((field) => {
    if (!field.dimension) return;

    dimension(field.name, (d) => {
      d.table(`cf_${field.key}`);
      d.level((l) => {
        l.string("name", {key: true, name: true});
        l.integer("generation");
      });
      d.dimensionAnnotations(customFieldAnnotations);
    });
  });

  // The highest admin role of the user in the organization: an org admin is also a site and product
  // admin, so every user is exactly one member of this dimension.
  dimension("Admin Role", (d) => {
    d.table("admin_roles");
    d.level((l) => {
      l.string("name", {key: true, name: true});
      l.integer("ordinal", {ordinal: true});
      l.integer("generation");
    });
  });

  dimension("User Status", (d) => {
    d.table("statuses");
    d.level((l) => {
      l.string("name", {key: true, name: true});
      l.integer("ordinal", {ordinal: true});
      l.integer("generation");
    });
  });

  dimension("Group", (d) => {
    d.table("groups");
    d.level((l) => {
      l.string("external_id", {index: true, property: "URL_ID"});
      l.string("name", {key: true, name: true});
      l.integer("generation");
      l.annotations({source_url: "{{site_url}}/groups/{{id}}"});
    });
    d.bridgeTable("groups_bt", (b) => {
      b.string("_bt_id", {primaryKey: true, limit: 150, bridgeDimensionForeignKeyColumn: "group_bt_id"});
      b.integer("group_id", {parentKey: true});
    });
  });

  // The roles of the user on a product (a user can hold several), filled by the Import product roles option.
  dimension("Product Role", (d) => {
    d.table("product_roles");
    d.level((l) => {
      l.string("role_key", {key: true});
      l.string("name", {name: true});
      l.integer("ordinal", {ordinal: true});
      l.integer("generation");
    });
    d.bridgeTable("product_roles_bt", (b) => {
      b.string("_bt_id",
        {primaryKey: true, limit: 150, bridgeDimensionForeignKeyColumn: "product_role_bt_id"});
      b.integer("product_role_id", {parentKey: true});
    });
  }, {visible: importProductRoles});

  // Keyed by the site or workspace and not by its name: two workspaces without an address can have the same
  // name (see the site keys in importers/users.js).
  dimension("Site", (d) => {
    d.table("sites");
    d.level((l) => {
      l.string("site_key", {key: true, limit: 300});
      // Long enough for a name and the " (<site key>)" duplicate name suffix.
      l.string("name", {name: true, ordinal: true, limit: 650});
      l.integer("generation");
    });
  });

  dimension("Product", (d) => {
    d.table("products");
    d.level((l) => {
      l.string("product_key", {key: true, property: "DISPLAY_KEY"});
      l.string("name", {name: true, ordinal: true});
      l.integer("generation");
    });
  });

  dimension("Plan", (d) => {
    d.table("plans");
    d.level((l) => {
      l.string("plan_key", {key: true});
      l.string("name", {name: true});
      l.integer("ordinal", {ordinal: true});
      l.integer("generation");
    });
  });

  // One member per product access row, only the table the Inactivity interval and the Activity Tracking
  // share: they belong to the access and not to the user. The tracking group is the product, site and license
  // state the activity tracking is told by (see trackingGroup in importers/users.js).
  dimension("Product Access", (d) => {
    d.table("product_accesses");
    d.level((l) => {
      l.string("access_key", {key: true, name: true, limit: 300});
      // Indexed for the update of every group that is not tracked (markUntrackedGroups in importers/users.js).
      l.string("tracking_group", {limit: 300, index: true});
      l.string("activity_tracking");
      l.integer("activity_tracking_ordinal");
      l.integer("generation");
    });
  }, {visible: false});

  // Whether Atlassian tracks the activity of the product access: one without is in the (none) member of the
  // Inactivity interval too, but not because the user never used the product.
  dimension("Activity Tracking", (d) => {
    d.sharedTable("product_accesses");
    d.level((l) => {
      l.string("activity_tracking", {key: true, name: true});
      l.integer("activity_tracking_ordinal", {ordinal: true});
    });
  });

  // The age since the last activity in the product, counted at every report query; the access to a product
  // the user never used, or whose activity Atlassian does not track, has no last activity and is the (none)
  // member.
  schema.intervalDimension("Inactivity interval", {
    sharedTable: "product_accesses",
    column: "last_active_ts",
    limit: 8,
    timeUnit: "seconds",
    timeInterval: "age",
    defaultIntervals: "30,90,180",
    defaultIntervalUnit: "days"
  });

  timeDimension("Time");

  cube((c) => {
    c.table("users");
    c.annotations({
      default_measures: ["Users"],
      drill_through_dimension_levels: ["[User].[User]"]
    });

    // One row per user of the organization; the Time member is the last activity of the user. An active user
    // is one of the Active account status, whatever their last activity.
    c.measures((m) => {
      m.integer("users_count", {name: "Users"});
      m.integer("active_users", {name: "Active users"});
      m.integer("inactive_users", {name: "Inactive users"});
      m.integer("generation");
    });

    // One row per user, product and site the user has access to; the Time member is the last activity
    // of the user in that product.
    c.measures("Product access", (m) => {
      m.table("product_access");
      m.integer("product_users", {name: "Product users"});
      // The users holding a license of the product, with the user or the admin role.
      m.integer("licensed_users", {name: "Licensed users"});
      // The licensed users who never used the product.
      m.integer("unused_licenses", {name: "Unused licenses"});
      m.integer("product_admins", {name: "Product admins", visible: importProductRoles});
      m.integer("product_last_active_ts", {name: "Product last active timestamp", aggregator: "max",
        limit: 8, visible: false});
      m.integer("generation");
    });

    // One row per workspace — a product of a site — with its license plan and seats.
    c.measures("Licenses", (m) => {
      var licenseAnnotations = {drill_through_dimension_levels: "[Site].[Site]"};
      m.table("licenses");
      m.integer("workspaces_count", {name: "Workspaces", annotations: licenseAnnotations});
      m.integer("license_seats", {name: "License seats", annotations: licenseAnnotations});
      m.integer("generation");
    });

    c.timeDimensionCalculatedMembers();

    c.calculatedMember("Active users %", {
      formatString: "#0.0%",
      formula: `
        CASE WHEN [Measures].[Users] > 0 THEN
          [Measures].[Active users] / [Measures].[Users]
        END`
    });

    // The users whose last activity in any selected product is less than 30 days ago, counted at every report
    // query from the Time member of the user, which is the day of the last activity.
    c.calculatedMember("Users active in last 30 days", {
      formatString: "#,##0",
      formula: "Sum([Time].[Day].DateMembersBetween('29 days ago', 'today'), [Measures].[Users])"
    });

    // The seats come from the license of the workspace and the users from their product access rows, so
    // the difference is meaningful only where both are present (a Site and Product report).
    c.calculatedMember("Remaining seats", {
      formatString: "#,##0",
      formula: `
        CASE WHEN [Measures].[License seats] > 0 THEN
          [Measures].[License seats] - [Measures].[Product users]
        END`
    });

    c.calculatedMember("Product last active date", {
      formatString: "yyyy-mm-dd hh:nn:ss",
      formula: "TimestampToDate([Measures].[Product last active timestamp])"
    });
    // Empty for a product the user never used, which has no last activity to count the days from.
    c.calculatedMember("Product inactive days", {
      formatString: "#,##0",
      formula: `
        CASE WHEN [Measures].[Product last active timestamp] > 0 THEN
          DateDiffDays(DateWithoutTime([Measures].[Product last active date]), DateParse('today'))
        END`
    });

    var userProperties = {group: "User properties"};
    c.calculatedMember("User email", {
      annotations: userProperties,
      formula: "[User].CurrentHierarchyMember.get('Email')"
    });
    c.calculatedMember("User admin role", {
      annotations: userProperties,
      formula: "[User].CurrentHierarchyMember.get('Admin role')"
    });
    c.calculatedMember("User status", {
      annotations: userProperties,
      formula: "[User].CurrentHierarchyMember.get('Status')"
    });
    c.calculatedMember("User account type", {
      annotations: userProperties,
      formula: "[User].CurrentHierarchyMember.get('Account type')"
    });
    c.calculatedMember("User last active date", {
      formatString: "yyyy-mm-dd hh:nn:ss", annotations: userProperties,
      formula: "[User].CurrentHierarchyMember.get('Last active')"
    });
    c.calculatedMember("User inactive days", {
      formatString: "#,##0", annotations: userProperties,
      formula: `
        CASE WHEN NOT IsEmpty([User].CurrentHierarchyMember.get('Last active')) THEN
          DateDiffDays(DateWithoutTime([User].CurrentHierarchyMember.get('Last active')), DateParse('today'))
        END`
    });

    // A deselected field takes its property measure with it: eazyBI removes the predefined calculated
    // members whose formula reads a property that is gone.
    customFields.forEach((field) => {
      if (!field.property) return;

      var options = {
        annotations: customFieldAnnotations,
        formula: `[User].CurrentHierarchyMember.get('${field.name}')`
      };
      if (field.dataType === "datetime") options.formatString = "mmm dd yyyy";
      c.calculatedMember(`User ${field.name.toLowerCase()}`, options);
    });
  });
});
