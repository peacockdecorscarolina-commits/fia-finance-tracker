import type { LoanKind } from "./loan";

export type Account = {
  id: number;
  name: string;
  type: string;
  startingBalance: number | null;
  startingBalanceDate: string | null;
  // Checking/Savings accounts count toward Savings & Investments unless turned off.
  includeInSavings: boolean;
};

export type Category = {
  id: number;
  name: string;
  loanAmount: number | null;
  loanAsOfDate: string | null;
  // Annual percentage rate, e.g. 6.5 for 6.5% -- null for no interest.
  loanInterestRate: number | null;
  loanKind: LoanKind | null;
  // Part of each payment that isn't the loan (mortgage escrow) -- null for none.
  loanEscrow: number | null;
  emoji: string | null;
};

export type Transaction = {
  id: number;
  accountId: number;
  accountName: string;
  date: string;
  merchant: string;
  amount: number;
  categoryId: number;
  categoryName: string;
  needsReview: boolean;
  ignored: boolean;
  linkedTransactionId: number | null;
  // The paired transaction's own display fields, pre-joined so showing
  // "linked to X" doesn't need a second query per row.
  linkedMerchant: string | null;
  linkedAmount: number | null;
  linkedDate: string | null;
  linkedAccountName: string | null;
  // Free-text note and free-form tags (lowercase, no "#") the user adds.
  note: string | null;
  tags: string[];
};

// Shape returned by the extraction step (currently on-device, rule-based —
// see lib/parseStatement.ts). Also matches the `record_transactions` tool
// schema in extraction/extract.ts, the paid AI-based alternative.
export type ExtractedTransaction = {
  date: string;
  merchant: string;
  amount: number;
  category: string;
  needsReview: boolean;
};

// "Home" is a property's estimated value -- kept out of the savings totals,
// optionally counted as equity (value minus house loans) on Savings & Investments.
// "Checking" only ever comes from tracked Checking accounts (see
// getBankAssets), never typed in by hand.
export const ASSET_TYPES = ["Checking", "Savings", "Investment", "401k", "Cash", "Home"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export type Asset = {
  id: number;
  name: string;
  type: AssetType;
};

export type AssetBalanceEntry = {
  id: number;
  assetId: number;
  date: string;
  balance: number;
};
