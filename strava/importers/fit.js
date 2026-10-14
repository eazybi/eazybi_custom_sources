// The FIT activity files of the export, which a Garmin watch or another device uploads to Strava. A FIT file
// is binary: a header, then a sequence of messages, and a CRC at the end. A definition message declares a
// local message type — the global message number and the fields with their sizes and byte order — and the
// data messages of that local type follow it. Only the record messages, the track points, and the timer
// events are used: the other messages only carry the timestamps of the compressed timestamp headers. The
// Garmin FIT SDK can not be bundled with the app, because its license allows only internal use.
app.importers.fit = {
  SIGNATURE: ".FIT",
  MIN_HEADER_SIZE: 12,
  // A FIT timestamp counts the seconds since 1989-12-31T00:00:00Z.
  EPOCH_MS: Date.UTC(1989, 11, 31),
  SEMICIRCLE_DEGREES: 180 / 2147483648,

  RECORD_MESSAGE: 20,
  EVENT_MESSAGE: 21,
  TIMESTAMP_FIELD: 253,
  RECORD_FIELDS: {lat: 0, lon: 1, altitude: 2, heartRate: 3, enhancedAltitude: 78},
  EVENT_FIELDS: {event: 0, eventType: 1},
  TIMER_EVENT: 0,
  TIMER_START: 0,
  // stop, stop_all, stop_disable and stop_disable_all
  TIMER_STOPS: [1, 4, 8, 9],

  // The base types of the field values which are decoded, by the low five bits of the base type, with the
  // value which marks an unknown value. A field of another base type, or an array of values, is skipped.
  BASE_TYPES: {
    0: {size: 1, read: "getUint8", invalid: 0xFF},
    1: {size: 1, read: "getInt8", invalid: 0x7F},
    2: {size: 1, read: "getUint8", invalid: 0xFF},
    3: {size: 2, read: "getInt16", invalid: 0x7FFF},
    4: {size: 2, read: "getUint16", invalid: 0xFFFF},
    5: {size: 4, read: "getInt32", invalid: 0x7FFFFFFF},
    6: {size: 4, read: "getUint32", invalid: 0xFFFFFFFF},
    10: {size: 1, read: "getUint8", invalid: 0},
    11: {size: 2, read: "getUint16", invalid: 0},
    12: {size: 4, read: "getUint32", invalid: 0}
  },

  // The track segments [[{lat, lon, ele, timeMs, hr}, ...], ...] of the record messages of the bytes of a FIT
  // file, divided at the stops of the timer.
  segments(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = this.dataEnd(view);
    this.checkCrc(bytes, view, end);
    var definitions = {};
    var points = [], timerEvents = [];
    var lastTimestamp = null;
    var position = view.getUint8(0);
    while (position < end) {
      let header = view.getUint8(position++);
      if ((header & 0xC0) === 0x40) {
        let definition = this.definition(view, header, position, end);
        definitions[header & 0x0F] = definition;
        position = definition.end;
        continue;
      }

      // A compressed timestamp header carries the local message type and the last five bits of the timestamp.
      let compressed = (header & 0x80) !== 0;
      let definition = definitions[compressed ? (header >> 5) & 0x03 : header & 0x0F];
      if (!definition) throw new Error(`the message at byte ${position - 1} has no definition`);
      this.checkBytes(position, definition.dataSize, end);
      let message = this.fieldValues(view, position, definition);
      position += definition.dataSize;

      // The timestamp of every message counts for the compressed timestamp of the next one.
      let timestamp = this.timestamp(message, header, lastTimestamp);
      if (timestamp !== null) lastTimestamp = timestamp;
      if (definition.globalNumber === this.RECORD_MESSAGE) {
        let point = this.point(message, timestamp);
        if (point) points.push(point);
      } else if (definition.globalNumber === this.EVENT_MESSAGE) {
        let timerEvent = this.timerEvent(message, timestamp);
        if (timerEvent) timerEvents.push(timerEvent);
      }
    }
    return this.divideAtTimerStops(points, timerEvents);
  },

  // The points divided at every stop of the timer, without the points of a device which records while its
  // timer is stopped. The timestamps decide and not the order of the messages, because Strava writes all the
  // events of a file before its records.
  divideAtTimerStops(points, timerEvents) {
    var events = _.sortBy(timerEvents, (event) => event.timeMs);
    var segments = [], current = [];
    var stopped = false, index = 0;
    points.forEach((point) => {
      while (index < events.length && this.isBefore(events[index], point)) {
        stopped = events[index++].stop;
        if (stopped && current.length > 0) {
          segments.push(current);
          current = [];
        }
      }
      if (!stopped) current.push(point);
    });
    if (current.length > 0) segments.push(current);
    return segments;
  },

  // A point at the time of a stop of the timer ends the segment, and a point at the time of a start begins
  // the next one.
  isBefore(timerEvent, point) {
    return timerEvent.timeMs < point.timeMs || (timerEvent.timeMs === point.timeMs && !timerEvent.stop);
  },

  // The position after the messages, checked against the header and the length of the file with its CRC.
  dataEnd(view) {
    var signature = view.byteLength >= this.MIN_HEADER_SIZE ?
      String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) : "";
    var headerSize = signature === this.SIGNATURE ? view.getUint8(0) : 0;
    if (headerSize < this.MIN_HEADER_SIZE) throw new Error("it is not a FIT file");
    var end = headerSize + view.getUint32(4, true);
    if (end + 2 > view.byteLength) throw new Error("the file is shorter than its header says");
    return end;
  },

  // The CRC of the FIT SDK is a CRC-16/ARC: the polynomial 0xA001 of the reflected bits, with the CRC of
  // every byte value in a table.
  CRC_TABLE: (() => {
    var table = [];
    for (let value = 0; value < 256; value++) {
      let crc = value;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
      table.push(crc);
    }
    return table;
  })(),

  // A changed byte, which still leaves a valid sequence of messages, fails the CRC.
  checkCrc(bytes, view, end) {
    if (this.crc(bytes, end) !== view.getUint16(end, true)) throw new Error("the CRC of the file does not match");
  },

  crc(bytes, end) {
    var table = this.CRC_TABLE;
    var crc = 0;
    for (let position = 0; position < end; position++) crc = (crc >>> 8) ^ table[(crc ^ bytes[position]) & 0xFF];
    return crc;
  },

  // The definition message at the position: {globalNumber, littleEndian, fields: [{number, size, baseType,
  // offset}], dataSize, end}. The developer fields of a definition only add to the size of its data.
  definition(view, header, position, end) {
    this.checkBytes(position, 5, end);
    var hasDeveloperFields = (header & 0x20) !== 0;
    var littleEndian = view.getUint8(position + 1) === 0;
    var definition = {globalNumber: view.getUint16(position + 2, littleEndian), littleEndian: littleEndian,
      fields: [], dataSize: 0};
    var fieldsCount = view.getUint8(position + 4);
    position += 5;
    this.checkBytes(position, fieldsCount * 3, end);
    for (let index = 0; index < fieldsCount; index++, position += 3) {
      let size = view.getUint8(position + 1);
      definition.fields.push({number: view.getUint8(position), size: size, baseType: view.getUint8(position + 2) & 0x1F,
        offset: definition.dataSize});
      definition.dataSize += size;
    }
    if (hasDeveloperFields) {
      this.checkBytes(position, 1, end);
      let developerFieldsCount = view.getUint8(position++);
      this.checkBytes(position, developerFieldsCount * 3, end);
      for (let index = 0; index < developerFieldsCount; index++, position += 3) {
        definition.dataSize += view.getUint8(position + 1);
      }
    }
    definition.end = position;
    return definition;
  },

  checkBytes(position, count, end) {
    if (position + count > end) throw new Error(`the file ends inside the message at byte ${position}`);
  },

  // The values of the message by field number, null for an unknown value.
  fieldValues(view, position, definition) {
    var values = {};
    definition.fields.forEach((field) => {
      var baseType = this.BASE_TYPES[field.baseType];
      if (!baseType || baseType.size !== field.size) return;
      var value = view[baseType.read](position + field.offset, definition.littleEndian);
      values[field.number] = value === baseType.invalid ? null : value;
    });
    return values;
  },

  // The track point of a record message, or null when it has no timestamp. Its altitude is stored as
  // 5 times the meters above -500 m, the enhanced altitude with more bits.
  point(message, timestamp) {
    if (timestamp === null) return null;
    var fields = this.RECORD_FIELDS;
    var lat = this.value(message, fields.lat), lon = this.value(message, fields.lon);
    var hasPosition = lat !== null && lon !== null;
    var altitude = this.value(message, fields.enhancedAltitude);
    if (altitude === null) altitude = this.value(message, fields.altitude);
    return {
      lat: hasPosition ? lat * this.SEMICIRCLE_DEGREES : null,
      lon: hasPosition ? lon * this.SEMICIRCLE_DEGREES : null,
      ele: altitude === null ? null : app.importers.rows.round(altitude / 5 - 500, 1),
      timeMs: this.timeMs(timestamp),
      hr: this.value(message, fields.heartRate)
    };
  },

  timeMs(timestamp) {
    return this.EPOCH_MS + timestamp * 1000;
  },

  value(message, fieldNumber) {
    var value = message[fieldNumber];
    return value === undefined ? null : value;
  },

  // The timestamp of the message. The timestamp of a compressed timestamp header follows the last timestamp.
  timestamp(message, header, lastTimestamp) {
    var compressed = (header & 0x80) !== 0;
    return compressed && lastTimestamp !== null ? lastTimestamp + (((header & 0x1F) - lastTimestamp) & 0x1F) :
      this.value(message, this.TIMESTAMP_FIELD);
  },

  // The {timeMs, stop} of an event message which starts or stops the timer, or null for another event.
  timerEvent(message, timestamp) {
    var fields = this.EVENT_FIELDS;
    if (timestamp === null || message[fields.event] !== this.TIMER_EVENT) return null;

    var stop = this.TIMER_STOPS.indexOf(message[fields.eventType]) >= 0;
    return stop || message[fields.eventType] === this.TIMER_START ? {timeMs: this.timeMs(timestamp), stop: stop} : null;
  }
};
