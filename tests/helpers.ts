import type { Transaction } from "../lib/types";

let nextId = 1;

// A transaction with sensible defaults; override only what a test cares about.
export function tx(date: string, merchant: string, amount: number, extra: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId++,
    accountId: 1,
    accountName: "Card",
    date,
    merchant,
    amount,
    categoryId: 1,
    categoryName: "Other",
    needsReview: false,
    ignored: false,
    linkedTransactionId: null,
    linkedMerchant: null,
    linkedAmount: null,
    linkedDate: null,
    linkedAccountName: null,
    note: null,
    tags: [],
    ...extra,
  };
}
