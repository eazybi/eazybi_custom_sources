// FIT files built from their messages: a definition message declares the fields of a local message type,
// and the data messages of that type follow it. 2^29 semicircles are 45 degrees, 2^27 are 11.25 degrees.
const LAT = 536870912, LON = 134217728;
const TIMESTAMP = 1000000000;
const TIME_MS = Date.parse("2021-09-08T01:46:40Z");
const RECORD_FIELDS = [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [3, 1, 0x02], [78, 4, 0x86]];
const EVENT_FIELDS = [[253, 4, 0x86], [0, 1, 0x00], [1, 1, 0x00]];

function integerBytes(value, size, littleEndian) {
  var bytes = [];
  for (let index = 0; index < size; index++) bytes.push((value >>> (8 * index)) & 0xFF);
  return littleEndian === false ? bytes.reverse() : bytes;
}

// The bytes of a FIT file of the messages, with a 14 byte header and the CRC of the file.
function fitFile(messages) {
  var body = messages.reduce((all, message) => all.concat(message), []);
  var content = [14, 0x20, 0x54, 0x08].concat(integerBytes(body.length, 4), [46, 70, 73, 84, 0, 0], body);
  return new Uint8Array(content.concat(integerBytes(app.importers.fit.crc(content, content.length), 2)));
}

function definition(localType, globalNumber, fields, options) {
  var developerFields = options && options.developerFields;
  var littleEndian = !(options && options.bigEndian);
  var bytes = [0x40 | localType | (developerFields ? 0x20 : 0), 0, littleEndian ? 0 : 1].
    concat(integerBytes(globalNumber, 2, littleEndian), [fields.length]);
  fields.forEach((field) => { bytes = bytes.concat(field); });
  if (developerFields) {
    bytes.push(developerFields.length);
    developerFields.forEach((field) => { bytes = bytes.concat(field); });
  }
  return bytes;
}

// A data message of the header byte with the [value, size] values in the order of the fields of its definition.
function dataMessage(header, values, littleEndian) {
  return values.reduce((bytes, value) => bytes.concat(integerBytes(value[0], value[1], littleEndian)), [header]);
}

// A record message of RECORD_FIELDS: timestamp, position, heart rate and the enhanced altitude in meters.
function record(seconds, heartRate, meters) {
  var altitude = meters === undefined ? 0xFFFFFFFF : (meters + 500) * 5;
  return dataMessage(1, [[TIMESTAMP + seconds, 4], [LAT, 4], [LON, 4], [heartRate, 1], [altitude, 4]]);
}

function timerEvent(seconds, eventType) {
  return dataMessage(2, [[TIMESTAMP + seconds, 4], [0, 1], [eventType, 1]]);
}

