import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  describeNext,
  diffDays,
  formatHijri,
  gregorianToHijri,
  hijriMonthLength,
  hijriToGregorian,
  isIsoDate,
  nthWeekdayOfMonth,
  resolveActiveBoost,
  resolveOccurrences,
  supportsHijriCalendar,
  todayInTimeZone,
} from "./dates";

test("the runtime ships the Umm al-Qura calendar", () => {
  assert.equal(supportsHijriCalendar(), true);
});

test("hijriToGregorian matches published Umm al-Qura anchors", () => {
  assert.equal(hijriToGregorian(1447, 9, 1), "2026-02-18"); // 1 Ramadan 1447
  assert.equal(hijriToGregorian(1447, 10, 1), "2026-03-20"); // Eid al-Fitr 1447
  assert.equal(hijriToGregorian(1447, 12, 10), "2026-05-27"); // Eid al-Adha 1447
  assert.equal(hijriToGregorian(1448, 10, 1), "2027-03-09"); // Eid al-Fitr 1448
  assert.equal(hijriToGregorian(1448, 1, 1), "2026-06-16"); // Hijri new year 1448
});

test("hijriToGregorian round-trips through gregorianToHijri", () => {
  for (const [hy, hm, hd] of [
    [1447, 1, 1],
    [1447, 6, 15],
    [1448, 12, 29],
    [1450, 3, 12],
    [1460, 9, 27],
  ] as const) {
    assert.deepEqual(gregorianToHijri(hijriToGregorian(hy, hm, hd)), { hy, hm, hd });
  }
});

test("a day past the Hijri month end clamps instead of spilling into the next month", () => {
  const length = hijriMonthLength(1447, 9);
  assert.ok(length === 29 || length === 30);
  assert.equal(hijriToGregorian(1447, 9, 30), hijriToGregorian(1447, 9, length));
});

test("formatHijri renders Arabic-Indic digits and month names", () => {
  assert.equal(formatHijri("2026-02-18", "ar"), "١ رمضان ١٤٤٧");
  assert.equal(formatHijri("2026-02-18", "en"), "1 Ramadan 1447");
});

test("nthWeekdayOfMonth handles first, nth and last", () => {
  assert.equal(nthWeekdayOfMonth(2026, 11, 5, -1), "2026-11-27"); // last Friday of Nov 2026
  assert.equal(nthWeekdayOfMonth(2026, 2, 2, 2), "2026-02-10"); // 2nd Tuesday of Feb 2026
  assert.equal(nthWeekdayOfMonth(2026, 3, 0, 1), "2026-03-01"); // 1st Sunday of Mar 2026
});

test("date helpers", () => {
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(diffDays("2026-09-20", "2026-09-23"), 3);
  assert.equal(diffDays("2026-09-23", "2026-09-20"), -3);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-02-28"), true);
  assert.match(todayInTimeZone("Asia/Riyadh"), /^\d{4}-\d{2}-\d{2}$/);
});

test("resolveOccurrences: gregorian fixed date, weekday rule and Feb-29 clamp", () => {
  const nationalDay = { calendar: "gregorian", month: 9, day: 23, durationDays: 1 };
  assert.deepEqual(
    resolveOccurrences(nationalDay, { fromIso: "2026-01-01", toIso: "2027-12-31" }).map((o) => o.startIso),
    ["2026-09-23", "2027-09-23"]
  );

  const whiteFriday = { calendar: "gregorian", month: 11, weekday: 5, weekOrdinal: -1, durationDays: 3 };
  const [wf] = resolveOccurrences(whiteFriday, { fromIso: "2026-11-01", toIso: "2026-11-30" });
  assert.equal(wf.startIso, "2026-11-27");
  assert.equal(wf.endIso, "2026-11-29");
  assert.equal(wf.estimated, false);

  const leapDay = { calendar: "gregorian", month: 2, day: 29, durationDays: 1 };
  assert.equal(resolveOccurrences(leapDay, { fromIso: "2027-01-01", toIso: "2027-12-31" })[0].startIso, "2027-02-28");
});

test("resolveOccurrences: hijri rule, overrides and a Gregorian year with two Muharrams", () => {
  const eidFitr = { calendar: "hijri", month: 10, day: 1, durationDays: 3 };
  const list = resolveOccurrences(eidFitr, { fromIso: "2026-01-01", toIso: "2027-12-31" });
  assert.deepEqual(list.map((o) => o.startIso), ["2026-03-20", "2027-03-09"]);
  assert.equal(list[0].estimated, true);
  assert.equal(list[0].hijriYear, 1447);
  assert.equal(list[0].overrideKey, "1447");
  assert.equal(list[0].endIso, "2026-03-22");

  const withOverride = { ...eidFitr, dateOverrides: { "1447": "2026-03-21" } };
  const [overridden] = resolveOccurrences(withOverride, { fromIso: "2026-01-01", toIso: "2026-12-31" });
  assert.equal(overridden.startIso, "2026-03-21");
  assert.equal(overridden.estimated, false);

  // 2008 held 1 Muharram twice (10 Jan and 29 Dec).
  const hijriNewYear = { calendar: "hijri", month: 1, day: 1, durationDays: 1 };
  const twice = resolveOccurrences(hijriNewYear, { fromIso: "2008-01-01", toIso: "2008-12-31" });
  assert.equal(twice.length, 2);
  assert.equal(twice[0].hijriYear, 1429);
  assert.equal(twice[1].hijriYear, 1430);
});

test("describeNext reports the phase at every window edge", () => {
  const rule = { calendar: "gregorian", month: 9, day: 23, durationDays: 2, reminderLeadDays: 30, boostLeadDays: 14 };
  const at = (today: string) => describeNext(rule, today);

  assert.equal(at("2026-08-01")?.phase, "upcoming");
  assert.equal(at("2026-08-24")?.phase, "reminder"); // exactly 30 days before
  assert.equal(at("2026-09-08")?.phase, "reminder");
  assert.equal(at("2026-09-09")?.phase, "boost"); // exactly 14 days before
  assert.equal(at("2026-09-22")?.phase, "boost");
  assert.equal(at("2026-09-23")?.phase, "live");
  assert.equal(at("2026-09-24")?.phase, "live"); // last day of a 2-day occasion
  assert.equal(at("2026-09-25")?.phase, "upcoming"); // rolled over to 2027
  assert.equal(at("2026-09-25")?.occurrence.startIso, "2027-09-23");

  assert.equal(at("2026-09-20")?.daysUntil, 3);
  assert.equal(at("2026-09-24")?.daysUntil, -1);
  assert.equal(resolveActiveBoost(rule, "2026-09-01"), null);
  assert.equal(resolveActiveBoost(rule, "2026-09-10")?.occurrence.startIso, "2026-09-23");
});
