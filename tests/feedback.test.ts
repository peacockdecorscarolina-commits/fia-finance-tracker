import { describe, expect, it } from "vitest";
import { feedbackProblem, feedbackSummary, hideAccountNumbers, sentInLastDay, type FeedbackPayload } from "../lib/feedback";

const base: FeedbackPayload = {
  type: "suggestion",
  message: "",
  email: "",
  cardName: "",
  issuer: "",
  link: "",
  bankName: "",
  bankProblem: "",
  statementText: "",
  screen: "Menu",
  appVersion: "1.0.0",
  browser: "test",
};

describe("hideAccountNumbers", () => {
  it("keeps only the last 4 digits of card and account numbers", () => {
    expect(hideAccountNumbers("Card 4111 1111 1111 1234 ending")).toBe("Card ••••1234 ending");
    expect(hideAccountNumbers("Account number: 0123456789012")).toBe("Account number: ••••9012");
    expect(hideAccountNumbers("Acct 1234-5678-9012")).toBe("Acct ••••9012");
  });

  it("leaves amounts, dates and short numbers alone", () => {
    const line = "10/25/2026 STARBUCKS #1234 $1,240.18 -45.00 Account ending in 4321";
    expect(hideAccountNumbers(line)).toBe(line);
  });
});

describe("feedbackProblem", () => {
  it("asks for what each type needs", () => {
    expect(feedbackProblem(base)).toBe("Write a message first.");
    expect(feedbackProblem({ ...base, message: "Add budgets" })).toBeNull();
    expect(feedbackProblem({ ...base, type: "card" })).toBe("Add the card's name.");
    expect(feedbackProblem({ ...base, type: "card", cardName: "Delta Gold" })).toBeNull();
    expect(feedbackProblem({ ...base, type: "bank", bankName: "Ally" })).toBe("Pick what went wrong.");
    expect(feedbackProblem({ ...base, type: "bank", bankName: "Ally", bankProblem: "Wrong dates" })).toBeNull();
  });

  it("checks the email only when one is given", () => {
    expect(feedbackProblem({ ...base, message: "Hi", email: "nope" })).toBe("That email doesn't look right.");
    expect(feedbackProblem({ ...base, message: "Hi", email: "a@b.co" })).toBeNull();
  });
});

describe("feedbackSummary", () => {
  it("names what the message is about", () => {
    expect(feedbackSummary({ ...base, type: "card", issuer: "Amex", cardName: "Delta Gold" })).toBe("Amex Delta Gold");
    expect(feedbackSummary({ ...base, type: "bank", bankName: "Ally", bankProblem: "Wrong dates" })).toBe("Ally: Wrong dates");
    expect(feedbackSummary({ ...base, message: "First line\nmore" })).toBe("First line");
  });
});

describe("sentInLastDay", () => {
  it("counts only the last 24 hours", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const item = (sentAt: string) => ({ id: sentAt, type: "suggestion" as const, summary: "", sentAt, status: "sent" as const });
    expect(sentInLastDay([item("2026-10-26T08:00:00Z"), item("2026-10-25T13:00:00Z"), item("2026-10-24T12:00:00Z")], now)).toBe(2);
  });
});