describe("app.importers.fit.segments", () => {
  test("reads the track points of the record messages", () => {
    var bytes = fitFile([
      definition(0, 0, [[0, 1, 0x00], [1, 2, 0x84]]),
      dataMessage(0, [[4, 1], [265, 2]]),
      definition(1, 20, RECORD_FIELDS, {developerFields: [[0, 2, 0]]}),
      dataMessage(1, [[TIMESTAMP, 4], [0x7FFFFFFF, 4], [0x7FFFFFFF, 4], [120, 1], [0xFFFFFFFF, 4], [7, 2]]),
      dataMessage(1, [[TIMESTAMP + 1, 4], [LAT, 4], [LON, 4], [0xFF, 1], [3177, 4], [7, 2]]),
      definition(3, 20, [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84]]),
      dataMessage(3, [[TIMESTAMP + 2, 4], [LAT, 4], [LON, 4], [2600, 2]])
    ]);

    expect(app.importers.fit.segments(bytes)).toEqual([[
      {lat: null, lon: null, ele: null, timeMs: TIME_MS, hr: 120},
      {lat: 45, lon: 11.25, ele: 135.4, timeMs: TIME_MS + 1000, hr: null},
      {lat: 45, lon: 11.25, ele: 20, timeMs: TIME_MS + 2000, hr: null}
    ]]);
  });

  test("ends a segment at every stop of the timer and leaves out the records until it starts again", () => {
    var bytes = fitFile([
      definition(1, 20, RECORD_FIELDS),
      definition(2, 21, EVENT_FIELDS),
      timerEvent(0, 0),
      record(0, 130),
      record(1, 131),
      timerEvent(1, 1),
      timerEvent(1, 4),
      record(30, 135),
      timerEvent(60, 0),
      record(60, 140),
      dataMessage(2, [[TIMESTAMP + 61, 4], [3, 1], [1, 1]]),
      record(61, 141),
      timerEvent(61, 4)
    ]);

    expect(app.importers.fit.segments(bytes).map((points) => points.map((point) => point.hr))).
      toEqual([[130, 131], [140, 141]]);
  });

  test("divides the records by the timestamps of the timer events, which Strava writes before them", () => {
    var bytes = fitFile([
      definition(1, 20, RECORD_FIELDS),
      definition(2, 21, EVENT_FIELDS),
      timerEvent(0, 0),
      timerEvent(1, 1),
      timerEvent(60, 0),
      timerEvent(61, 4),
      record(0, 130),
      record(1, 131),
      record(30, 135),
      record(60, 140),
      record(61, 141),
      record(90, 145)
    ]);

    expect(app.importers.fit.segments(bytes).map((points) => points.map((point) => point.hr))).
      toEqual([[130, 131], [140, 141]]);
  });

  test("reads the messages of a big-endian definition", () => {
    var bytes = fitFile([
      definition(1, 20, RECORD_FIELDS, {bigEndian: true}),
      dataMessage(1, [[TIMESTAMP, 4], [LAT, 4], [LON, 4], [150, 1], [2600, 4]], false)
    ]);

    expect(app.importers.fit.segments(bytes)).toEqual([[{lat: 45, lon: 11.25, ele: 20, timeMs: TIME_MS, hr: 150}]]);
  });

  test("adds the time offset of a compressed timestamp header to the last timestamp", () => {
    var bytes = fitFile([
      definition(1, 20, RECORD_FIELDS),
      record(0, 130),
      definition(2, 20, [[3, 1, 0x02]]),
      dataMessage(0x80 | (2 << 5) | 5, [[131, 1]]),
      dataMessage(0x80 | (2 << 5) | 2, [[132, 1]])
    ]);

    // TIMESTAMP ends with five zero bits, and the offset 2 after 5 rolls over to the next 32 seconds.
    expect(app.importers.fit.segments(bytes)[0].map((point) => (point.timeMs - TIME_MS) / 1000)).toEqual([0, 5, 34]);
  });

  test("fails for bytes which are not a whole FIT file", () => {
    var fit = app.importers.fit;
    var recordDefinition = definition(1, 20, RECORD_FIELDS);

    expect(() => fit.segments(new Uint8Array([1, 2, 3]))).toThrow("it is not a FIT file");
    expect(() => fit.segments(fitFile([recordDefinition, record(0, 130)]).subarray(0, 40))).
      toThrow("the file is shorter than its header says");
    expect(() => fit.segments(fitFile([recordDefinition, record(0, 130).slice(0, 5)]))).
      toThrow("the file ends inside the message");
    expect(() => fit.segments(fitFile([record(0, 130)]))).toThrow("has no definition");
  });

  test("fails for a file whose CRC does not match or is missing", () => {
    var fit = app.importers.fit;
    var bytes = fitFile([definition(1, 20, RECORD_FIELDS), record(0, 130)]);
    var changed = new Uint8Array(bytes);
    changed[bytes.length - 3] = 131;

    expect(() => fit.segments(changed)).toThrow("the CRC of the file does not match");
    expect(() => fit.segments(bytes.subarray(0, bytes.length - 1))).toThrow("the file is shorter than its header says");
  });
});

describe("app.importers.fit.crc", () => {
  test("computes the CRC-16/ARC of the FIT SDK", () => {
    var text = "123456789";
    var bytes = new Uint8Array(text.split("").map((character) => character.charCodeAt(0)));

    expect(app.importers.fit.crc(bytes, bytes.length)).toBe(0xBB3D);
  });
});
