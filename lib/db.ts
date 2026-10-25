import type { SQLiteDatabase } from "expo-sqlite";
import { simulateLoan, type LoanStatus } from "./loan";
import { DEFAULT_CATEGORIES } from "./categories";
import type { Account, Asset, AssetBalanceEntry, AssetType, Category, ExtractedTransaction, Transaction } from "./types";
import { loadCategoryEmojiOverrides, setCategoryEmojiOverride } from "./categoryStyle";

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
  let rest = words;
  if (rest.length > 1 && rest[0].length >= 10 && digitCount >= 3 && /^\d/.test(rest[0]) && /[A-Za-z]/.test(rest[0])) {
    rest = rest.slice(1);
  }
  // Bank transfer descriptions (checking statements) often embed a
  // per-transaction reference or an encoded date within the first few
  // words, not only trailing -- e.g. "Jpmorgan Chase Ext Trnsfr 260924
  // 30507479156 Talha Gill", where "260924" changes every month. Left in,
  // the same recurring transfer would hash to a different key each time it
  // posts and merchant memory could never learn it. A bare run of 5+ digits
  // never belongs to a real merchant name, so it's dropped wherever it
  // appears rather than only when leading.
  rest = rest.filter((w) => !/^\d{5,}$/.test(w));
  // Keep matching stable even when trailing noise (an address, a ticket
  // number) couldn't be cleanly separated from the actual merchant name --
  // the first few words are consistently the real one.
  return rest.slice(0, 5).join(" ").toUpperCase();
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
    CREATE TABLE IF NOT EXISTS dismissed_transfer_matches (
      a_id INTEGER NOT NULL,
      b_id INTEGER NOT NULL,
      PRIMARY KEY (a_id, b_id)
    );
    CREATE TABLE IF NOT EXISTS balance_checkpoints (
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      date TEXT NOT NULL,
      balance REAL NOT NULL,
      PRIMARY KEY (account_id, date)
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
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS asset_balances (
      id INTEGER PRIMARY KEY NOT NULL,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      date TEXT NOT NULL,
      balance REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
  `);

  // Migration for databases created before the `ignored` column existed.
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
  if (!columns.some((c) => c.name === "ignored")) {
    await db.execAsync("ALTER TABLE transactions ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0");
  }
  // Migration for databases created before transfer linking existed (e.g.
  // the $800 withdrawal on a checking statement that pays off a credit
  // card, paired with that same $800 showing as a payment credit on the
  // card's own statement -- two transactions, one real transfer).
  if (!columns.some((c) => c.name === "linked_transaction_id")) {
    await db.execAsync(
      "ALTER TABLE transactions ADD COLUMN linked_transaction_id INTEGER REFERENCES transactions(id)"
    );
  }

  // Migration for databases created before the `loan_amount` column existed.
  const categoryColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(categories)");
  if (!categoryColumns.some((c) => c.name === "loan_amount")) {
    await db.execAsync("ALTER TABLE categories ADD COLUMN loan_amount REAL");
  }
  if (!categoryColumns.some((c) => c.name === "loan_as_of_date")) {
    await db.execAsync("ALTER TABLE categories ADD COLUMN loan_as_of_date TEXT");
  }
  if (!categoryColumns.some((c) => c.name === "loan_interest_rate")) {
    await db.execAsync("ALTER TABLE categories ADD COLUMN loan_interest_rate REAL");
  }
  if (!categoryColumns.some((c) => c.name === "emoji")) {
    await db.execAsync("ALTER TABLE categories ADD COLUMN emoji TEXT");
  }

  // Migration for databases created before per-account balance tracking
  // existed.
  const accountColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(accounts)");
  if (!accountColumns.some((c) => c.name === "starting_balance")) {
    await db.execAsync("ALTER TABLE accounts ADD COLUMN starting_balance REAL");
  }
  if (!accountColumns.some((c) => c.name === "starting_balance_date")) {
    await db.execAsync("ALTER TABLE accounts ADD COLUMN starting_balance_date TEXT");
  }

  // Migration for databases created before balance tracking moved from a
  // single anchor per account to a checkpoint per uploaded statement (see
  // getAccountBalanceAsOf) -- carries over whatever anchor was already set
  // as that account's first checkpoint, so existing balance tracking isn't
  // lost, rather than silently resetting to nothing.
  await db.execAsync(`
    INSERT OR IGNORE INTO balance_checkpoints (account_id, date, balance)
    SELECT id, starting_balance_date, starting_balance FROM accounts
    WHERE starting_balance IS NOT NULL AND starting_balance_date IS NOT NULL
  `);

  const existing = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM categories"
  );
  if (existing?.count === 0) {
    for (const name of DEFAULT_CATEGORIES) {
      await db.runAsync("INSERT INTO categories (name) VALUES (?)", name);
    }
  } else {
    // Targeted backfill for a database that already existed before
    // "Payment" was added to DEFAULT_CATEGORIES above -- unlike that
    // first-launch seed, this only adds the one category by name (case-
    // insensitive) rather than re-running the whole list, so it can't
    // resurrect some other default category the user deliberately deleted.
    const hasPayment = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM categories WHERE LOWER(name) = LOWER(?)",
      "Payment"
    );
    if (!hasPayment) {
      await db.runAsync("INSERT INTO categories (name) VALUES (?)", "Payment");
    }
  }

  const emojiOverrides = await db.getAllAsync<{ name: string; emoji: string }>(
    "SELECT name, emoji FROM categories WHERE emoji IS NOT NULL"
  );
  loadCategoryEmojiOverrides(emojiOverrides);
  // No accounts are seeded -- a new user starts empty and adds their own
  // cards, rather than inheriting a hard-coded list.
}

// Small key/value store for per-device preferences. null = never set.
export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>("SELECT value FROM settings WHERE key = ?", key);
  return row ? (row.value ?? "") : null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value);
}

const USER_NAME_KEY = "user_name";

// null = never asked (show the welcome prompt); "" = they chose to skip it.
export async function getUserName(db: SQLiteDatabase): Promise<string | null> {
  return getSetting(db, USER_NAME_KEY);
}

export async function setUserName(db: SQLiteDatabase, name: string) {
  await setSetting(db, USER_NAME_KEY, name.trim());
}

export async function getCategories(db: SQLiteDatabase): Promise<Category[]> {
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    loan_amount: number | null;
    loan_as_of_date: string | null;
    loan_interest_rate: number | null;
    emoji: string | null;
  }>("SELECT id, name, loan_amount, loan_as_of_date, loan_interest_rate, emoji FROM categories ORDER BY name");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    loanAmount: r.loan_amount,
    loanAsOfDate: r.loan_as_of_date,
    loanInterestRate: r.loan_interest_rate,
    emoji: r.emoji,
  }));
}

export async function setCategoryLoanAmount(
  db: SQLiteDatabase,
  id: number,
  loanAmount: number | null,
  loanAsOfDate: string | null,
  loanInterestRate: number | null = null
) {
  await db.runAsync(
    "UPDATE categories SET loan_amount = ?, loan_as_of_date = ?, loan_interest_rate = ? WHERE id = ?",
    loanAmount,
    loanAsOfDate,
    loanInterestRate,
    id
  );
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

export async function insertCategory(
  db: SQLiteDatabase,
  name: string,
  emoji?: string | null
): Promise<number> {
  const result = await db.runAsync(
    "INSERT INTO categories (name, emoji) VALUES (?, ?)",
    name,
    emoji || null
  );
  if (emoji) setCategoryEmojiOverride(name, emoji);
  return result.lastInsertRowId;
}

export async function renameCategory(db: SQLiteDatabase, id: number, name: string) {
  await db.runAsync("UPDATE categories SET name = ? WHERE id = ?", name, id);
}

export async function setCategoryEmoji(db: SQLiteDatabase, id: number, name: string, emoji: string | null) {
  await db.runAsync("UPDATE categories SET emoji = ? WHERE id = ?", emoji || null, id);
  setCategoryEmojiOverride(name, emoji);
}

// Deleting a category reassigns its transactions to "Other" rather than
// deleting them -- unlike an account or asset, a category is just a label,
// and the underlying spend data is still meaningful without it.
export async function deleteCategory(db: SQLiteDatabase, id: number, name: string) {
  const other = await db.getFirstAsync<{ id: number }>("SELECT id FROM categories WHERE name = ?", "Other");
  if (other && other.id !== id) {
    await db.runAsync("UPDATE transactions SET category_id = ? WHERE category_id = ?", other.id, id);
  }
  await db.runAsync("DELETE FROM merchant_category_map WHERE category_id = ?", id);
  await db.runAsync("DELETE FROM categories WHERE id = ?", id);
  // Without this, a deleted category's custom emoji lingers in the
  // in-memory override map (keyed by name, not id) and would silently get
  // inherited by a new category created later under the same name.
  setCategoryEmojiOverride(name, null);
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

// startingBalance/startingBalanceDate reflect the single most recent
// checkpoint (see balance_checkpoints / getAccountBalanceAsOf below) --
// enough for the Accounts screen's edit panel to show/prefill "the"
// balance, even though the real calculation can draw on any checkpoint,
// not just this latest one.
export async function getAccounts(db: SQLiteDatabase): Promise<Account[]> {
  return db.getAllAsync<Account>(
    `SELECT accounts.id, accounts.name, accounts.type,
       latest.balance as startingBalance,
       latest.date as startingBalanceDate
     FROM accounts
     LEFT JOIN balance_checkpoints latest ON latest.account_id = accounts.id
       AND latest.date = (
         SELECT MAX(date) FROM balance_checkpoints WHERE account_id = accounts.id
       )
     ORDER BY accounts.name`
  );
}

export async function renameAccount(db: SQLiteDatabase, id: number, name: string) {
  await db.runAsync("UPDATE accounts SET name = ? WHERE id = ?", name, id);
}

export async function deleteAccount(db: SQLiteDatabase, id: number) {
  await db.runAsync("DELETE FROM transactions WHERE account_id = ?", id);
  await db.runAsync("DELETE FROM balance_checkpoints WHERE account_id = ?", id);
  await db.runAsync("DELETE FROM accounts WHERE id = ?", id);
}

// Records a balance checkpoint for this account as of this date -- used
// both for the user's explicit manual edit on the Accounts screen and for
// an uploaded statement's own printed ending balance (see
// findStatementEndingBalance). Every statement you ever upload gets its own
// checkpoint rather than one being overwritten by the next: computing a
// balance for any given date (getAccountBalanceAsOf) uses whichever
// checkpoint is *nearest* to that date, so a months-old upload still
// anchors that month directly instead of the number having to be derived
// by walking the full transaction history all the way from today's
// checkpoint, where any gap or duplicate in between compounds into error.
export async function setAccountBalanceCheckpoint(
  db: SQLiteDatabase,
  accountId: number,
  balance: number,
  asOfDate: string
) {
  await db.runAsync(
    "INSERT INTO balance_checkpoints (account_id, date, balance) VALUES (?, ?, ?) " +
      "ON CONFLICT (account_id, date) DO UPDATE SET balance = excluded.balance",
    accountId,
    asOfDate,
    balance
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Balance for one account as of a given date (defaults to today), computed
// from whichever checkpoint is *nearest* to that date -- not always the
// single most recent upload -- then walking forward or backward through
// just the transactions between that checkpoint and the target date.
// Unlike spend summaries, this deliberately does NOT filter out ignored
// transactions: a linked transfer still really left the account, so it
// still has to count here even though it's excluded from spend totals.
// Returns null if the account has no checkpoint at all yet.
//
// Using the nearest checkpoint instead of always the latest one matters:
// every statement you upload already has its own verified printed ending
// balance, so a January statement should anchor January directly, not
// force deriving January's balance by walking backward through everything
// that happened between January and whatever the most recent upload was
// (October, say) -- any gap or duplicate transaction in that stretch would
// throw the derived figure off, even though a perfectly good, directly
// verified answer already existed much closer by.
export async function getAccountBalanceAsOf(
  db: SQLiteDatabase,
  accountId: number,
  asOfDate?: string
): Promise<number | null> {
  const target = asOfDate ?? todayISO();
  const checkpoint = await db.getFirstAsync<{ date: string; balance: number }>(
    `SELECT date, balance FROM balance_checkpoints
     WHERE account_id = ?
     ORDER BY ABS(JULIANDAY(date) - JULIANDAY(?)) ASC
     LIMIT 1`,
    accountId,
    target
  );
  if (!checkpoint) return null;
  const row = await db.getFirstAsync<{ delta: number | null }>(
    `SELECT SUM(CASE
        WHEN ? >= ? THEN CASE WHEN transactions.date > ? AND transactions.date <= ? THEN transactions.amount ELSE 0 END
        ELSE CASE WHEN transactions.date > ? AND transactions.date <= ? THEN -transactions.amount ELSE 0 END
      END) as delta
     FROM transactions
     WHERE account_id = ?`,
    target,
    checkpoint.date,
    checkpoint.date,
    target,
    target,
    checkpoint.date,
    accountId
  );
  return checkpoint.balance + (row?.delta ?? 0);
}

// Same as getAccountBalanceAsOf, batched for every account that has at
// least one checkpoint -- used by screens showing several accounts at once
// (Accounts, Summary's By account).
export async function getAccountBalances(
  db: SQLiteDatabase,
  asOfDate?: string
): Promise<Record<number, number>> {
  const accountIds = await db.getAllAsync<{ accountId: number }>(
    "SELECT DISTINCT account_id as accountId FROM balance_checkpoints"
  );
  const result: Record<number, number> = {};
  for (const { accountId } of accountIds) {
    const balance = await getAccountBalanceAsOf(db, accountId, asOfDate);
    if (balance !== null) result[accountId] = balance;
  }
  return result;
}

function dayBefore(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type TransactionWithBalance = Transaction & { balanceAfter: number };

// A per-transaction running balance for one account's checking-style
// ledger view, scoped to a single month -- the balance at the moment just
// before the month starts (via getAccountBalances, same anchor math used
// everywhere else), then walked forward through that month's transactions
// in chronological order, accumulating as it goes. Chronological is the
// opposite of every other transaction list in the app (newest first), so
// the result is reversed back to newest-first right before returning, with
// each transaction keeping the balance it produced.
export async function getAccountLedgerForMonth(
  db: SQLiteDatabase,
  accountId: number,
  month: string
): Promise<TransactionWithBalance[]> {
  const [year, m] = month.split("-").map(Number);
  const monthStart = `${year}-${String(m).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(m).padStart(2, "0")}-${String(new Date(year, m, 0).getDate()).padStart(2, "0")}`;

  let running = (await getAccountBalanceAsOf(db, accountId, dayBefore(monthStart))) ?? 0;

  const rows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT} WHERE transactions.account_id = ? AND transactions.date >= ? AND transactions.date <= ?
     ORDER BY transactions.date ASC, transactions.id ASC`,
    accountId,
    monthStart,
    monthEnd
  );

  const withBalance: TransactionWithBalance[] = rows.map((row) => {
    const transaction = toTransaction(row);
    running += transaction.amount;
    return { ...transaction, balanceAfter: running };
  });

  return withBalance.reverse();
}

