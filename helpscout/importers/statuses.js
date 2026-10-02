// The small attribute dimensions — Status, Channel, Source, Hour and Message count. The
// known members are seeded with their names and their order, and unknown values arriving from Help
// Scout are added as they are seen. A seeded member no conversation uses is removed again as an
// unused member.
app.importers.statuses = {
  STATUSES: [
    {key: "active", name: "Active", position: 1},
    {key: "pending", name: "Pending", position: 2},
    {key: "open", name: "Open", position: 3},
    {key: "closed", name: "Closed", position: 4},
    {key: "spam", name: "Spam", position: 5}
  ],

  CHANNELS: [
    {key: "email", name: "Email"},
    {key: "chat", name: "Chat"},
    {key: "phone", name: "Phone"}
  ],

  importAll() {
    logger.startImport("statuses");
    this.STATUSES.forEach((status) => dwh.dimensions.statuses.createAndLookupId(
      {status_key: status.key}, {name: status.name, position: status.position}));
    logger.finishImport("statuses", this.STATUSES.length);

    logger.startImport("channels");
    this.CHANNELS.forEach((channel) => dwh.dimensions.channels.createAndLookupId(
      {channel_key: channel.key}, {name: channel.name}));
    logger.finishImport("channels", this.CHANNELS.length);

    logger.startImport("hours");
    for (var hour = 0; hour < 24; hour++) this.storeHour(hour);
    logger.finishImport("hours", 24);
  },

  storeHour(hour) {
    return dwh.dimensions.hours.createAndLookupId({hour: hour}, {name: this.hourName(hour)});
  },

  // "07", so that the members read as hours and sort as hours also where the ordinal is not used.
  hourName(hour) {
    return hour < 10 ? `0${hour}` : String(hour);
  },

  // The hour of the day of a timestamp, in the Time dimension time zone — the same conversion the
  // Time member of the row is looked up with, so that the hour and the day of a row agree.
  lookupHourId(timestamp) {
    var localTime = dwh.datetimeValue(timestamp);
    if (!localTime) return null;
    var hour = parseInt(String(localTime).substring(11, 13), 10);
    if (isNaN(hour)) return null;
    return this.storeHour(hour);
  },

  lookupStatusId(status) {
    if (!status) return null;
    return dwh.dimensions.statuses.createAndLookupId({status_key: status},
      {name: app.importers.rows.humanize(status), position: this.STATUSES.length + 1});
  },

  lookupChannelId(channel) {
    if (!channel) return null;
    return dwh.dimensions.channels.createAndLookupId({channel_key: channel},
      {name: app.importers.rows.humanize(channel)});
  },

  lookupSourceTypeId(sourceType) {
    if (!sourceType) return null;
    return dwh.dimensions.source_types.createAndLookupId({source_type_key: sourceType},
      {name: app.importers.rows.humanize(sourceType)});
  }
};
