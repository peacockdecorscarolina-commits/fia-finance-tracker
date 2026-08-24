export type Account = {
  id: number;
  name: string;
  type: string;
};

export type Category = {
  id: number;
  name: string;
  loanAmount: number | null;
  loanAsOfDate: string | null;
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

export const ASSET_TYPES = ["Savings", "Investment", "401k", "Cash"] as const;
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