export async function insertAsset(db: SQLiteDatabase, name: string, type: AssetType): Promise<number> {
  const result = await db.runAsync("INSERT INTO assets (name, type) VALUES (?, ?)", name, type);
  return result.lastInsertRowId;
}

export async function getAssets(db: SQLiteDatabase): Promise<Asset[]> {
  return db.getAllAsync<Asset>("SELECT id, name, type FROM assets ORDER BY name");
}

export async function renameAsset(db: SQLiteDatabase, id: number, name: string) {
  await db.runAsync("UPDATE assets SET name = ? WHERE id = ?", name, id);
}

export async function deleteAsset(db: SQLiteDatabase, id: number) {
  await db.runAsync("DELETE FROM asset_balances WHERE asset_id = ?", id);
  await db.runAsync("DELETE FROM assets WHERE id = ?", id);
}

export async function addAssetBalance(db: SQLiteDatabase, assetId: number, date: string, balance: number) {
  await db.runAsync(
    "INSERT INTO asset_balances (asset_id, date, balance) VALUES (?, ?, ?)",
    assetId,
    date,
    balance
  );
}

export async function getAssetBalances(db: SQLiteDatabase, assetId: number): Promise<AssetBalanceEntry[]> {
  return db.getAllAsync<AssetBalanceEntry>(
    "SELECT id, asset_id as assetId, date, balance FROM asset_balances WHERE asset_id = ? ORDER BY date ASC, id ASC",
    assetId
  );
}

