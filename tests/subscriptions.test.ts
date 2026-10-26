import { describe, expect, it } from "vitest";
import { describeSchedule, detectRecurring } from "../lib/subscriptions";
import { tx } from "./helpers";

const TODAY = "2026-10-25";
const detect = (charges: ReturnType<typeof tx>[], overrides = new Map()) =>
  detectRecurring(charges, (m) => m.toUpperCase(), overrides, TODAY);
const byName = (list: ReturnType<typeof detect>) => Object.fromEntries(list.map((r) => [r.merchant, r]));

describe("detectRecurring", () => {
  const data = [
    tx("2026-07-06", "NETFLIX", -15.49), tx("2026-08-07", "NETFLIX", -15.49), tx("2026-09-06", "NETFLIX", -15.49), tx("2026-10-06", "NETFLIX", -17.99),
    tx("2026-09-12", "SPOTIFY", -11.99), tx("2026-10-12", "SPOTIFY", -11.99),
    tx("2026-05-03", "PLANET FITNESS", -24.99), tx("2026-06-03", "PLANET FITNESS", -24.99), tx("2026-07-03", "PLANET FITNESS", -24.99),
    tx("2026-08-01", "COMCAST", -79.99, { categoryName: "Bills & Utilities" }), tx("2026-09-01", "COMCAST", -79.99, { categoryName: "Bills & Utilities" }),
    tx("2026-09-02", "WHOLE FOODS", -88.4), tx("2026-09-09", "WHOLE FOODS", -23.1), tx("2026-09-20", "WHOLE FOODS", -140), tx("2026-10-03", "WHOLE FOODS", -61),
  ];
  const found = byName(detect(data));

  it("finds monthly charges from the second one, on their billing day", () => {
    expect(found.SPOTIFY.frequency).toBe("monthly");
    expect(found.NETFLIX.billingDay).toBe(6);
    expect(describeSchedule(found.NETFLIX)).toBe("every month on the 6th");
    expect(found.NETFLIX.nextDate).toBe("2026-11-06");
  });

  it("flags a price rise, a new one, a stopped one and bills", () => {
    expect(found.NETFLIX.previousAmount).toBe(15.49);
    expect(found.SPOTIFY.isNew).toBe(true);
    expect(found["PLANET FITNESS"].isStopped).toBe(true);
    expect(found.COMCAST.kind).toBe("bill");
  });

  it("ignores spending with no steady amount or rhythm", () => {
    expect(found["WHOLE FOODS"]).toBeUndefined();
  });

  it("honors the user's choice either way", () => {
    const overrides = new Map([["NETFLIX", "not" as const], ["NEW APP", "subscription" as const]]);
    const list = byName(detect([...data, tx("2026-10-20", "NEW APP", -9.99)], overrides));
    expect(list.NETFLIX).toBeUndefined();
    expect(list["NEW APP"].markedByUser).toBe(true);
  });

  it("lines up end-of-month and February charges", () => {
    const list = byName(detect([tx("2026-01-31", "APP", -9.99), tx("2026-02-28", "APP", -9.99), tx("2026-03-31", "APP", -9.99)]));
    expect(list.APP.frequency).toBe("monthly");
    expect(list.APP.nextDate).toBe("2026-04-30");
  });
});
