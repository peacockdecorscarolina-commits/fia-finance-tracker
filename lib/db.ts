import type { SQLiteDatabase } from "expo-sqlite";
import { DEFAULT_CATEGORIES } from "./categories";
import { DEFAULT_ACCOUNTS } from "./defaultAccounts";
import type { Account, Category, ExtractedTransaction, Transaction } from "./types";

// Merchant memory (merchant_category_map) only helps if the same merchant
// produces the same key across different statements -- but several issuers'
// multi-line entries (see parseStatement.ts) end up with per-transaction
// noise baked into the extracted merchant text: Wells Fargo prefixes a
// unique reference number before the real name, and Bilt/Amex append an
// address or a flight's ticket number after it. Left as plain trim+
// uppercase, every occurrence of what's really the same merchant would get
// a different key, and memory would never match twice.
export function normalizeMerchantKey(merchant: string): string {
  const words = merchant.trim().split(/\s+/);
  // Drop a leading reference/transaction-number-like token some issuers
  // print before the actual merchant name (e.g. Wells Fargo's
  // "7446539AS0XSLH5J3"): long, and dense with digits. The digit-count
  // threshold (not just "starts with a digit") is what keeps this from
  // misfiring on a real merchant name that happens to start with a number,
  // like "7-Eleven".
  const digitCount = (words[0].match(/\d/g) ?? []).length;
  if (words.length > 1 && words[0].length >= 10 && digitCount >= 3 && /^\d/.test(words[0]) && /[A-Za-z]/.test(words[0])) {
    words.shift();
  }
  // Keep matching stable even when trailing noise (an address, a ticket
  // number) couldn't be cleanly separated from the actual merchant name --
  // the first few words are consistently the real one.
  return words.slice(0, 5).join(" ").toUpperCase();
}

export async function initDatabase(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS merchant_category_map (
      merchant_key TEXT PRIMARY KEY NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      date TEXT NOT NULL,
      merchant TEXT NOT NULL,
      amount REAL NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      needs_review INTEGER NOT NULL DEFAULT 0,
      ignored INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migration for databases created before the `ignored` column existed.
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
  if (!columns.some((c) => c.name === "ignored")) {
    await db.execAsync("ALTER TABLE transactions ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0");
  }

  const existing = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM categories"
  );
  if (existing?.count === 0) {
    for (const name of DEFAULT_CATEGORIES) {
      await db.runAsync("INSERT INTO categories (name) VALUES (?)", name);
    }
  }

  for (const account of DEFAULT_ACCOUNTS) {
    const found = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM accounts WHERE name = ?",
      account.name
    );
    if (!found) {
      await db.runAsync(
        "INSERT INTO accounts (name, type) VALUES (?, ?)",
        account.name,
        account.type
      );
    }
  }
}

export async function getCategories(db: SQLiteDatabase): Promise<Category[]> {
  return db.getAllAsync<Category>("SELECT id, name FROM categories ORDER BY name");
}

async function getCategoryIdByName(db: SQLiteDatabase, name: string): Promise<number> {
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM categories WHERE name = ?",
    name
  );
  if (row) return row.id;
  const fallback = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM categories WHERE name = ?",
    "Other"
  );
  return fallback!.id;
}

export async function insertCategory(db: SQLiteDatabase, name: string): Promise<number> {
  const result = await db.runAsync("INSERT INTO categories (name) VALUES (?)", name);
  return result.lastInsertRowId;
}

export async function renameCategory(db: SQLiteDatabase, id: number, name: string) {
  await db.runAsync("UPDATE categories SET name = ? WHERE id = ?", name, id);
}

export async function insertAccount(
  db: SQLiteDatabase,
  name: string,
  type: string
): Promise<number> {
  const result = await db.runAsync(
    "INSERT INTO accounts (name, type) VALUES (?, ?)",
    name,
    type
  );
  return result.lastInsertRowId;
}

export async function getAccounts(db: SQLiteDatabase): Promise<Account[]> {
  return db.getAllAsync<Account>("SELECT id, name, type FROM accounts ORDER BY name");
}