// Lightweight summary for the Overview screen -- just each asset's latest
// logged balance, not its full history.
export async function getAssetSummaries(
  db: SQLiteDatabase
): Promise<{ id: number; name: string; type: AssetType; balance: number }[]> {
  const assets = await getAssets(db);
  const results = [];
  for (const a of assets) {
    const latest = await db.getFirstAsync<{ balance: number }>(
      "SELECT balance FROM asset_balances WHERE asset_id = ? ORDER BY date DESC, id DESC LIMIT 1",
      a.id
    );
    results.push({ id: a.id, name: a.name, type: a.type, balance: latest?.balance ?? 0 });
  }
  return results;
}

// Combined balance-over-time for every asset of a given type -- e.g. if you
// have two Investment accounts, this sums their balances on each date one
// of them was updated, so the Investing panel can show one trend line
// instead of per-account ones.
export async function getAssetTypeHistory(
  db: SQLiteDatabase,
  type: AssetType
): Promise<{ date: string; total: number }[]> {
  const assets = await getAssets(db);
  const matching = assets.filter((a) => a.type === type);
  if (matching.length === 0) return [];

  const latestPerAsset = new Map<number, number>();
  const byDate = new Map<string, number>();
  const allEntries: { assetId: number; date: string; balance: number }[] = [];
  for (const a of matching) {
    const entries = await getAssetBalances(db, a.id);
    allEntries.push(...entries.map((e) => ({ assetId: a.id, date: e.date, balance: e.balance })));
  }
  allEntries.sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of allEntries) {
    latestPerAsset.set(entry.assetId, entry.balance);
    let total = 0;
    for (const bal of latestPerAsset.values()) total += bal;
    byDate.set(entry.date, total);
  }
  return [...byDate.entries()].map(([date, total]) => ({ date, total }));
}

