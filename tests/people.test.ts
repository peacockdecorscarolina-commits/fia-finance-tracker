import { describe, expect, it } from "vitest";
import { forPerson, personFilterFromParams, personNameProblem, personParams, settleUp, shareOf, SHARED } from "../lib/people";
import { tx } from "./helpers";

const sarah = { personId: 2, peopleCount: 2 };

describe("shareOf", () => {
  it("is all of your own, half of shared, none of anyone else's", () => {
    expect(shareOf(2, sarah)).toBe(1);
    expect(shareOf(SHARED, sarah)).toBe(0.5);
    expect(shareOf(1, sarah)).toBe(0);
    expect(shareOf(null, sarah)).toBe(0);
  });
  it("splits shared equally among three", () => {
    expect(shareOf(SHARED, { personId: 2, peopleCount: 3 })).toBeCloseTo(1 / 3);
  });
});

describe("forPerson", () => {
  it("keeps their own whole and scales shared", () => {
    const rows = [
      tx("2026-10-01", "A", -40, { personId: 2 }),
      tx("2026-10-02", "B", -100, { personId: SHARED }),
      tx("2026-10-03", "C", -7, { personId: 1 }),
      tx("2026-10-04", "D", -9),
    ];
    expect(forPerson(rows, sarah).map((t) => [t.merchant, t.amount])).toEqual([["A", -40], ["B", -50]]);
  });
  it("scales what was paid back on a shared charge too", () => {
    const [t] = forPerson([tx("2026-10-02", "B", -100, { personId: SHARED, reimbursed: 20 })], sarah);
    expect(t.reimbursed).toBe(10);
  });
  it("leaves the original rows alone", () => {
    const row = tx("2026-10-02", "B", -100, { personId: SHARED });
    forPerson([row], sarah);
    expect(row.amount).toBe(-100);
  });
});

describe("settleUp", () => {
  it("owes half of what's shared, to the cent", () => {
    expect(settleUp(168.01, 2, 0)).toEqual({ owed: 84.01, settled: 0, remaining: 84.01, isSettled: false });
  });
  it("is settled once the amount is paid", () => {
    expect(settleUp(168, 2, 84).isSettled).toBe(true);
  });
  it("owes the difference when more is shared after settling", () => {
    const s = settleUp(200, 2, 84);
    expect(s.remaining).toBe(16);
    expect(s.isSettled).toBe(false);
  });
  it("isn't settled when nothing's shared", () => {
    expect(settleUp(0, 2, 0).isSettled).toBe(false);
  });
});

describe("personNameProblem", () => {
  it("wants a new, real name", () => {
    expect(personNameProblem("  ", [])).toMatch(/name/);
    expect(personNameProblem("sarah", ["Sarah"])).toMatch(/already/);
    expect(personNameProblem("Shared", [])).toMatch(/Pick another/);
    expect(personNameProblem("Everyone", [])).toMatch(/Pick another/);
    expect(personNameProblem("x".repeat(31), [])).toMatch(/under/);
    expect(personNameProblem("Sarah", ["Me"])).toBeNull();
  });
});

describe("person params", () => {
  it("round-trips through a link", () => {
    const params = personParams({ id: 2, name: "Sarah", isMe: false }, 2);
    expect(params).toEqual({ person: "2", personName: "Sarah's", peopleCount: "2" });
    expect(personFilterFromParams(params.person, params.peopleCount)).toEqual({ personId: 2, peopleCount: 2 });
  });
  it("says Your for you, and nothing when no one's picked", () => {
    expect(personParams({ id: 1, name: "Me", isMe: true }, 2).personName).toBe("Your");
    expect(personParams(undefined, 2)).toEqual({});
    expect(personFilterFromParams(undefined, undefined)).toBeUndefined();
    expect(personFilterFromParams("x", "2")).toBeUndefined();
  });
});