// Inserts extracted transactions, checking local merchant memory first: a
// merchant we've already categorized before is trusted over the extraction's
// own guess, and doesn't need review again.
export async function insertExtractedTransactions(
  db: SQLiteDatabase,
  accountId: number,
  extracted: ExtractedTransaction[]
) {
  for (const t of extracted) {
    const key = normalizeMerchantKey(t.merchant);
    const known = await db.getFirstAsync<{ category_id: number }>(
      "SELECT category_id FROM merchant_category_map WHERE merchant_key = ?",
      key
    );

    let categoryId: number;
    let needsReview: boolean;
    if (known) {
      categoryId = known.category_id;
      needsReview = false;
    } else {
      categoryId = await getCategoryIdByName(db, t.category);
      needsReview = t.needsReview;
    }

    await db.runAsync(
      "INSERT INTO transactions (account_id, date, merchant, amount, category_id, needs_review, ignored) VALUES (?, ?, ?, ?, ?, ?, 0)",
      accountId,
      t.date,
      t.merchant,
      t.amount,
      categoryId,
      needsReview ? 1 : 0
    );
  }
}

const TRANSACTION_SELECT = `
  SELECT
    transactions.id as id,
    transactions.account_id as accountId,
    accounts.name as accountName,
    transactions.date as date,
    transactions.merchant as merchant,
    transactions.amount as amount,
    transactions.category_id as categoryId,
    categories.name as categoryName,
    transactions.needs_review as needsReview,
    transactions.ignored as ignored
  FROM transactions
  JOIN accounts ON accounts.id = transactions.account_id
  JOIN categories ON categories.id = transactions.category_id
`;

type TransactionRow = Omit<Transaction, "needsReview" | "ignored"> & {
  needsReview: number;
  ignored: number;
};

function toTransaction(row: TransactionRow): Transaction {
  return { ...row, needsReview: row.needsReview === 1, ignored: row.ignored === 1 };
}

export async function setTransactionIgnored(db: SQLiteDatabase, id: number, ignored: boolean) {
  await db.runAsync("UPDATE transactions SET ignored = ? WHERE id = ?", ignored ? 1 : 0, id);
}

export async function getTransactions(
  db: SQLiteDatabase,
  filters?: { accountId?: number; start?: string; end?: string; categoryName?: string }
): Promise<Transaction[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters?.accountId !== undefined) {
    clauses.push("transactions.account_id = ?");
    params.push(filters.accountId);
  }
  if (filters?.start) {
    clauses.push("transactions.date >= ?");
    params.push(filters.start);
  }
  if (filters?.end) {
    clauses.push("transactions.date <= ?");
    params.push(filters.end);
  }
  if (filters?.categoryName) {
    clauses.push("LOWER(categories.name) = LOWER(?)");
    params.push(filters.categoryName);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT} ${where} ORDER BY transactions.date DESC`,
    ...params
  );
  return rows.map(toTransaction);
}

// Reassigns transactions from one account to another within a date range --
// for fixing a statement that got uploaded/saved under the wrong account.
export async function moveTransactions(
  db: SQLiteDatabase,
  params: { fromAccountId: number; toAccountId: number; start: string; end: string }
): Promise<number> {
  const result = await db.runAsync(
    "UPDATE transactions SET account_id = ? WHERE account_id = ? AND date >= ? AND date <= ?",
    params.toAccountId,
    params.fromAccountId,
    params.start,
    params.end
  );
  return result.changes;
}

// Ignoring a transaction is how you tell the review queue "I've looked at
// this, leave it alone" without picking a category -- it still needs to
// stay visible everywhere else (transaction list, category drill-down),
// just not nag for review anymore.
export async function getNeedsReview(db: SQLiteDatabase): Promise<Transaction[]> {
  const rows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT} WHERE transactions.needs_review = 1 AND transactions.ignored = 0 ORDER BY transactions.date DESC`
  );
  return rows.map(toTransaction);
}

export async function getNeedsReviewCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM transactions WHERE needs_review = 1 AND ignored = 0"
  );
  return row?.count ?? 0;
}

// Records the user's category choice for a merchant, then applies it to
// every past transaction from that merchant too (not just future ones).
export async function setMerchantCategory(
  db: SQLiteDatabase,
  merchant: string,
  categoryId: number
) {
  const key = normalizeMerchantKey(merchant);
  await db.runAsync(
    "INSERT OR REPLACE INTO merchant_category_map (merchant_key, category_id) VALUES (?, ?)",
    key,
    categoryId
  );
  // Match on the same normalized key used above (reference-code/trailing-noise
  // stripped), not a raw UPPER(TRIM(merchant)) comparison -- otherwise this
  // silently misses every transaction normalizeMerchantKey was written to
  // still match (e.g. Wells Fargo's per-transaction reference-code prefix).
  const rows = await db.getAllAsync<{ id: number; merchant: string }>(
    "SELECT id, merchant FROM transactions"
  );
  const matchingIds = rows.filter((r) => normalizeMerchantKey(r.merchant) === key).map((r) => r.id);
  for (const id of matchingIds) {
    await db.runAsync("UPDATE transactions SET category_id = ?, needs_review = 0 WHERE id = ?", categoryId, id);
  }
}