// Combined balance-over-time across every asset regardless of type -- powers
// the total savings & investments trend chart.
export async function getAllAssetsHistory(db: SQLiteDatabase): Promise<{ date: string; total: number }[]> {
  const assets = await getAssets(db);
  if (assets.length === 0) return [];

  const latestPerAsset = new Map<number, number>();
  const byDate = new Map<string, number>();
  const allEntries: { assetId: number; date: string; balance: number }[] = [];
  for (const a of assets) {
    const entries = await getAssetBalances(db, a.id);
    allEntries.push(...entries.map((e) => ({ assetId: a.id, date: e.date, balance: e.balance })));
  }
  allEntries.sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of allEntries) {
    latestPerAsset.set(entry.assetId, entry.balance);
    let total = 0;
    for (const bal of latestPerAsset.values()) total += bal;
    byDate.set(entry.date, total);
  }
  return [...byDate.entries()].map(([date, total]) => ({ date, total }));
}

// Remaining balance for every category tracked as a loan -- mirrors the
// per-category math on the category detail page (only payments dated after
// loan_as_of_date count against the loan amount).
// Balance, interest so far and monthly history for one tracked loan, from
// its known balance plus every (non-ignored) payment since -- see simulateLoan.
export async function getLoanStatus(
  db: SQLiteDatabase,
  categoryName: string,
  loanAmount: number,
  loanAsOfDate: string,
  loanInterestRate: number | null
): Promise<LoanStatus> {
  const txs = await getTransactions(db, { categoryName });
  const payments = txs.filter((t) => !t.ignored).map((t) => ({ date: t.date, amount: t.amount }));
  return simulateLoan(loanAmount, loanAsOfDate, loanInterestRate, payments);
}

export async function getLoanSummaries(db: SQLiteDatabase): Promise<
  {
    id: number;
    name: string;
    loanAmount: number;
    loanAsOfDate: string;
    loanInterestRate: number | null;
    remaining: number;
  }[]
> {
  const categories = await getCategories(db);
  const results = [];
  for (const c of categories) {
    if (!c.loanAmount || !c.loanAsOfDate) continue;
    const status = await getLoanStatus(db, c.name, c.loanAmount, c.loanAsOfDate, c.loanInterestRate);
    results.push({
      id: c.id,
      name: c.name,
      loanAmount: c.loanAmount,
      loanAsOfDate: c.loanAsOfDate,
      loanInterestRate: c.loanInterestRate,
      remaining: status.remaining,
    });
  }
  return results;
}

// Remaining loan balance at the end of every month from loan_as_of_date to
// now -- lets the payoff be charted as a declining line rather than just a
// single current-balance snapshot.
export async function getLoanBalanceHistory(
  db: SQLiteDatabase,
  categoryName: string,
  loanAmount: number,
  loanAsOfDate: string,
  loanInterestRate: number | null = null
): Promise<{ month: string; remaining: number }[]> {
  return (await getLoanStatus(db, categoryName, loanAmount, loanAsOfDate, loanInterestRate)).history;
}

export async function deleteAssetBalance(db: SQLiteDatabase, id: number) {
  await db.runAsync("DELETE FROM asset_balances WHERE id = ?", id);
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

// For entries that don't come from a statement upload (a recurring car
// payment, cash spending, anything you just want to log yourself). Amount
// follows the same sign convention as extracted transactions: negative for
// an expense, positive for income/a credit.
export async function insertManualTransaction(
  db: SQLiteDatabase,
  transaction: { accountId: number; date: string; merchant: string; amount: number; categoryId: number }
) {
  await db.runAsync(
    "INSERT INTO transactions (account_id, date, merchant, amount, category_id, needs_review, ignored) VALUES (?, ?, ?, ?, ?, 0, 0)",
    transaction.accountId,
    transaction.date,
    transaction.merchant,
    transaction.amount,
    transaction.categoryId
  );
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
    transactions.ignored as ignored,
    transactions.linked_transaction_id as linkedTransactionId,
    linked_tx.merchant as linkedMerchant,
    linked_tx.amount as linkedAmount,
    linked_tx.date as linkedDate,
    linked_account.name as linkedAccountName
  FROM transactions
  JOIN accounts ON accounts.id = transactions.account_id
  JOIN categories ON categories.id = transactions.category_id
  LEFT JOIN transactions AS linked_tx ON linked_tx.id = transactions.linked_transaction_id
  LEFT JOIN accounts AS linked_account ON linked_account.id = linked_tx.account_id
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

// For the swipe-to-ignore action on the Review stack: marking something
// ignored there is the reviewer's actual decision about it (usually "this
// is a transfer, not spend"), so it should also resolve needs_review --
// otherwise it would keep reappearing in the stack every time, since
// setTransactionIgnored alone never touches that flag.
export async function ignoreAndResolveReview(db: SQLiteDatabase, id: number) {
  await db.runAsync("UPDATE transactions SET ignored = 1, needs_review = 0 WHERE id = ?", id);
}

// Likely transfer matches for a transaction -- the other side of the same
// real money movement, e.g. a checking withdrawal that pays off a credit
// card and that card's own "payment received" credit. A real match always
// has the opposite sign (money leaving one account, arriving in another)
// and the same magnitude; it's also always on a *different* account than
// the transaction itself, and, loosely, posted within about a week of it
// (statements don't always post both sides same-day). Already-linked
// transactions are excluded since they're already accounted for.
export async function getTransferCandidates(db: SQLiteDatabase, transaction: Transaction): Promise<Transaction[]> {
  const rows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT}
     WHERE transactions.id != ?
       AND transactions.account_id != ?
       AND transactions.linked_transaction_id IS NULL
       AND ABS(transactions.amount + ?) < 0.01
       AND ABS(JULIANDAY(transactions.date) - JULIANDAY(?)) <= 7
     ORDER BY ABS(JULIANDAY(transactions.date) - JULIANDAY(?)) ASC
     LIMIT 10`,
    transaction.id,
    transaction.accountId,
    transaction.amount,
    transaction.date,
    transaction.date
  );
  return rows.map(toTransaction);
}

export type TransferMatch = { a: Transaction; b: Transaction };

// Scans the whole dataset for likely transfer pairs at once, rather than
// requiring the user to open each transaction individually and search from
// there (see getTransferCandidates) -- meant for a dedicated review screen
// surfaced after an upload, or opened manually, so transfers can be found
// whenever both sides happen to exist, not only when uploaded together.
// Same matching rule as getTransferCandidates (opposite sign, same
// magnitude, different account, within a week), run as a self-join instead
// of per-transaction. One transaction can appear in more than one returned
// pair if several candidates are ambiguous (e.g. two similar-amount
// transactions near the same date) -- confirming one link removes both its
// transactions from future scans since they're no longer unlinked.
export async function findTransferMatches(db: SQLiteDatabase): Promise<TransferMatch[]> {
  const rows = await db.getAllAsync<{ aId: number; bId: number; dayGap: number }>(
    `SELECT a.id as aId, b.id as bId, ABS(JULIANDAY(a.date) - JULIANDAY(b.date)) as dayGap
     FROM transactions a
     JOIN transactions b ON b.id > a.id
     WHERE a.linked_transaction_id IS NULL
       AND b.linked_transaction_id IS NULL
       AND a.account_id != b.account_id
       AND ABS(a.amount + b.amount) < 0.01
       AND ABS(JULIANDAY(a.date) - JULIANDAY(b.date)) <= 7
       AND NOT EXISTS (
         SELECT 1 FROM dismissed_transfer_matches
         WHERE dismissed_transfer_matches.a_id = a.id AND dismissed_transfer_matches.b_id = b.id
       )
     ORDER BY dayGap ASC
     LIMIT 50`
  );
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.aId, r.bId]))];
  const placeholders = ids.map(() => "?").join(", ");
  const transactionRows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT} WHERE transactions.id IN (${placeholders})`,
    ...ids
  );
  const byId = new Map(transactionRows.map((row) => [row.id, toTransaction(row)]));
  return rows
    .map((r) => {
      const a = byId.get(r.aId);
      const b = byId.get(r.bId);
      return a && b ? { a, b } : null;
    })
    .filter((m): m is TransferMatch => m !== null);
}