// Category name treated as "real" income (paychecks, deposits). Any other
// positive-amount transaction is treated as a refund/credit that nets
// against its category's expenses instead of counting as separate income --
// e.g. a $500 purchase with a later $13 return shows as $487 of expenses,
// not $500 of expenses plus $13 of income.
const INCOME_CATEGORY_NAME = "Income";
// Category name treated as a card/debt payment -- fully separate from both
// Income and Expenses (like a transfer, not spending or earning), with its
// own visible monthly total instead.
const PAYMENT_CATEGORY_NAME = "Payment";

export type IncomeExpenseTotals = { income: number; expenses: number; payments: number };

export async function getIncomeExpenseTotals(
  db: SQLiteDatabase,
  filters: { accountId?: number; start: string; end: string }
): Promise<IncomeExpenseTotals> {
  const clauses = ["transactions.date >= ?", "transactions.date <= ?", "transactions.ignored = 0"];
  const params: (string | number)[] = [filters.start, filters.end];
  if (filters.accountId !== undefined) {
    clauses.push("transactions.account_id = ?");
    params.push(filters.accountId);
  }
  const row = await db.getFirstAsync<{
    income: number | null;
    expenses: number | null;
    payments: number | null;
  }>(
    `SELECT
       SUM(CASE WHEN LOWER(categories.name) = LOWER(?) THEN transactions.amount ELSE 0 END) as income,
       SUM(CASE WHEN LOWER(categories.name) NOT IN (LOWER(?), LOWER(?)) THEN -transactions.amount ELSE 0 END) as expenses,
       SUM(CASE WHEN LOWER(categories.name) = LOWER(?) THEN transactions.amount ELSE 0 END) as payments
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE ${clauses.join(" AND ")}`,
    INCOME_CATEGORY_NAME,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    ...params
  );
  return { income: row?.income ?? 0, expenses: row?.expenses ?? 0, payments: row?.payments ?? 0 };
}

export type MonthlyTotal = { month: string; income: number; expenses: number };

// Returns income/expense totals for the last `months` calendar months that
// have any transactions, oldest first, for charting.
export async function getMonthlyTotals(
  db: SQLiteDatabase,
  months: number
): Promise<MonthlyTotal[]> {
  const rows = await db.getAllAsync<MonthlyTotal>(
    `SELECT
       substr(transactions.date, 1, 7) as month,
       SUM(CASE WHEN LOWER(categories.name) = LOWER(?) THEN transactions.amount ELSE 0 END) as income,
       SUM(CASE WHEN LOWER(categories.name) NOT IN (LOWER(?), LOWER(?)) THEN -transactions.amount ELSE 0 END) as expenses
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.ignored = 0
     GROUP BY month
     ORDER BY month DESC
     LIMIT ?`,
    INCOME_CATEGORY_NAME,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    months
  );
  return rows.reverse();
}

export async function getLatestTransactionMonth(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ maxDate: string | null }>(
    "SELECT MAX(date) as maxDate FROM transactions"
  );
  return row?.maxDate ? row.maxDate.slice(0, 7) : null;
}

export type CategoryTotal = { categoryName: string; total: number };

export async function getCategorySummary(
  db: SQLiteDatabase,
  month: string
): Promise<CategoryTotal[]> {
  return db.getAllAsync<CategoryTotal>(
    `SELECT categories.name as categoryName, SUM(-transactions.amount) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.date LIKE ? AND transactions.ignored = 0 AND LOWER(categories.name) NOT IN (LOWER(?), LOWER(?))
     GROUP BY categories.name
     ORDER BY total DESC`,
    `${month}%`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME
  );
}