// "Not a match" needs to stick, or the exact same coincidental pair (e.g. an
// unrelated cash deposit and card payment that happen to be the same
// amount) just comes back the next time the screen loads -- findTransferMatches
// excludes anything recorded here.
export async function dismissTransferMatch(db: SQLiteDatabase, aId: number, bId: number) {
  const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
  await db.runAsync(
    "INSERT OR IGNORE INTO dismissed_transfer_matches (a_id, b_id) VALUES (?, ?)",
    lo,
    hi
  );
}

// Links two transactions as the two sides of one real transfer. Rather than
// a separate "is this a transfer" flag, linking also decides which side
// counts toward spend totals: the incoming (positive-amount) side keeps
// its category and stays counted, while the outgoing (negative) side is
// marked ignored -- otherwise the same money would show up twice, once as
// an expense leaving one account and again as a payment on the other.
// Overwrites whatever `ignored` was previously set to on both sides.
export async function linkTransactions(db: SQLiteDatabase, idA: number, idB: number) {
  const rows = await db.getAllAsync<{ id: number; amount: number }>(
    "SELECT id, amount FROM transactions WHERE id IN (?, ?)",
    idA,
    idB
  );
  if (rows.length !== 2) return;
  const [a, b] = rows;
  await db.runAsync("UPDATE transactions SET linked_transaction_id = ?, ignored = ? WHERE id = ?", b.id, a.amount < 0 ? 1 : 0, a.id);
  await db.runAsync("UPDATE transactions SET linked_transaction_id = ?, ignored = ? WHERE id = ?", a.id, b.amount < 0 ? 1 : 0, b.id);
}

// Undoes a link. Leaves `ignored` as linking last set it on both sides --
// the user can toggle it back with setTransactionIgnored if that's not
// what they want once unlinked.
export async function unlinkTransaction(db: SQLiteDatabase, id: number) {
  const row = await db.getFirstAsync<{ linkedId: number | null }>(
    "SELECT linked_transaction_id as linkedId FROM transactions WHERE id = ?",
    id
  );
  await db.runAsync("UPDATE transactions SET linked_transaction_id = NULL WHERE id = ?", id);
  if (row?.linkedId) {
    await db.runAsync("UPDATE transactions SET linked_transaction_id = NULL WHERE id = ?", row.linkedId);
  }
}

export async function getTransactions(
  db: SQLiteDatabase,
  filters?: {
    accountId?: number;
    start?: string;
    end?: string;
    categoryName?: string;
    excludeCategoryNames?: string[];
    // The Payment category, plus any category with loan-payoff tracking
    // turned on (see setCategoryLoanAmount) -- paying down a tracked loan
    // is the same kind of debt transfer as a card Payment. Mirrors the
    // "payments" aggregation in getIncomeExpenseTotals/getPaymentTotal, so
    // the drill-down list matches what those totals actually added up.
    paymentCategoriesOnly?: boolean;
  }
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
  if (filters?.excludeCategoryNames?.length) {
    const placeholders = filters.excludeCategoryNames.map(() => "LOWER(?)").join(", ");
    clauses.push(`LOWER(categories.name) NOT IN (${placeholders}) AND categories.loan_amount IS NULL`);
    params.push(...filters.excludeCategoryNames);
  }
  if (filters?.paymentCategoriesOnly) {
    clauses.push("(LOWER(categories.name) = LOWER(?) OR categories.loan_amount IS NOT NULL)");
    params.push(PAYMENT_CATEGORY_NAME);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT} ${where} ORDER BY transactions.date DESC`,
    ...params
  );
  return rows.map(toTransaction);
}

// Used for duplicate detection -- a date+amount lookup of every transaction
// already on an account, so new statement rows / manual entries can be
// flagged before they're saved. Keeps the full transaction (not just a
// fingerprint) so the UI can show *which* existing transaction it matches,
// not just that a match exists.
export async function getDuplicateLookup(db: SQLiteDatabase, accountId: number): Promise<Map<string, Transaction>> {
  const rows = await getTransactions(db, { accountId });
  const map = new Map<string, Transaction>();
  for (const t of rows) {
    const key = `${t.date}|${t.amount.toFixed(2)}`;
    if (!map.has(key)) map.set(key, t);
  }
  return map;
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

// For fixing a bad upload (wrong dates from a parsing bug, duplicate
// import, etc.): delete every transaction on one account within a date
// range, so the statement can be re-uploaded cleanly afterward.
export async function deleteTransactions(
  db: SQLiteDatabase,
  params: { accountId: number; start: string; end: string }
): Promise<number> {
  const result = await db.runAsync(
    "DELETE FROM transactions WHERE account_id = ? AND date >= ? AND date <= ?",
    params.accountId,
    params.start,
    params.end
  );
  return result.changes;
}

// For fixing a single accidental entry (typo'd manual add, wrong upload
// row) without having to go through the bulk account/date-range tool.
export async function deleteTransaction(db: SQLiteDatabase, id: number) {
  await db.runAsync("DELETE FROM transactions WHERE id = ?", id);
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
export const INCOME_CATEGORY_NAME = "Income";
// Category name treated as a card/debt payment -- fully separate from both
// Income and Expenses (like a transfer, not spending or earning), with its
// own visible monthly total instead.
export const PAYMENT_CATEGORY_NAME = "Payment";

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
       SUM(CASE WHEN LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
           THEN -transactions.amount ELSE 0 END) as expenses,
       SUM(CASE WHEN LOWER(categories.name) = LOWER(?) OR categories.loan_amount IS NOT NULL
           THEN ABS(transactions.amount) ELSE 0 END) as payments
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
       SUM(CASE WHEN LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
           THEN -transactions.amount ELSE 0 END) as expenses
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

// Monthly spend for a single category, for the trend chart on the category
// detail page -- expressed as a positive amount (spend magnitude) per month.
export async function getCategoryMonthlyTotals(
  db: SQLiteDatabase,
  categoryName: string,
  months: number
): Promise<{ month: string; total: number }[]> {
  const rows = await db.getAllAsync<{ month: string; total: number }>(
    `SELECT
       substr(transactions.date, 1, 7) as month,
       SUM(-transactions.amount) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.ignored = 0 AND LOWER(categories.name) = LOWER(?)
     GROUP BY month
     ORDER BY month DESC
     LIMIT ?`,
    categoryName,
    months
  );
  return rows.reverse();
}

// Per-month "spent" (expenses, excluding Income/Payment categories) for one
// account -- powers the trend sparkline on the card detail page's hero.
export async function getAccountMonthlyTotals(
  db: SQLiteDatabase,
  accountId: number,
  months: number
): Promise<{ month: string; total: number }[]> {
  const rows = await db.getAllAsync<{ month: string; total: number }>(
    `SELECT
       substr(transactions.date, 1, 7) as month,
       SUM(CASE WHEN LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
           THEN -transactions.amount ELSE 0 END) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.account_id = ? AND transactions.ignored = 0
     GROUP BY month
     ORDER BY month DESC
     LIMIT ?`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    accountId,
    months
  );
  return rows.reverse();
}

// Per-day spend (expenses, excluding Income/Payment) for one account within
// a date range -- bucketed client-side into a rough weekly pace chart on the
// card detail page, not meant to be a precise day-by-day ledger.
export async function getAccountDailySpend(
  db: SQLiteDatabase,
  accountId: number,
  start: string,
  end: string
): Promise<{ date: string; total: number }[]> {
  return db.getAllAsync<{ date: string; total: number }>(
    `SELECT
       transactions.date as date,
       SUM(CASE WHEN LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
           THEN -transactions.amount ELSE 0 END) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.account_id = ? AND transactions.ignored = 0
       AND transactions.date >= ? AND transactions.date <= ?
     GROUP BY transactions.date
     ORDER BY transactions.date ASC`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    accountId,
    start,
    end
  );
}

// Total spent (expenses, excluding Payment) and received (Payment category)
// on one account within a date range -- powers the bottom summary bar on
// the card detail page.
export async function getAccountSpendSummary(
  db: SQLiteDatabase,
  accountId: number,
  start: string,
  end: string
): Promise<{ spent: number; received: number }> {
  const row = await db.getFirstAsync<{ spent: number | null; received: number | null }>(
    `SELECT
       SUM(CASE WHEN LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
           THEN -transactions.amount ELSE 0 END) as spent,
       SUM(CASE WHEN LOWER(categories.name) = LOWER(?) OR categories.loan_amount IS NOT NULL
           THEN ABS(transactions.amount) ELSE 0 END) as received
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.account_id = ? AND transactions.ignored = 0
       AND transactions.date >= ? AND transactions.date <= ?`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    accountId,
    start,
    end
  );
  return { spent: Math.max(row?.spent ?? 0, 0), received: row?.received ?? 0 };
}

// First and last "YYYY-MM" with any transaction, so month pickers can offer
// every month the data covers instead of a fixed recent window.
export async function getTransactionMonthBounds(
  db: SQLiteDatabase
): Promise<{ first: string; last: string } | null> {
  const row = await db.getFirstAsync<{ first: string | null; last: string | null }>(
    `SELECT substr(MIN(date), 1, 7) as first, substr(MAX(date), 1, 7) as last FROM transactions`
  );
  return row?.first && row.last ? { first: row.first, last: row.last } : null;
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
     WHERE transactions.date LIKE ? AND transactions.ignored = 0
       AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
       AND categories.loan_amount IS NULL
     GROUP BY categories.name
     ORDER BY total DESC`,
    `${month}%`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME
  );
}