// Total paid toward cards/debt (the Payment category) for a given month --
// shown as its own figure since Payment is excluded from both Income and
// Expenses (see getIncomeExpenseTotals).
export async function getPaymentTotal(db: SQLiteDatabase, month: string): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(transactions.amount) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.date LIKE ? AND transactions.ignored = 0 AND LOWER(categories.name) = LOWER(?)`,
    `${month}%`,
    PAYMENT_CATEGORY_NAME
  );
  return row?.total ?? 0;
}

// Full snapshot of user data for backup/restore (e.g. syncing to Google
// Drive). Rows are keyed by name/merchant instead of raw ids, since ids
// aren't stable across a restore into a fresh database.
export type DataSnapshot = {
  version: 1;
  exportedAt: string;
  accounts: { name: string; type: string }[];
  categories: { name: string }[];
  merchantCategoryMap: { merchantKey: string; categoryName: string }[];
  transactions: {
    accountName: string;
    date: string;
    merchant: string;
    amount: number;
    categoryName: string;
    needsReview: boolean;
    ignored: boolean;
  }[];
};

export async function exportAllData(db: SQLiteDatabase): Promise<DataSnapshot> {
  const accounts = await db.getAllAsync<{ name: string; type: string }>(
    "SELECT name, type FROM accounts ORDER BY id"
  );
  const categories = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM categories ORDER BY id"
  );
  const merchantCategoryMap = await db.getAllAsync<{ merchantKey: string; categoryName: string }>(
    `SELECT merchant_category_map.merchant_key as merchantKey, categories.name as categoryName
     FROM merchant_category_map
     JOIN categories ON categories.id = merchant_category_map.category_id`
  );
  const transactions = await db.getAllAsync<{
    accountName: string;
    date: string;
    merchant: string;
    amount: number;
    categoryName: string;
    needsReview: number;
    ignored: number;
  }>(
    `SELECT
       accounts.name as accountName,
       transactions.date as date,
       transactions.merchant as merchant,
       transactions.amount as amount,
       categories.name as categoryName,
       transactions.needs_review as needsReview,
       transactions.ignored as ignored
     FROM transactions
     JOIN accounts ON accounts.id = transactions.account_id
     JOIN categories ON categories.id = transactions.category_id
     ORDER BY transactions.id`
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts,
    categories,
    merchantCategoryMap,
    transactions: transactions.map((t) => ({
      ...t,
      needsReview: t.needsReview === 1,
      ignored: t.ignored === 1,
    })),
  };
}

// Replaces all local data with the given snapshot -- used to restore from a
// Google Drive backup. Existing local data is discarded, so this is meant
// for restoring onto a fresh/empty database, not merging.
export async function replaceAllData(db: SQLiteDatabase, snapshot: DataSnapshot) {
  await db.execAsync(
    "DELETE FROM transactions; DELETE FROM merchant_category_map; DELETE FROM categories; DELETE FROM accounts;"
  );

  const categoryIds = new Map<string, number>();
  for (const category of snapshot.categories) {
    const result = await db.runAsync("INSERT INTO categories (name) VALUES (?)", category.name);
    categoryIds.set(category.name, result.lastInsertRowId);
  }

  const accountIds = new Map<string, number>();
  for (const account of snapshot.accounts) {
    const result = await db.runAsync(
      "INSERT INTO accounts (name, type) VALUES (?, ?)",
      account.name,
      account.type
    );
    accountIds.set(account.name, result.lastInsertRowId);
  }

  for (const entry of snapshot.merchantCategoryMap) {
    const categoryId = categoryIds.get(entry.categoryName);
    if (categoryId === undefined) continue;
    await db.runAsync(
      "INSERT OR REPLACE INTO merchant_category_map (merchant_key, category_id) VALUES (?, ?)",
      entry.merchantKey,
      categoryId
    );
  }

  for (const t of snapshot.transactions) {
    const accountId = accountIds.get(t.accountName);
    const categoryId = categoryIds.get(t.categoryName);
    if (accountId === undefined || categoryId === undefined) continue;
    await db.runAsync(
      "INSERT INTO transactions (account_id, date, merchant, amount, category_id, needs_review, ignored) VALUES (?, ?, ?, ?, ?, ?, ?)",
      accountId,
      t.date,
      t.merchant,
      t.amount,
      categoryId,
      t.needsReview ? 1 : 0,
      t.ignored ? 1 : 0
    );
  }
}

export type AccountTotal = { accountName: string; total: number };

export async function getAccountSummary(
  db: SQLiteDatabase,
  month: string
): Promise<AccountTotal[]> {
  return db.getAllAsync<AccountTotal>(
    `SELECT accounts.name as accountName, SUM(-transactions.amount) as total
     FROM transactions
     JOIN accounts ON accounts.id = transactions.account_id
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.date LIKE ? AND transactions.ignored = 0 AND LOWER(categories.name) NOT IN (LOWER(?), LOWER(?))
     GROUP BY accounts.name
     ORDER BY total DESC`,
    `${month}%`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME
  );
}