// Total paid toward cards/debt for a given month -- the Payment category,
// plus any category with loan-payoff tracking turned on (a car loan, etc.
// -- see setCategoryLoanAmount), since paying down a tracked loan is the
// same kind of debt-service transfer as a card Payment, not real spending
// or income. Shown as its own figure since both are excluded from Income
// and Expenses (see getIncomeExpenseTotals).
export async function getPaymentTotal(db: SQLiteDatabase, month: string): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    // ABS() because a payment can be recorded as a positive credit (the
    // credit card side's own statement, e.g. "ONLINE PAYMENT THANK YOU") or
    // a negative debit (the paired withdrawal on the account it was paid
    // from) depending on which statement it was uploaded from -- this total
    // is meant to read as a magnitude ("$800 paid") either way, not flip
    // negative just because of which side happened to get tagged.
    `SELECT SUM(ABS(transactions.amount)) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.date LIKE ? AND transactions.ignored = 0
       AND (LOWER(categories.name) = LOWER(?) OR categories.loan_amount IS NOT NULL)`,
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
  // loanInterestRate is optional so backups from before it existed still restore.
  categories: { name: string; loanAmount: number | null; loanAsOfDate: string | null; loanInterestRate?: number | null }[];
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
  assets: { name: string; type: AssetType }[];
  assetBalances: { assetName: string; date: string; balance: number }[];
  // Optional so backups made before the name setting existed still restore.
  userName?: string | null;
};

export async function exportAllData(db: SQLiteDatabase): Promise<DataSnapshot> {
  const accounts = await db.getAllAsync<{ name: string; type: string }>(
    "SELECT name, type FROM accounts ORDER BY id"
  );
  const categories = await db.getAllAsync<{
    name: string;
    loanAmount: number | null;
    loanAsOfDate: string | null;
    loanInterestRate: number | null;
  }>(
    "SELECT name, loan_amount as loanAmount, loan_as_of_date as loanAsOfDate, loan_interest_rate as loanInterestRate FROM categories ORDER BY id"
  );
  const assets = await db.getAllAsync<{ name: string; type: AssetType }>(
    "SELECT name, type FROM assets ORDER BY id"
  );
  const assetBalances = await db.getAllAsync<{ assetName: string; date: string; balance: number }>(
    `SELECT assets.name as assetName, asset_balances.date as date, asset_balances.balance as balance
     FROM asset_balances
     JOIN assets ON assets.id = asset_balances.asset_id
     ORDER BY asset_balances.id`
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
    assets,
    assetBalances,
    userName: await getUserName(db),
  };
}

// Replaces all local data with the given snapshot -- used to restore from a
// Google Drive backup. Existing local data is discarded, so this is meant
// for restoring onto a fresh/empty database, not merging.
export async function replaceAllData(db: SQLiteDatabase, snapshot: DataSnapshot) {
  await db.execAsync(
    "DELETE FROM transactions; DELETE FROM merchant_category_map; DELETE FROM categories; DELETE FROM accounts; DELETE FROM asset_balances; DELETE FROM assets;"
  );

  const categoryIds = new Map<string, number>();
  for (const category of snapshot.categories) {
    const result = await db.runAsync(
      "INSERT INTO categories (name, loan_amount, loan_as_of_date, loan_interest_rate) VALUES (?, ?, ?, ?)",
      category.name,
      category.loanAmount ?? null,
      category.loanAsOfDate ?? null,
      category.loanInterestRate ?? null
    );
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

  const assetIds = new Map<string, number>();
  for (const asset of snapshot.assets ?? []) {
    const result = await db.runAsync("INSERT INTO assets (name, type) VALUES (?, ?)", asset.name, asset.type);
    assetIds.set(asset.name, result.lastInsertRowId);
  }

  for (const entry of snapshot.assetBalances ?? []) {
    const assetId = assetIds.get(entry.assetName);
    if (assetId === undefined) continue;
    await db.runAsync(
      "INSERT INTO asset_balances (asset_id, date, balance) VALUES (?, ?, ?)",
      assetId,
      entry.date,
      entry.balance
    );
  }

  if (typeof snapshot.userName === "string") {
    await setUserName(db, snapshot.userName);
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
     WHERE transactions.date LIKE ? AND transactions.ignored = 0
       AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
       AND categories.loan_amount IS NULL
     GROUP BY accounts.name
     ORDER BY total DESC`,
    `${month}%`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME
  );
}
