import type { SQLiteDatabase } from "expo-sqlite";
import {
  benefitStatus,
  findAnnualFeeCharge,
  findCard,
  usedLast12Months,
  type BenefitPeriod,
  type BenefitStatus,
  type CatalogBenefit,
  type CatalogCard,
} from "./cardBenefits";
import { simulateLoan, type LoanKind, type LoanStatus, type TrackedLoan } from "./loan";
import { closingOnOrAfter, misreadClosings, statementStatus, type StatementStatus } from "./statementReminders";
import { groupIncomeSources, looksLikePaycheck, type IncomeKind, type IncomeLabel, type IncomeSource } from "./incomeSources";
import { monthInsights, topMerchants, type Insight, type TopMerchant } from "./merchantInsights";
import { matchesWatch, noteWithWatch, type Watch, type WatchDirection } from "./watches";
import { buildCategoryDetails, comparisonPeriod, type CategoryDetails } from "./categoryDetails";
import { monthsBetween, periodRange, shiftMonth } from "./period";
import { forPerson, SHARED, settleUp, type Person, type PersonFilter, type SettleUp } from "./people";
import { detectRecurring, type Recurring, type RecurringOverride } from "./subscriptions";
import { DEFAULT_CATEGORIES } from "./categories";
import { isReadOnly, notifyBlockedWrite } from "./access";
import { formatMerchantName, merchantMatchText } from "./formatMerchant";
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
// Merchant memory's key: the cleaned name (store number, city, address,
// phone and card-processor prefix stripped -- see merchantMatchText), so
// one categorization covers every location of the same place, then the
// rules below on top.
export function normalizeMerchantKey(merchant: string): string {
  return legacyMerchantKey(merchantMatchText(merchant));
}

// One merchant as the user sees it: every description that shows the same
// name. Merchant pages, top merchants, insights and income sources group by
// this, so "STARBUCKS STORE 1234" and "SQ *STARBUCKS" are one Starbucks.
// Categories stay on normalizeMerchantKey, which is finer on purpose
// (Amazon Prime and Amazon orders can be categorized apart).
export function merchantGroupKey(merchant: string): string {
  return formatMerchantName(merchant).toLowerCase();
}

// The key as it was before the cleaned name went in front of it; kept for
// moving existing merchant memory over (see migrateMerchantKeys).
function legacyMerchantKey(merchant: string): string {
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
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS transaction_tags (
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      tag_id INTEGER NOT NULL REFERENCES tags(id),
      PRIMARY KEY (transaction_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS recurring_overrides (
      merchant_key TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS benefit_marks (
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      benefit_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      amount REAL NOT NULL,
      PRIMARY KEY (account_id, benefit_id, period_key)
    );
    CREATE TABLE IF NOT EXISTS custom_benefits (
      id INTEGER PRIMARY KEY NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      period TEXT NOT NULL,
      match_words TEXT,
      applied_as TEXT
    );
    -- Transfer matching looks up "the opposite of this amount" (see
    -- TRANSFER_PAIRS), which is a full scan of every pair without this.
    CREATE INDEX IF NOT EXISTS transactions_amount ON transactions(amount);
    -- The user's nickname and type for an income source (who paid it),
    -- as JSON {name, kind}, keyed like merchant memory.
    CREATE TABLE IF NOT EXISTS income_sources (
      merchant_key TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL
    );
    -- Closing dates of uploaded statements (read off the statement, or
    -- worked out from the account's statement day).
    CREATE TABLE IF NOT EXISTS statement_closings (
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      date TEXT NOT NULL,
      PRIMARY KEY (account_id, date)
    );
    -- "No statement this month" for an account (month = YYYY-MM).
    CREATE TABLE IF NOT EXISTS statement_skips (
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      month TEXT NOT NULL,
      PRIMARY KEY (account_id, month)
    );
    -- Who spent what (see lib/people.ts). person_id elsewhere is one of
    -- these, or -1 for Shared.
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      is_me INTEGER NOT NULL DEFAULT 0
    );
    -- What someone has settled up for a month (YYYY-MM).
    CREATE TABLE IF NOT EXISTS settle_ups (
      month TEXT NOT NULL,
      person_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      PRIMARY KEY (month, person_id)
    );
    -- The watch list (see lib/watches.ts). A watch only looks at
    -- transactions added after it (id above after_transaction_id).
    CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY NOT NULL,
      look_for TEXT NOT NULL,
      note TEXT NOT NULL,
      amount REAL,
      direction TEXT,
      keep_watching INTEGER NOT NULL DEFAULT 0,
      after_transaction_id INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
    -- A transaction a watch matched: "flagged" until the user says
    -- "confirmed" (that's it) or "dismissed" (not this one).
    CREATE TABLE IF NOT EXISTS watch_flags (
      watch_id INTEGER NOT NULL REFERENCES watches(id),
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      status TEXT NOT NULL,
      PRIMARY KEY (watch_id, transaction_id)
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
  if (!columns.some((c) => c.name === "reimbursed")) {
    await db.execAsync("ALTER TABLE transactions ADD COLUMN reimbursed REAL");
    await db.execAsync("ALTER TABLE transactions ADD COLUMN reimbursed_via TEXT");
  }
  if (!columns.some((c) => c.name === "note")) {
    await db.execAsync("ALTER TABLE transactions ADD COLUMN note TEXT");
  }
  if (!columns.some((c) => c.name === "linked_transaction_id")) {
    await db.execAsync(
      "ALTER TABLE transactions ADD COLUMN linked_transaction_id INTEGER REFERENCES transactions(id)"
    );
  }

  if (!columns.some((c) => c.name === "person_id")) {
    await db.execAsync("ALTER TABLE transactions ADD COLUMN person_id INTEGER");
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
  if (!categoryColumns.some((c) => c.name === "loan_kind")) {
    await db.execAsync("ALTER TABLE categories ADD COLUMN loan_kind TEXT");
  }
  if (!categoryColumns.some((c) => c.name === "loan_escrow")) {
    await db.execAsync("ALTER TABLE categories ADD COLUMN loan_escrow REAL");
  }
  if (!categoryColumns.some((c) => c.name === "emoji")) {
    await db.execAsync("ALTER TABLE categories ADD COLUMN emoji TEXT");
  }
  // Categories that count as income (Salary, Side gig, Rental...). "Income"
  // itself always does.
  if (!categoryColumns.some((c) => c.name === "is_income")) {
    await db.execAsync("ALTER TABLE categories ADD COLUMN is_income INTEGER NOT NULL DEFAULT 0");
  }

  // Migration for databases created before per-account balance tracking
  // existed.
  const accountColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(accounts)");
  const customBenefitColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(custom_benefits)");
  if (!customBenefitColumns.some((c) => c.name === "applied_as")) {
    await db.execAsync("ALTER TABLE custom_benefits ADD COLUMN applied_as TEXT");
  }
  if (!accountColumns.some((c) => c.name === "card_product")) {
    await db.execAsync("ALTER TABLE accounts ADD COLUMN card_product TEXT");
  }
  if (!accountColumns.some((c) => c.name === "annual_fee")) {
    await db.execAsync("ALTER TABLE accounts ADD COLUMN annual_fee REAL");
  }
  if (!accountColumns.some((c) => c.name === "include_in_savings")) {
    await db.execAsync("ALTER TABLE accounts ADD COLUMN include_in_savings INTEGER NOT NULL DEFAULT 1");
  }
  if (!accountColumns.some((c) => c.name === "default_person_id")) {
    await db.execAsync("ALTER TABLE accounts ADD COLUMN default_person_id INTEGER");
  }
  await seedMe(db);
  if (!accountColumns.some((c) => c.name === "statement_day")) {
    await db.execAsync("ALTER TABLE accounts ADD COLUMN statement_day INTEGER");
    await db.execAsync("ALTER TABLE accounts ADD COLUMN statement_day_set_by TEXT");
  }
  if (!accountColumns.some((c) => c.name === "statement_reminders")) {
    await db.execAsync("ALTER TABLE accounts ADD COLUMN statement_reminders INTEGER NOT NULL DEFAULT 1");
  }
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
  // After the seed above, so a brand-new database's Income counts too.
  await db.runAsync("UPDATE categories SET is_income = 1 WHERE LOWER(name) = LOWER(?) AND is_income = 0", INCOME_CATEGORY_NAME);

  const emojiOverrides = await db.getAllAsync<{ name: string; emoji: string }>(
    "SELECT name, emoji FROM categories WHERE emoji IS NOT NULL"
  );
  loadCategoryEmojiOverrides(emojiOverrides);
  await migrateMerchantKeys(db);
  if ((await getSetting(db, LINKED_BOTH_IGNORED_KEY)) === null) {
    await db.runAsync("UPDATE transactions SET ignored = 1 WHERE linked_transaction_id IS NOT NULL");
    await setSetting(db, LINKED_BOTH_IGNORED_KEY, "1");
  }
  // Catches transfers in data saved before auto-linking existed, and any
  // a manual add or restore made linkable since.
  await autoLinkTransfers(db);
  await repairMisreadClosings(db);
  // No accounts are seeded -- a new user starts empty and adds their own
  // cards, rather than inheriting a hard-coded list.
  guardWrites(db);
}

export class ReadOnlyError extends Error {
  constructor() {
    super("Fia is read-only: your access has ended.");
  }
}

// While access is read-only (see lib/access.ts), every write is refused at
// this one point instead of in each screen -- except the settings table,
// which holds the access check itself and per-device conveniences.
function guardWrites(db: SQLiteDatabase) {
  const blocked = (sql: string) => isReadOnly() && !/^\s*(insert or replace into|update|delete from)\s+settings\b/i.test(sql);
  const refuse = () => {
    notifyBlockedWrite();
    return Promise.reject(new ReadOnlyError());
  };
  const run = db.runAsync.bind(db) as (sql: string, ...params: unknown[]) => Promise<unknown>;
  const exec = db.execAsync.bind(db);
  // Typed loosely on purpose: runAsync has several overloads.
  (db as unknown as { runAsync: unknown }).runAsync = (sql: string, ...params: unknown[]) =>
    blocked(sql) ? refuse() : run(sql, ...params);
  (db as unknown as { execAsync: unknown }).execAsync = (sql: string) => (blocked(sql) ? refuse() : exec(sql));
}

// The user's own calls on subscription detection, per merchant (same key
// as merchant memory): "subscription" counts it even after one charge,
// "not" hides it for good. null clears the choice.
// The merchant-memory keys of every description that shows the same name as
// `merchant` ("SPOTIFY USA", "Spotify P1A2B3"...), including its own.
async function keysForMerchantGroup(db: SQLiteDatabase, merchant: string): Promise<string[]> {
  const group = merchantGroupKey(merchant);
  const rows = await db.getAllAsync<{ merchant: string }>("SELECT DISTINCT merchant FROM transactions");
  const keys = new Set([normalizeMerchantKey(merchant)]);
  for (const r of rows) if (merchantGroupKey(r.merchant) === group) keys.add(normalizeMerchantKey(r.merchant));
  return [...keys];
}

// "Subscription" / "not one" applies to the merchant as shown, so it's
// saved for each of its descriptions.
export async function setRecurringOverride(db: SQLiteDatabase, merchant: string, status: RecurringOverride | null) {
  for (const key of await keysForMerchantGroup(db, merchant)) {
    if (status === null) {
      await db.runAsync("DELETE FROM recurring_overrides WHERE merchant_key = ?", key);
    } else {
      await db.runAsync("INSERT OR REPLACE INTO recurring_overrides (merchant_key, status) VALUES (?, ?)", key, status);
    }
  }
}

export async function getRecurringOverride(db: SQLiteDatabase, merchant: string): Promise<RecurringOverride | null> {
  const keys = await keysForMerchantGroup(db, merchant);
  const rows = await db.getAllAsync<{ status: RecurringOverride }>(
    `SELECT status FROM recurring_overrides WHERE merchant_key IN (${keys.map(() => "?").join(", ")})`,
    ...keys
  );
  return combineOverrides(rows.map((r) => r.status));
}

// When a merchant's descriptions disagree, "not a subscription" wins, so
// something the user hid doesn't come back under a new wording.
function combineOverrides(statuses: RecurringOverride[]): RecurringOverride | null {
  if (statuses.includes("not")) return "not";
  return statuses.includes("subscription") ? "subscription" : null;
}

// Subscriptions and recurring bills found in spending -- leaving out
// income, card payments, tracked loans (a car payment isn't a
// subscription), linked transfers and ignored transactions.
export async function getRecurring(db: SQLiteDatabase): Promise<Recurring[]> {
  const [transactions, categories, overrideRows] = await Promise.all([
    getTransactions(db),
    getCategories(db),
    db.getAllAsync<{ merchant_key: string; status: RecurringOverride }>("SELECT merchant_key, status FROM recurring_overrides"),
  ]);
  const excluded = new Set(
    categories
      .filter((c) => c.loanAmount !== null || c.isIncome || c.name === PAYMENT_CATEGORY_NAME)
      .map((c) => c.name.toLowerCase())
  );
  const spending = transactions.filter(
    (t) => !t.ignored && t.linkedTransactionId === null && !excluded.has(t.categoryName.toLowerCase())
  );
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Grouped by the name shown, so a subscription billed under a few
  // wordings is one subscription; saved choices follow each description to
  // its group.
  const groupOfKey = new Map(transactions.map((t) => [normalizeMerchantKey(t.merchant), merchantGroupKey(t.merchant)]));
  const byGroup = new Map<string, RecurringOverride[]>();
  for (const r of overrideRows) {
    const group = groupOfKey.get(r.merchant_key);
    if (group) byGroup.set(group, [...(byGroup.get(group) ?? []), r.status]);
  }
  const overrides = new Map<string, RecurringOverride>();
  for (const [group, statuses] of byGroup) {
    const status = combineOverrides(statuses);
    if (status) overrides.set(group, status);
  }
  return detectRecurring(spending, merchantGroupKey, overrides, today);
}

// Small key/value store for per-device preferences. null = never set.
export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>("SELECT value FROM settings WHERE key = ?", key);
  return row ? (row.value ?? "") : null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value);
}

// Statement reminders (see lib/statementReminders.ts), for every account
// with anything uploaded. Saved statement balances' dates stand in for
// closing dates.
export async function getStatementStatuses(db: SQLiteDatabase, today: string): Promise<StatementStatus[]> {
  const accounts = await db.getAllAsync<{ id: number; name: string; remindersOn: number; statementDay: number | null }>(
    "SELECT id, name, statement_reminders as remindersOn, statement_day as statementDay FROM accounts ORDER BY name"
  );
  const txDates = await db.getAllAsync<{ accountId: number; date: string }>(
    "SELECT DISTINCT account_id as accountId, date FROM transactions ORDER BY date"
  );
  const closings = await db.getAllAsync<{ accountId: number; date: string }>(
    `SELECT account_id as accountId, date FROM balance_checkpoints
     UNION SELECT account_id as accountId, date FROM statement_closings
     ORDER BY date`
  );
  const uploaded = await db.getAllAsync<{ accountId: number; date: string }>(
    "SELECT account_id as accountId, date FROM statement_closings"
  );
  const skips = await db.getAllAsync<{ accountId: number; month: string }>(
    "SELECT account_id as accountId, month FROM statement_skips"
  );
  const byAccount = <T extends { accountId: number }>(rows: T[], id: number) => rows.filter((r) => r.accountId === id);
  return accounts.map((a) =>
    statementStatus(
      {
        accountId: a.id,
        accountName: a.name,
        transactionDates: byAccount(txDates, a.id).map((r) => r.date),
        statementDates: byAccount(closings, a.id).map((r) => r.date),
        uploadedClosings: byAccount(uploaded, a.id).map((r) => r.date),
        skippedMonths: byAccount(skips, a.id).map((r) => r.month),
        remindersOn: a.remindersOn === 1,
        statementDay: a.statementDay,
      },
      today
    )
  );
}

// See misreadClosings. Safe to run every time: it only finds anything to
// fix once. A day the user typed in themselves is left alone.
async function repairMisreadClosings(db: SQLiteDatabase) {
  const accounts = await db.getAllAsync<{ id: number; setBy: string | null }>(
    "SELECT id, statement_day_set_by as setBy FROM accounts WHERE type IN ('Checking', 'Savings')"
  );
  for (const account of accounts) {
    const closings = await db.getAllAsync<{ date: string }>("SELECT date FROM statement_closings WHERE account_id = ?", account.id);
    const balances = await db.getAllAsync<{ date: string }>("SELECT date FROM balance_checkpoints WHERE account_id = ? ORDER BY date", account.id);
    const { remove, add } = misreadClosings(closings.map((c) => c.date), balances.map((b) => b.date));
    if (remove.length === 0) continue;
    for (const date of remove) await db.runAsync("DELETE FROM statement_closings WHERE account_id = ? AND date = ?", account.id, date);
    for (const date of add) await recordStatementClosing(db, account.id, date);
    if (account.setBy !== "user") {
      const latest = balances[balances.length - 1].date;
      await db.runAsync("UPDATE accounts SET statement_day = ?, statement_day_set_by = 'statement' WHERE id = ?", Number(latest.slice(8, 10)), account.id);
    }
  }
}

export async function setStatementDay(
  db: SQLiteDatabase,
  accountId: number,
  day: number | null,
  setBy: "statement" | "user"
) {
  await db.runAsync(
    "UPDATE accounts SET statement_day = ?, statement_day_set_by = ? WHERE id = ?",
    day,
    day === null ? null : setBy,
    accountId
  );
}

// "It's in": the user knows better than Fia. A month with a gap is marked
// as having no statement; otherwise the one Fia is asking for counts as in.
export async function markStatementIn(db: SQLiteDatabase, status: StatementStatus, month: string) {
  if (status.missingMonths.includes(month)) {
    await skipStatementMonth(db, status.accountId, month);
    return;
  }
  if (!status.nextExpected) return;
  await recordStatementClosing(db, status.accountId, status.nextExpected);
  // Months up to that statement with nothing in them aren't gaps either, or
  // settling this one would only move the complaint to the month before.
  if (!status.coveredThrough) return;
  const lastBefore = shiftMonth(status.nextExpected.slice(0, 7), -1);
  for (const m of monthsBetween(lastBefore, status.coveredThrough.slice(0, 7))) await skipStatementMonth(db, status.accountId, m);
}

export async function recordStatementClosing(db: SQLiteDatabase, accountId: number, date: string) {
  await db.runAsync("INSERT OR IGNORE INTO statement_closings (account_id, date) VALUES (?, ?)", accountId, date);
}

export async function getIncomeLabels(db: SQLiteDatabase): Promise<Map<string, IncomeLabel>> {
  const rows = await db.getAllAsync<{ merchant_key: string; label: string }>("SELECT merchant_key, label FROM income_sources");
  const labels = new Map<string, IncomeLabel>();
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.label);
      labels.set(r.merchant_key, { name: parsed.name || null, kind: parsed.kind || null });
    } catch {
      // A broken label is just dropped.
    }
  }
  return labels;
}

// Nickname and type for an income source (its key from getIncomeSources);
// both empty forgets it.
export async function setIncomeLabel(db: SQLiteDatabase, key: string, name: string | null, kind: IncomeKind | null) {
  const trimmed = name?.trim() || null;
  if (!trimmed && !kind) {
    await db.runAsync("DELETE FROM income_sources WHERE merchant_key = ?", key);
    return;
  }
  await db.runAsync(
    "INSERT OR REPLACE INTO income_sources (merchant_key, label) VALUES (?, ?)",
    key,
    JSON.stringify({ name: trimmed, kind })
  );
}

// Income for start..end broken down by source, with paycheck schedules. A
// paycheck only counts as late once statements past its date are in, so
// each account's latest uploaded date goes along.
export async function getIncomeSources(db: SQLiteDatabase, start: string, end: string, today: string): Promise<IncomeSource[]> {
  const [income, labels, covered] = await Promise.all([
    getTransactions(db, { incomeOnly: true }),
    getIncomeLabels(db),
    db.getAllAsync<{ accountId: number; last: string }>(
      `SELECT account_id as accountId, MAX(date) as last FROM (
         SELECT account_id, date FROM transactions
         UNION ALL SELECT account_id, date FROM balance_checkpoints
         UNION ALL SELECT account_id, date FROM statement_closings
       ) GROUP BY account_id`
    ),
  ]);
  return groupIncomeSources(
    income.filter((t) => t.linkedTransactionId === null),
    { start, end },
    merchantGroupKey,
    normalizeMerchantKey,
    formatMerchantName,
    labels,
    new Map(covered.map((c) => [c.accountId, c.last])),
    today
  );
}

// Charges for start..end that count as spending: no income, card payments,
// linked transfers or ignored ones.
async function getSpending(db: SQLiteDatabase, start: string, end: string, person?: PersonFilter): Promise<Transaction[]> {
  const list = await getTransactions(db, { start, end, excludeIncome: true, excludeCategoryNames: [PAYMENT_CATEGORY_NAME] });
  const spending = list.filter((t) => t.amount < 0 && !t.ignored && t.linkedTransactionId === null);
  return person ? forPerson(spending, person) : spending;
}

// Every transaction from the same merchant as `merchant` (by the name shown),
// newest first.
export async function getMerchantTransactions(db: SQLiteDatabase, merchant: string): Promise<Transaction[]> {
  const group = merchantGroupKey(merchant);
  return (await getTransactions(db)).filter((t) => merchantGroupKey(t.merchant) === group);
}

export async function getTopMerchants(
  db: SQLiteDatabase,
  start: string,
  end: string,
  limit = 5,
  person?: PersonFilter
): Promise<TopMerchant[]> {
  return topMerchants(await getSpending(db, start, end, person), merchantGroupKey, formatMerchantName, limit);
}

// Plain-language notes on a month ("YYYY-MM") against the user's usual.
export async function getMonthInsights(db: SQLiteDatabase, month: string, person?: PersonFilter): Promise<Insight[]> {
  const [y, m] = month.split("-").map(Number);
  const before = [1, 2, 3].map((i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const [categories, earlier, spending, seenRows] = await Promise.all([
    getCategorySummary(db, month, undefined, person),
    Promise.all(before.map((b) => getCategorySummary(db, b, undefined, person))),
    getSpending(db, start, end, person),
    db.getAllAsync<{ merchant: string }>("SELECT DISTINCT merchant FROM transactions WHERE date < ?", start),
  ]);
  return monthInsights({
    categories,
    earlier,
    spending,
    seenBefore: new Set(seenRows.map((r) => merchantGroupKey(r.merchant))),
    keyFor: merchantGroupKey,
    displayName: formatMerchantName,
    inProgress: end >= todayISO(),
  });
}

// A closing date on the 28th-31st counts as the same day as a later
// statement day: a "31st" statement closes Feb 28.
function sameStatementDay(closing: string, day: number): boolean {
  const closingDay = Number(closing.slice(8, 10));
  if (closingDay === day) return true;
  const monthEnd = new Date(Date.UTC(Number(closing.slice(0, 4)), Number(closing.slice(5, 7)), 0)).getUTCDate();
  return closingDay === monthEnd && day > closingDay;
}

// After an upload: learns when this account's statements close. A printed
// closing date is recorded and sets the day, unless the user typed a
// different one -- then `differentDay` comes back for the upload screen to
// offer. With no date printed, a known day works out this statement's
// closing; with neither, `ask` says to ask the user. A CSV is any span of
// transactions, not one statement, so no closing is worked out from it.
export async function learnStatementClosing(
  db: SQLiteDatabase,
  account: Account,
  closing: string | null,
  lastTransactionDate: string | null,
  isCsv: boolean
): Promise<{ ask: boolean; differentDay: number | null }> {
  if (closing) {
    await recordStatementClosing(db, account.id, closing);
    const day = Number(closing.slice(8, 10));
    if (account.statementDay !== null && sameStatementDay(closing, account.statementDay)) {
      return { ask: false, differentDay: null };
    }
    if (account.statementDaySetBy === "user") return { ask: false, differentDay: day };
    await setStatementDay(db, account.id, day, "statement");
    return { ask: false, differentDay: null };
  }
  if (account.statementDay === null) return { ask: true, differentDay: null };
  if (!isCsv && lastTransactionDate) {
    const derived = closingOnOrAfter(lastTransactionDate, account.statementDay);
    if (derived <= todayISO()) await recordStatementClosing(db, account.id, derived);
  }
  return { ask: false, differentDay: null };
}

// The user says which day statements close. With `countLatest`, their most
// recent transactions are taken to be from a statement already uploaded, so
// the reminder starts from the next one rather than asking for that again.
export async function setStatementDayByUser(db: SQLiteDatabase, accountId: number, day: number | null, countLatest: boolean) {
  await setStatementDay(db, accountId, day, "user");
  if (day === null || !countLatest) return;
  const row = await db.getFirstAsync<{ last: string | null }>(
    "SELECT MAX(date) as last FROM transactions WHERE account_id = ?",
    accountId
  );
  if (!row?.last) return;
  const derived = closingOnOrAfter(row.last, day);
  if (derived <= todayISO()) await recordStatementClosing(db, accountId, derived);
}

export async function setStatementReminders(db: SQLiteDatabase, accountId: number, on: boolean) {
  await db.runAsync("UPDATE accounts SET statement_reminders = ? WHERE id = ?", on ? 1 : 0, accountId);
}

export async function skipStatementMonth(db: SQLiteDatabase, accountId: number, month: string) {
  await db.runAsync("INSERT OR IGNORE INTO statement_skips (account_id, month) VALUES (?, ?)", accountId, month);
}

// "Remind me later" -- per account, until a date. Device-only, like a
// dismissed banner, so it isn't in backups.
const STATEMENT_SNOOZE_KEY = "statement_snooze";

export async function getStatementSnoozes(db: SQLiteDatabase): Promise<Record<string, string>> {
  try {
    return JSON.parse((await getSetting(db, STATEMENT_SNOOZE_KEY)) || "{}");
  } catch {
    return {};
  }
}

export async function snoozeStatementReminder(db: SQLiteDatabase, accountId: number, until: string) {
  const snoozes = await getStatementSnoozes(db);
  await setSetting(db, STATEMENT_SNOOZE_KEY, JSON.stringify({ ...snoozes, [accountId]: until }));
}

// Months whose monthly check-in was finished (YYYY-MM), for the streak.
const CHECK_INS_DONE_KEY = "check_ins_done";

export async function getCheckInsDone(db: SQLiteDatabase): Promise<string[]> {
  try {
    return JSON.parse((await getSetting(db, CHECK_INS_DONE_KEY)) || "[]");
  } catch {
    return [];
  }
}

export async function markCheckInDone(db: SQLiteDatabase, month: string) {
  const done = new Set(await getCheckInsDone(db));
  done.add(month);
  await setSetting(db, CHECK_INS_DONE_KEY, JSON.stringify([...done].sort()));
}

const MERCHANT_KEYS_VERSION_KEY = "merchant_keys_version";
const LINKED_BOTH_IGNORED_KEY = "linked_both_ignored";

// Money coming into a checking or savings account -- a paycheck, a
// transfer -- is never spending, even before it's categorized as Income,
// so spending totals leave it out. Money back on a card (a refund) still
// counts against spending.
// A transaction's amount for spending: a charge less what someone paid back.
const SPEND_AMOUNT = "(transactions.amount + COALESCE(transactions.reimbursed, 0))";

const NOT_BANK_INFLOW = `NOT (transactions.amount > 0 AND transactions.account_id IN
  (SELECT id FROM accounts WHERE type IN ('Checking', 'Savings')))`;

// Bump when normalizeMerchantKey's output changes, so stored keys follow.
const MERCHANT_KEYS_VERSION = "3";

// Re-keys merchant memory and subscription choices whenever the key rules
// change, so nothing the user already taught the app is lost. Keys from
// the original raw-text rules are mapped through the transactions that
// produced them; any other key is re-keyed from its own text. When several
// old keys merge into one (two locations of the same place), the one
// covering the most transactions wins. Then memory is backfilled from the
// transactions themselves -- every reviewed transaction already carries the
// category the user chose -- which recovers any merchant whose old key
// can't be mapped forward.
async function migrateMerchantKeys(db: SQLiteDatabase) {
  if ((await getSetting(db, MERCHANT_KEYS_VERSION_KEY)) === MERCHANT_KEYS_VERSION) return;
  const merchants = await db.getAllAsync<{ merchant: string; count: number }>(
    "SELECT merchant, COUNT(*) as count FROM transactions GROUP BY merchant"
  );
  const newKeyFor = new Map<string, string>();
  const usage = new Map<string, number>();
  for (const { merchant, count } of merchants) {
    const oldKey = legacyMerchantKey(merchant);
    if (!newKeyFor.has(oldKey)) newKeyFor.set(oldKey, normalizeMerchantKey(merchant));
    usage.set(oldKey, (usage.get(oldKey) ?? 0) + count);
  }
  const remap = async (table: string, valueColumn: string) => {
    const rows = await db.getAllAsync<{ merchant_key: string; value: string | number }>(
      `SELECT merchant_key, ${valueColumn} as value FROM ${table}`
    );
    rows.sort((a, b) => (usage.get(b.merchant_key) ?? 0) - (usage.get(a.merchant_key) ?? 0));
    await db.runAsync(`DELETE FROM ${table}`);
    for (const row of rows) {
      const key = newKeyFor.get(row.merchant_key) ?? normalizeMerchantKey(row.merchant_key);
      await db.runAsync(`INSERT OR IGNORE INTO ${table} (merchant_key, ${valueColumn}) VALUES (?, ?)`, key, row.value);
    }
  };
  await remap("merchant_category_map", "category_id");
  await remap("recurring_overrides", "status");
  await remap("income_sources", "label");

  const reviewed = await db.getAllAsync<{ merchant: string; categoryId: number }>(
    `SELECT merchant, category_id as categoryId FROM transactions
     WHERE needs_review = 0 ORDER BY date DESC, id DESC`
  );
  for (const { merchant, categoryId } of reviewed) {
    await db.runAsync(
      "INSERT OR IGNORE INTO merchant_category_map (merchant_key, category_id) VALUES (?, ?)",
      normalizeMerchantKey(merchant),
      categoryId
    );
  }
  await setSetting(db, MERCHANT_KEYS_VERSION_KEY, MERCHANT_KEYS_VERSION);
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
    loan_kind: LoanKind | null;
    loan_escrow: number | null;
    emoji: string | null;
    is_income: number;
  }>(
    "SELECT id, name, loan_amount, loan_as_of_date, loan_interest_rate, loan_kind, loan_escrow, emoji, is_income FROM categories ORDER BY name"
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    loanAmount: r.loan_amount,
    loanAsOfDate: r.loan_as_of_date,
    loanInterestRate: r.loan_interest_rate,
    loanKind: r.loan_kind,
    loanEscrow: r.loan_escrow,
    emoji: r.emoji,
    isIncome: r.is_income === 1,
  }));
}

// Whether a category counts as income. "Income" itself always does.
export async function setCategoryIncome(db: SQLiteDatabase, id: number, isIncome: boolean) {
  await db.runAsync(
    "UPDATE categories SET is_income = ? WHERE id = ? AND LOWER(name) != LOWER(?)",
    isIncome ? 1 : 0,
    id,
    INCOME_CATEGORY_NAME
  );
}

// Pass null to stop tracking the category as a loan.
export async function setCategoryLoan(
  db: SQLiteDatabase,
  id: number,
  loan: {
    amount: number;
    asOfDate: string;
    interestRate: number | null;
    kind: LoanKind;
    escrow: number | null;
  } | null
) {
  await db.runAsync(
    "UPDATE categories SET loan_amount = ?, loan_as_of_date = ?, loan_interest_rate = ?, loan_kind = ?, loan_escrow = ? WHERE id = ?",
    loan?.amount ?? null,
    loan?.asOfDate ?? null,
    loan?.interestRate ?? null,
    loan?.kind ?? null,
    loan?.escrow ?? null,
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
  type: string,
  cardProduct: string | null = null
): Promise<number> {
  const result = await db.runAsync(
    "INSERT INTO accounts (name, type, card_product) VALUES (?, ?, ?)",
    name,
    type,
    cardProduct
  );
  return result.lastInsertRowId;
}

// startingBalance/startingBalanceDate reflect the single most recent
// checkpoint (see balance_checkpoints / getAccountBalanceAsOf below) --
// enough for the Accounts screen's edit panel to show/prefill "the"
// balance, even though the real calculation can draw on any checkpoint,
// not just this latest one.
export async function getAccounts(db: SQLiteDatabase): Promise<Account[]> {
  const rows = await db.getAllAsync<Omit<Account, "includeInSavings"> & { includeInSavings: number }>(
    `SELECT accounts.id, accounts.name, accounts.type,
       latest.balance as startingBalance,
       latest.date as startingBalanceDate,
       accounts.include_in_savings as includeInSavings,
       accounts.card_product as cardProduct,
       accounts.annual_fee as annualFee,
       accounts.statement_day as statementDay,
       accounts.statement_day_set_by as statementDaySetBy
     FROM accounts
     LEFT JOIN balance_checkpoints latest ON latest.account_id = accounts.id
       AND latest.date = (
         SELECT MAX(date) FROM balance_checkpoints WHERE account_id = accounts.id
       )
     ORDER BY accounts.name`
  );
  return rows.map((r) => ({ ...r, includeInSavings: r.includeInSavings === 1 }));
}

export async function setAccountIncludeInSavings(db: SQLiteDatabase, id: number, include: boolean) {
  await db.runAsync("UPDATE accounts SET include_in_savings = ? WHERE id = ?", include ? 1 : 0, id);
}

// Which real card an account is (a cardCatalog.json id), or null.
export async function setAccountCardProduct(db: SQLiteDatabase, id: number, productId: string | null) {
  await db.runAsync("UPDATE accounts SET card_product = ? WHERE id = ?", productId, id);
}

// The user's own annual fee for this card; null goes back to the catalog's.
export async function setAccountAnnualFee(db: SQLiteDatabase, id: number, fee: number | null) {
  await db.runAsync("UPDATE accounts SET annual_fee = ? WHERE id = ?", fee, id);
}

// "I used it" / "I used part of it" for one benefit window; null undoes it.
export async function setBenefitMark(
  db: SQLiteDatabase,
  accountId: number,
  benefitId: string,
  periodKey: string,
  amount: number | null
) {
  if (amount === null) {
    await db.runAsync(
      "DELETE FROM benefit_marks WHERE account_id = ? AND benefit_id = ? AND period_key = ?",
      accountId,
      benefitId,
      periodKey
    );
  } else {
    await db.runAsync(
      "INSERT OR REPLACE INTO benefit_marks (account_id, benefit_id, period_key, amount) VALUES (?, ?, ?, ?)",
      accountId,
      benefitId,
      periodKey,
      amount
    );
  }
}

// A benefit the user adds to a card -- for a card not in the catalog, or one
// the catalog doesn't list. `matchWords` is what it shows as on a statement.
export async function addCustomBenefit(
  db: SQLiteDatabase,
  accountId: number,
  benefit: { name: string; amount: number; period: BenefitPeriod; matchWords: string[]; appliedAs: "statementCredit" | "inApp" }
) {
  await db.runAsync(
    "INSERT INTO custom_benefits (account_id, name, amount, period, match_words, applied_as) VALUES (?, ?, ?, ?, ?, ?)",
    accountId,
    benefit.name.trim(),
    benefit.amount,
    benefit.period,
    benefit.matchWords.map((w) => w.trim()).filter(Boolean).join(",") || null,
    benefit.appliedAs
  );
}

export async function deleteCustomBenefit(db: SQLiteDatabase, id: number) {
  const row = await db.getFirstAsync<{ account_id: number }>("SELECT account_id FROM custom_benefits WHERE id = ?", id);
  await db.runAsync("DELETE FROM custom_benefits WHERE id = ?", id);
  if (row) {
    await db.runAsync("DELETE FROM benefit_marks WHERE account_id = ? AND benefit_id = ?", row.account_id, `custom-${id}`);
  }
}

async function getCustomBenefits(db: SQLiteDatabase, accountId: number): Promise<CatalogBenefit[]> {
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    amount: number;
    period: BenefitPeriod;
    match_words: string | null;
    applied_as: "statementCredit" | "inApp" | null;
  }>(
    "SELECT id, name, amount, period, match_words, applied_as FROM custom_benefits WHERE account_id = ? ORDER BY id",
    accountId
  );
  return rows.map((r) => ({
    id: `custom-${r.id}`,
    name: r.name,
    detail: "Added by you.",
    amount: r.amount,
    period: r.period,
    matchAny: r.match_words ? r.match_words.split(",") : [],
    appliedAs: r.applied_as ?? "statementCredit",
    customId: r.id,
  }));
}

export type CardOverview = {
  account: Account;
  // Null for a credit card not in the catalog (it can still have the user's own benefits).
  card: CatalogCard | null;
  annualFee: number;
  feeLastCharged: string | null;
  feeNextDue: string | null; // a year after the last fee found on a statement
  benefits: BenefitStatus[];
  creditsUsedLast12Months: number;
};

// Every credit card (and any account set to a real card), with its annual
// fee and where each benefit -- the catalog's plus the user's own -- stands
// this period.
export async function getCardOverviews(db: SQLiteDatabase): Promise<CardOverview[]> {
  const accounts = (await getAccounts(db)).filter((a) => a.cardProduct || a.type === "Credit Card");
  const today = todayISO();
  const results: CardOverview[] = [];
  for (const account of accounts) {
    const card = findCard(account.cardProduct);
    const benefits = [...(card?.benefits ?? []), ...(await getCustomBenefits(db, account.id))];
    const transactions = await getTransactions(db, { accountId: account.id });
    const markRows = await db.getAllAsync<{ benefit_id: string; period_key: string; amount: number }>(
      "SELECT benefit_id, period_key, amount FROM benefit_marks WHERE account_id = ?",
      account.id
    );
    const marks = new Map(markRows.map((r) => [`${r.benefit_id}|${r.period_key}`, r.amount]));
    const fee = findAnnualFeeCharge(transactions);
    const anniversaryMonth = fee ? Number(fee.date.slice(5, 7)) : null;
    results.push({
      account,
      card,
      annualFee: account.annualFee ?? card?.annualFee ?? 0,
      feeLastCharged: fee?.date ?? null,
      feeNextDue: fee ? `${Number(fee.date.slice(0, 4)) + 1}${fee.date.slice(4)}` : null,
      benefits: benefits.map((b) => benefitStatus(b, transactions, marks, today, anniversaryMonth)),
      creditsUsedLast12Months: benefits.reduce(
        (sum, b) => sum + usedLast12Months(b, transactions, marks, today, anniversaryMonth),
        0
      ),
    });
  }
  return results;
}

export type BankAsset = {
  accountId: number;
  name: string;
  type: "Checking" | "Savings";
  included: boolean;
  // Null until a balance is known -- from a statement's ending balance or
  // one the user set; after that it's kept current from transactions.
  balance: number | null;
  asOf: string | null; // date of the most recent known balance
  // Balance at each month's end (and today), for growth charts.
  history: { date: string; balance: number }[];
};

function monthEndsBetween(first: string, last: string): string[] {
  const ends: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    ends.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return ends;
}

// Checking and Savings accounts as Savings & Investments entries, their
// balances kept from statements (see getAccountBalanceAsOf) rather than
// typed in. Credit cards are debts, so they're never included.
export async function getBankAssets(db: SQLiteDatabase): Promise<BankAsset[]> {
  const accounts = (await getAccounts(db)).filter((a) => a.type === "Checking" || a.type === "Savings");
  const today = todayISO();
  const results: BankAsset[] = [];
  for (const a of accounts) {
    const balance = await getAccountBalanceAsOf(db, a.id, today);
    const history: BankAsset["history"] = [];
    if (balance !== null) {
      const first = await db.getFirstAsync<{ date: string | null }>(
        `SELECT MIN(date) as date FROM (
           SELECT date FROM transactions WHERE account_id = ?
           UNION SELECT date FROM balance_checkpoints WHERE account_id = ?
         )`,
        a.id,
        a.id
      );
      for (const end of monthEndsBetween(first?.date ?? today, today)) {
        const date = end < today ? end : today;
        const value = await getAccountBalanceAsOf(db, a.id, date);
        if (value !== null) history.push({ date, balance: value });
      }
    }
    results.push({
      accountId: a.id,
      name: a.name,
      type: a.type as BankAsset["type"],
      included: a.includeInSavings,
      balance,
      asOf: a.startingBalanceDate,
      history,
    });
  }
  return results;
}

// Sums several balance series that each change at their own dates: at every
// date any of them changes, the total of each one's latest value so far.
function sumSeries(series: { date: string; balance: number }[][]): { date: string; total: number }[] {
  const points = series.flatMap((entries, i) => entries.map((e) => ({ ...e, i })));
  points.sort((a, b) => a.date.localeCompare(b.date));
  const latest = new Map<number, number>();
  const byDate = new Map<string, number>();
  for (const p of points) {
    latest.set(p.i, p.balance);
    byDate.set(p.date, [...latest.values()].reduce((sum, v) => sum + v, 0));
  }
  return [...byDate.entries()].map(([date, total]) => ({ date, total }));
}

export async function renameAccount(db: SQLiteDatabase, id: number, name: string) {
  await db.runAsync("UPDATE accounts SET name = ? WHERE id = ?", name, id);
}

export async function deleteAccount(db: SQLiteDatabase, id: number) {
  await db.runAsync("DELETE FROM transactions WHERE account_id = ?", id);
  await db.runAsync("DELETE FROM benefit_marks WHERE account_id = ?", id);
  await db.runAsync("DELETE FROM custom_benefits WHERE account_id = ?", id);
  await pruneTags(db);
  await db.runAsync("DELETE FROM balance_checkpoints WHERE account_id = ?", id);
  await db.runAsync("DELETE FROM statement_skips WHERE account_id = ?", id);
  await db.runAsync("DELETE FROM statement_closings WHERE account_id = ?", id);
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

// Today in the user's own time zone (toISOString() is UTC, a day ahead on a
// US evening).
export function todayISO(): string {
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
  return checkpoint.balance + (row?.delta ?? 0) + (await cardPersonalAdjustment(db, accountId, target));
}

// For a credit card, what's owed is the user's own view of it: charges they
// ignored (not transfers, which are linked) and what someone paid them back
// come off. Only ignored *charges* -- an ignored payment or credit (money in)
// still went to the card, and payments were often ignored before transfers
// were linked automatically, just to keep them out of spending. The statement balance includes them, so the adjustment covers
// everything up to the date, before or after the statement. Checking and
// savings stay as the bank has them -- ignoring a purchase there doesn't
// put the cash back.
async function cardPersonalAdjustment(db: SQLiteDatabase, accountId: number, target: string): Promise<number> {
  const row = await db.getFirstAsync<{ type: string; adjustment: number | null }>(
    `SELECT accounts.type as type,
       (SELECT SUM(CASE
            WHEN t.ignored = 1 AND t.linked_transaction_id IS NULL AND t.amount < 0 THEN -t.amount
            WHEN t.ignored = 0 THEN COALESCE(t.reimbursed, 0)
            ELSE 0 END)
        FROM transactions t WHERE t.account_id = accounts.id AND t.date <= ?) as adjustment
     FROM accounts WHERE accounts.id = ?`,
    target,
    accountId
  );
  return row?.type === "Credit Card" ? (row.adjustment ?? 0) : 0;
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
// Transactions between two dates (a month or a whole year), newest first,
// each with the account's running balance after it.
export async function getAccountLedger(
  db: SQLiteDatabase,
  accountId: number,
  monthStart: string,
  monthEnd: string
): Promise<TransactionWithBalance[]> {
  let running = (await getAccountBalanceAsOf(db, accountId, dayBefore(monthStart))) ?? 0;

  const rows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT} WHERE transactions.account_id = ? AND transactions.date >= ? AND transactions.date <= ?
     ORDER BY transactions.date ASC, transactions.id ASC`,
    accountId,
    monthStart,
    monthEnd
  );

  const isCard =
    (await db.getFirstAsync<{ type: string }>("SELECT type FROM accounts WHERE id = ?", accountId))?.type === "Credit Card";
  const withBalance: TransactionWithBalance[] = rows.map((row) => {
    const transaction = toTransaction(row);
    // Same personal view as cardPersonalAdjustment for a card's running balance.
    if (!isCard) running += transaction.amount;
    else if (!(transaction.ignored && transaction.linkedTransactionId === null && transaction.amount < 0)) {
      running += transaction.amount + (transaction.ignored ? 0 : transaction.reimbursed ?? 0);
    }
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
  // Tracked bank accounts join in, with negative ids so they can't collide
  // with an asset's id where these are listed together.
  for (const b of await getBankAssets(db)) {
    if (b.included && b.balance !== null) {
      results.push({ id: -b.accountId, name: b.name, type: b.type, balance: b.balance });
    }
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
  return getAssetsHistory(db, (t) => t === type);
}

// Combined balance-over-time across every asset regardless of type -- powers
// the total savings & investments trend chart.
export async function getAllAssetsHistory(
  db: SQLiteDatabase,
  excludeTypes: AssetType[] = []
): Promise<{ date: string; total: number }[]> {
  return getAssetsHistory(db, (t) => !excludeTypes.includes(t));
}

// Combined balance history of hand-entered assets and included bank
// accounts whose type passes `includeType`.
async function getAssetsHistory(
  db: SQLiteDatabase,
  includeType: (type: AssetType) => boolean
): Promise<{ date: string; total: number }[]> {
  const series: { date: string; balance: number }[][] = [];
  for (const a of (await getAssets(db)).filter((a) => includeType(a.type))) {
    series.push((await getAssetBalances(db, a.id)).map((e) => ({ date: e.date, balance: e.balance })));
  }
  for (const b of await getBankAssets(db)) {
    if (b.included && includeType(b.type)) series.push(b.history);
  }
  return sumSeries(series.filter((entries) => entries.length > 0));
}

// Remaining balance for every category tracked as a loan -- mirrors the
// per-category math on the category detail page (only payments dated after
// loan_as_of_date count against the loan amount).
// Balance, interest so far and monthly history for one tracked loan, from
// its known balance plus every (non-ignored) payment since -- see simulateLoan.
export async function getLoanStatus(db: SQLiteDatabase, loan: TrackedLoan): Promise<LoanStatus> {
  const txs = await getTransactions(db, { categoryName: loan.name });
  const payments = txs.filter((t) => !t.ignored).map((t) => ({ date: t.date, amount: t.amount }));
  return simulateLoan(loan, payments);
}

export type LoanSummary = TrackedLoan & { id: number; loanKind: LoanKind | null; remaining: number };

export async function getLoanSummaries(db: SQLiteDatabase): Promise<LoanSummary[]> {
  const categories = await getCategories(db);
  const results: LoanSummary[] = [];
  for (const c of categories) {
    if (!c.loanAmount || !c.loanAsOfDate) continue;
    const loan: TrackedLoan = {
      name: c.name,
      loanAmount: c.loanAmount,
      loanAsOfDate: c.loanAsOfDate,
      loanInterestRate: c.loanInterestRate,
      loanEscrow: c.loanEscrow,
    };
    const status = await getLoanStatus(db, loan);
    results.push({ ...loan, id: c.id, loanKind: c.loanKind, remaining: status.remaining });
  }
  return results;
}

export async function getLoanBalanceHistory(
  db: SQLiteDatabase,
  loan: TrackedLoan
): Promise<{ month: string; remaining: number }[]> {
  return (await getLoanStatus(db, loan)).history;
}

export async function deleteAssetBalance(db: SQLiteDatabase, id: number) {
  await db.runAsync("DELETE FROM asset_balances WHERE id = ?", id);
}

// Inserts extracted transactions, checking local merchant memory first: a
// merchant we've already categorized before is trusted over the extraction's
// own guess, and doesn't need review again.
// Saves a statement's transactions in one database transaction -- much
// faster than a write per row, and a failure partway leaves nothing half
// saved. Merchant memory and category ids are read once up front instead of
// once per row.
// Returns how many transactions on the watch list it found.
export async function insertExtractedTransactions(
  db: SQLiteDatabase,
  accountId: number,
  extracted: ExtractedTransaction[]
): Promise<number> {
  const memory = new Map(
    (await db.getAllAsync<{ merchant_key: string; category_id: number }>(
      "SELECT merchant_key, category_id FROM merchant_category_map"
    )).map((r) => [r.merchant_key, r.category_id])
  );
  const categoryIds = new Map<string, number>();
  for (const t of extracted) {
    if (!categoryIds.has(t.category)) categoryIds.set(t.category, await getCategoryIdByName(db, t.category));
  }
  // A paycheck into checking or savings from a payer not seen before goes
  // straight to Income, and the payer is remembered like any other choice.
  const account = await db.getFirstAsync<{ type: string }>("SELECT type FROM accounts WHERE id = ?", accountId);
  const bank = account?.type === "Checking" || account?.type === "Savings";
  // Looked up directly: no "Income" category (deleted) means no auto-sorting,
  // rather than paychecks quietly landing in Other.
  const incomeRow = bank
    ? await db.getFirstAsync<{ id: number }>("SELECT id FROM categories WHERE LOWER(name) = LOWER(?)", INCOME_CATEGORY_NAME)
    : null;
  const incomeId = incomeRow?.id ?? null;
  const cardDefault = await getCardDefaultPerson(db, accountId);
  await db.withTransactionAsync(async () => {
    for (const t of extracted) {
      const key = normalizeMerchantKey(t.merchant);
      let known = memory.get(key);
      if (known === undefined && incomeId !== null && t.amount > 0 && looksLikePaycheck(t.merchant)) {
        known = incomeId;
        memory.set(key, incomeId);
        await db.runAsync("INSERT OR IGNORE INTO merchant_category_map (merchant_key, category_id) VALUES (?, ?)", key, incomeId);
      }
      await db.runAsync(
        "INSERT INTO transactions (account_id, date, merchant, amount, category_id, needs_review, ignored, person_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
        accountId,
        t.date,
        t.merchant,
        t.amount,
        known ?? categoryIds.get(t.category)!,
        known !== undefined ? 0 : t.needsReview ? 1 : 0,
        cardDefault
      );
    }
  });
  return scanWatches(db);
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
    "INSERT INTO transactions (account_id, date, merchant, amount, category_id, needs_review, ignored, person_id) VALUES (?, ?, ?, ?, ?, 0, 0, ?)",
    transaction.accountId,
    transaction.date,
    transaction.merchant,
    transaction.amount,
    transaction.categoryId,
    await getCardDefaultPerson(db, transaction.accountId)
  );
  await scanWatches(db);
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
    linked_account.name as linkedAccountName,
    transactions.note as note,
    transactions.reimbursed as reimbursed,
    transactions.reimbursed_via as reimbursedVia,
    (SELECT group_concat(tags.name, char(31)) FROM transaction_tags
       JOIN tags ON tags.id = transaction_tags.tag_id
       WHERE transaction_tags.transaction_id = transactions.id) as tagList,
    (SELECT watch_flags.watch_id FROM watch_flags
       WHERE watch_flags.transaction_id = transactions.id AND watch_flags.status = 'flagged' LIMIT 1) as watchId,
    (SELECT COALESCE(NULLIF(watches.note, ''), NULLIF(watches.look_for, ''), printf('About $%.2f', watches.amount)) FROM watch_flags JOIN watches ON watches.id = watch_flags.watch_id
       WHERE watch_flags.transaction_id = transactions.id AND watch_flags.status = 'flagged' LIMIT 1) as watchNote,
    transactions.person_id as personId,
    (SELECT people.name FROM people WHERE people.id = transactions.person_id) as personName
  FROM transactions
  JOIN accounts ON accounts.id = transactions.account_id
  JOIN categories ON categories.id = transactions.category_id
  LEFT JOIN transactions AS linked_tx ON linked_tx.id = transactions.linked_transaction_id
  LEFT JOIN accounts AS linked_account ON linked_account.id = linked_tx.account_id
`;

type TransactionRow = Omit<Transaction, "needsReview" | "ignored" | "tags"> & {
  needsReview: number;
  ignored: number;
  // Tag names joined with the ASCII unit separator (char 31), or null.
  tagList: string | null;
};

function toTransaction({ tagList, ...row }: TransactionRow): Transaction {
  return {
    ...row,
    needsReview: row.needsReview === 1,
    ignored: row.ignored === 1,
    tags: tagList ? tagList.split("\u001f").sort() : [],
  };
}

// "#Work Trip " -> "work-trip": one spelling per tag, so they group and search reliably.
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

// "Someone paid me back" for part of a charge -- `amount` of it, by `via`
// (Cash, Zelle...). Null clears it.
export async function setTransactionReimbursed(db: SQLiteDatabase, id: number, amount: number | null, via: string | null) {
  await db.runAsync(
    "UPDATE transactions SET reimbursed = ?, reimbursed_via = ? WHERE id = ?",
    amount && amount > 0 ? amount : null,
    amount && amount > 0 ? via : null,
    id
  );
}

// Replaces a transaction's note and full tag list.
export async function setTransactionNote(db: SQLiteDatabase, id: number, note: string, tags: string[]) {
  const trimmed = note.trim();
  await db.runAsync("UPDATE transactions SET note = ? WHERE id = ?", trimmed || null, id);
  await db.runAsync("DELETE FROM transaction_tags WHERE transaction_id = ?", id);
  for (const name of new Set(tags.map(normalizeTag).filter(Boolean))) {
    await db.runAsync("INSERT OR IGNORE INTO tags (name) VALUES (?)", name);
    await db.runAsync(
      "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
      id,
      name
    );
  }
  await pruneTags(db);
}

// Every tag in use, most-used first -- for suggestions and Search's tag filter.
export async function getAllTags(db: SQLiteDatabase): Promise<{ name: string; count: number }[]> {
  return db.getAllAsync<{ name: string; count: number }>(
    `SELECT tags.name as name, COUNT(*) as count FROM transaction_tags
     JOIN tags ON tags.id = transaction_tags.tag_id
     GROUP BY tags.id ORDER BY count DESC, tags.name`
  );
}

// Drops links to deleted transactions and tags nothing uses. Matters beyond
// tidiness: SQLite can hand a deleted transaction's id to the next insert,
// which would otherwise inherit the old transaction's tags.
// Runs after transactions are deleted. Also clears their watch flags, since
// a deleted id can be reused by the next upload, and pulls each watch's
// starting point back so a re-uploaded statement still gets checked.
async function pruneTags(db: SQLiteDatabase) {
  await db.execAsync(`
    DELETE FROM transaction_tags WHERE transaction_id NOT IN (SELECT id FROM transactions);
    DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM transaction_tags);
    DELETE FROM watch_flags WHERE transaction_id NOT IN (SELECT id FROM transactions);
    UPDATE watches SET after_transaction_id = MIN(after_transaction_id, (SELECT COALESCE(MAX(id), 0) FROM transactions));
  `);
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
    `${TRANSFER_PAIRS} AND ABS(JULIANDAY(a.date) - JULIANDAY(b.date)) <= 7
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
// Unlinked pairs on different accounts where one is money in and the other
// the same amount out, not dismissed on Find Transfers. Joining money-in
// rows to the exact negated amount uses the amount index, instead of
// comparing every transaction with every other one -- which, with a few
// thousand transactions, was most of the app's startup time. Ids come back
// lowest first, the way dismissed pairs are stored. Callers add the date
// window.
const TRANSFER_PAIRS = `
  SELECT MIN(a.id, b.id) as aId, MAX(a.id, b.id) as bId,
    ABS(JULIANDAY(a.date) - JULIANDAY(b.date)) as dayGap
  FROM transactions a
  JOIN transactions b ON b.amount = -a.amount
  WHERE a.amount > 0
    AND a.linked_transaction_id IS NULL
    AND b.linked_transaction_id IS NULL
    AND a.account_id != b.account_id
    AND NOT EXISTS (
      SELECT 1 FROM dismissed_transfer_matches d
      WHERE d.a_id = MIN(a.id, b.id) AND d.b_id = MAX(a.id, b.id)
    )`;

// Links the obvious transfers without asking -- typically checking paying
// off a card: the same amount to the cent, money out of one account and in
// to another, within 5 days either way. Only a pair with no other candidate
// on either side is linked; anything ambiguous (two $800 payments that week)
// is left for Find Transfers. Pairs the user dismissed there stay unlinked.
// Returns how many pairs it linked.
const AUTO_LINK_MAX_DAYS = 5;

export async function autoLinkTransfers(db: SQLiteDatabase): Promise<number> {
  const pairs = await db.getAllAsync<{ aId: number; bId: number }>(
    `${TRANSFER_PAIRS} AND ABS(JULIANDAY(a.date) - JULIANDAY(b.date)) <= ?`,
    AUTO_LINK_MAX_DAYS
  );
  const candidateCount = new Map<number, number>();
  for (const { aId, bId } of pairs) {
    candidateCount.set(aId, (candidateCount.get(aId) ?? 0) + 1);
    candidateCount.set(bId, (candidateCount.get(bId) ?? 0) + 1);
  }
  let linked = 0;
  for (const { aId, bId } of pairs) {
    if (candidateCount.get(aId) === 1 && candidateCount.get(bId) === 1) {
      await linkTransactions(db, aId, bId);
      linked++;
    }
  }
  return linked;
}

export async function linkTransactions(db: SQLiteDatabase, idA: number, idB: number) {
  const rows = await db.getAllAsync<{ id: number; amount: number }>(
    "SELECT id, amount FROM transactions WHERE id IN (?, ?)",
    idA,
    idB
  );
  if (rows.length !== 2) return;
  const [a, b] = rows;
  // Both sides: a transfer (checking paying a card) moves money, it isn't
  // spending -- and the card's "+$800 PAYMENT" side left counted used to
  // pull spending down by $800. Balances still include both, since they
  // sum every transaction regardless.
  await db.runAsync("UPDATE transactions SET linked_transaction_id = ?, ignored = 1 WHERE id = ?", b.id, a.id);
  await db.runAsync("UPDATE transactions SET linked_transaction_id = ?, ignored = 1 WHERE id = ?", a.id, b.id);
}

// Undoes a link. Leaves `ignored` as linking last set it on both sides --
// the user can toggle it back with setTransactionIgnored if that's not
// what they want once unlinked.
export async function unlinkTransaction(db: SQLiteDatabase, id: number) {
  const row = await db.getFirstAsync<{ linkedId: number | null }>(
    "SELECT linked_transaction_id as linkedId FROM transactions WHERE id = ?",
    id
  );
  await db.runAsync("UPDATE transactions SET linked_transaction_id = NULL, ignored = 0 WHERE id = ?", id);
  if (row?.linkedId) {
    await db.runAsync("UPDATE transactions SET linked_transaction_id = NULL, ignored = 0 WHERE id = ?", row.linkedId);
    // Remember the user said these aren't a pair, or auto-linking would
    // just link them again next time the app opens.
    await dismissTransferMatch(db, id, row.linkedId);
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
    // Every category that counts as income, or none of them.
    incomeOnly?: boolean;
    excludeIncome?: boolean;
    // The Payment category, plus any category with loan-payoff tracking
    // turned on (see setCategoryLoan) -- paying down a tracked loan
    // is the same kind of debt transfer as a card Payment. Mirrors the
    // "payments" aggregation in getIncomeExpenseTotals/getPaymentTotal, so
    // the drill-down list matches what those totals actually added up.
    paymentCategoriesOnly?: boolean;
    // This person's own transactions and the shared ones.
    personId?: number;
  }
): Promise<Transaction[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters?.personId !== undefined) {
    clauses.push("(transactions.person_id = ? OR transactions.person_id = ?)");
    params.push(filters.personId, SHARED);
  }
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
  if (filters?.incomeOnly) clauses.push("categories.is_income = 1");
  if (filters?.excludeIncome) clauses.push("categories.is_income = 0");
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
  await pruneTags(db);
  return result.changes;
}

// For fixing a single accidental entry (typo'd manual add, wrong upload
// row) without having to go through the bulk account/date-range tool.
export async function deleteTransaction(db: SQLiteDatabase, id: number) {
  await db.runAsync("DELETE FROM transactions WHERE id = ?", id);
  await pruneTags(db);
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
// A category picked on one transaction: just that one, unless the user asks
// for every charge from the store (which also sets it for future uploads).
export async function changeCategory(
  db: SQLiteDatabase,
  transaction: { id: number; merchant: string },
  categoryId: number,
  wholeStore: boolean
) {
  if (wholeStore) {
    await setMerchantCategory(db, transaction.merchant, categoryId);
    return;
  }
  await db.runAsync("UPDATE transactions SET category_id = ?, needs_review = 0 WHERE id = ?", categoryId, transaction.id);
}

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
       SUM(CASE WHEN (categories.is_income = 1 OR LOWER(categories.name) = LOWER(?)) THEN transactions.amount ELSE 0 END) as income,
       SUM(CASE WHEN categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
             AND ${NOT_BANK_INFLOW}
           THEN -${SPEND_AMOUNT} ELSE 0 END) as expenses,
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
  // Payments: what cards received, counted once on the card side (linked
  // transfers are left out of the sums above, so they're counted here), plus
  // payments on tracked loans.
  const cardPayments = await getCardPaymentsTotal(db, filters.start, filters.end, filters.accountId);
  const loanRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(ABS(transactions.amount)) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE ${clauses.join(" AND ")} AND categories.loan_amount IS NOT NULL`,
    ...params
  );
  return { income: row?.income ?? 0, expenses: row?.expenses ?? 0, payments: cardPayments + (loanRow?.total ?? 0) };
}

export type MonthlyTotal = { month: string; income: number; expenses: number };

// Returns income/expense totals for the last `months` calendar months that
// have any transactions, oldest first, for charting.
export async function getMonthlyTotals(
  db: SQLiteDatabase,
  months: number,
  // Limits it to one account, like Home's card chips do for its totals.
  accountId?: number
): Promise<MonthlyTotal[]> {
  const rows = await db.getAllAsync<MonthlyTotal>(
    `SELECT
       substr(transactions.date, 1, 7) as month,
       SUM(CASE WHEN (categories.is_income = 1 OR LOWER(categories.name) = LOWER(?)) THEN transactions.amount ELSE 0 END) as income,
       SUM(CASE WHEN categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
             AND ${NOT_BANK_INFLOW}
           THEN -${SPEND_AMOUNT} ELSE 0 END) as expenses
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.ignored = 0
       ${accountId !== undefined ? "AND transactions.account_id = ?" : ""}
     GROUP BY month
     ORDER BY month DESC
     LIMIT ?`,
    INCOME_CATEGORY_NAME,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    ...(accountId !== undefined ? [accountId] : []),
    months
  );
  return rows.reverse();
}

// Monthly spend for a single category, for the trend chart on the category
// detail page -- expressed as a positive amount (spend magnitude) per month.
// Pass accountId to limit it to one card.
export async function getCategoryMonthlyTotals(
  db: SQLiteDatabase,
  categoryName: string,
  months: number,
  accountId?: number,
  person?: PersonFilter
): Promise<{ month: string; total: number }[]> {
  const rows = await db.getAllAsync<{ month: string; total: number }>(
    `SELECT
       substr(transactions.date, 1, 7) as month,
       SUM(-${SPEND_AMOUNT} * ${personShareSql(person)}) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.ignored = 0 AND ${NOT_BANK_INFLOW} AND LOWER(categories.name) = LOWER(?)
       ${accountId !== undefined ? "AND transactions.account_id = ?" : ""}
     GROUP BY month
     ORDER BY month DESC
     LIMIT ?`,
    categoryName,
    ...(accountId !== undefined ? [accountId] : []),
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
       SUM(CASE WHEN categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
             AND ${NOT_BANK_INFLOW}
           THEN -${SPEND_AMOUNT} ELSE 0 END) as total
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
       SUM(CASE WHEN categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
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
       SUM(CASE WHEN categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
             AND categories.loan_amount IS NULL
             AND ${NOT_BANK_INFLOW}
           THEN -${SPEND_AMOUNT} ELSE 0 END) as spent,
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

// `month` is a date prefix: "YYYY-MM" for a month or "YYYY" for a year.
// Pass accountId to limit it to one card.
export async function getCategorySummary(
  db: SQLiteDatabase,
  month: string,
  accountId?: number,
  person?: PersonFilter
): Promise<CategoryTotal[]> {
  return db.getAllAsync<CategoryTotal>(
    `SELECT categories.name as categoryName, SUM(-${SPEND_AMOUNT} * ${personShareSql(person)}) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.date LIKE ? AND transactions.ignored = 0 AND ${NOT_BANK_INFLOW}
       AND categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
       AND categories.loan_amount IS NULL
       ${accountId !== undefined ? "AND transactions.account_id = ?" : ""}
     GROUP BY categories.name
     ${person ? "HAVING total != 0" : ""}
     ORDER BY total DESC`,
    `${month}%`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME,
    ...(accountId !== undefined ? [accountId] : [])
  );
}

// Like getCategorySummary, for any range of dates.
export async function getCategoryTotalsBetween(
  db: SQLiteDatabase,
  start: string,
  end: string,
  person?: PersonFilter
): Promise<CategoryTotal[]> {
  return db.getAllAsync<CategoryTotal>(
    `SELECT categories.name as categoryName, SUM(-${SPEND_AMOUNT} * ${personShareSql(person)}) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.date >= ? AND transactions.date <= ? AND transactions.ignored = 0 AND ${NOT_BANK_INFLOW}
       AND categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
       AND categories.loan_amount IS NULL
     GROUP BY categories.name
     ${person ? "HAVING total != 0" : ""}`,
    start,
    end,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME
  );
}

// The "View all" categories page for a period ("YYYY-MM" or "YYYY").
export async function getCategoryDetails(
  db: SQLiteDatabase,
  key: string,
  person?: PersonFilter
): Promise<{ details: CategoryDetails; label: string }> {
  const { start, end } = periodRange(key);
  const comparison = comparisonPeriod(key, todayISO());
  const [current, previous, spending] = await Promise.all([
    getCategorySummary(db, key, undefined, person),
    getCategoryTotalsBetween(db, comparison.start, comparison.end, person),
    getSpending(db, start, end, person),
  ]);
  return {
    details: buildCategoryDetails({ current, previous, spending, keyFor: merchantGroupKey, displayName: formatMerchantName }),
    label: comparison.label,
  };
}

// How much of a transaction counts for a person, in SQL (see shareOf).
function personShareSql(person?: PersonFilter): string {
  if (!person) return "1";
  return `(CASE WHEN transactions.person_id = ${Number(person.personId)} THEN 1.0
    WHEN transactions.person_id = ${SHARED} THEN 1.0 / ${Math.max(1, Number(person.peopleCount))}
    ELSE 0 END)`;
}

// Total paid toward cards/debt for a given month -- the Payment category,
// plus any category with loan-payoff tracking turned on (a car loan, etc.
// -- see setCategoryLoan), since paying down a tracked loan is the
// same kind of debt-service transfer as a card Payment, not real spending
// or income. Shown as its own figure since both are excluded from Income
// and Expenses (see getIncomeExpenseTotals).
// What's owed on each credit card as of a date. A card's running balance
// is kept like any account's (charges negative), so owed is its negative.
// Cards with no known balance yet -- no statement balance read, none set --
// are listed in `missing` instead of guessed at.
export async function getCardsOwed(
  db: SQLiteDatabase,
  asOfDate: string
): Promise<{ total: number; cards: { id: number; name: string; owed: number }[]; missing: string[] }> {
  const cards = (await getAccounts(db)).filter((a) => a.type === "Credit Card");
  const known: { id: number; name: string; owed: number }[] = [];
  const missing: string[] = [];
  for (const card of cards) {
    const balance = await getAccountBalanceAsOf(db, card.id, asOfDate);
    if (balance === null) missing.push(card.name);
    else known.push({ id: card.id, name: card.name, owed: -balance });
  }
  return { total: known.reduce((sum, c) => sum + c.owed, 0), cards: known, missing };
}

// Payments credit cards received in a period, counted once -- on the card's
// side, so the checking withdrawal that paid it isn't counted again -- and
// only payments: the Payment category, a linked transfer, or a payment line
// ("PAYMENT THANK YOU", "AUTOPAY"). Refunds are money in too but aren't payments.
export async function getCardPaymentsTotal(
  db: SQLiteDatabase,
  start: string,
  end: string,
  accountId?: number
): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(transactions.amount) as total
     FROM transactions
     JOIN accounts ON accounts.id = transactions.account_id
     JOIN categories ON categories.id = transactions.category_id
     WHERE accounts.type = 'Credit Card' AND transactions.amount > 0
       AND transactions.date >= ? AND transactions.date <= ?
       AND (LOWER(categories.name) = LOWER(?)
         OR transactions.linked_transaction_id IS NOT NULL
         OR UPPER(transactions.merchant) LIKE '%PAYMENT%'
         OR UPPER(transactions.merchant) LIKE '%AUTOPAY%'
         OR UPPER(transactions.merchant) LIKE '%THANK YOU%')
       ${accountId !== undefined ? "AND transactions.account_id = ?" : ""}`,
    start,
    end,
    PAYMENT_CATEGORY_NAME,
    ...(accountId !== undefined ? [accountId] : [])
  );
  return row?.total ?? 0;
}

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
  // cardProduct/annualFee/benefitMarks are optional so older backups still restore.
  accounts: {
    name: string;
    type: string;
    cardProduct?: string | null;
    annualFee?: number | null;
    includeInSavings?: boolean;
    statementReminders?: boolean;
    statementDay?: number | null;
    statementDaySetBy?: "statement" | "user" | null;
  }[];
  statementClosings?: { accountName: string; date: string }[];
  // Optional so backups from before they were included still restore.
  balanceCheckpoints?: { accountName: string; date: string; balance: number }[];
  statementSkips?: { accountName: string; month: string }[];
  checkInsDone?: string[];
  incomeLabels?: { merchantKey: string; label: string }[];
  benefitMarks?: { accountName: string; benefitId: string; periodKey: string; amount: number }[];
  customBenefits?: {
    accountName: string;
    name: string;
    amount: number;
    period: BenefitPeriod;
    matchWords: string | null;
    appliedAs?: "statementCredit" | "inApp" | null;
    benefitId: string;
  }[];
  // loanInterestRate is optional so backups from before it existed still restore.
  categories: {
    name: string;
    loanAmount: number | null;
    loanAsOfDate: string | null;
    loanInterestRate?: number | null;
    loanKind?: LoanKind | null;
    loanEscrow?: number | null;
    isIncome?: boolean;
  }[];
  merchantCategoryMap: { merchantKey: string; categoryName: string }[];
  transactions: {
    accountName: string;
    date: string;
    merchant: string;
    amount: number;
    categoryName: string;
    needsReview: boolean;
    ignored: boolean;
    // Optional so backups from before notes and tags existed still restore.
    note?: string | null;
    tags?: string[];
    reimbursed?: number | null;
    reimbursedVia?: string | null;
    person?: string | null;
  }[];
  assets: { name: string; type: AssetType }[];
  assetBalances: { assetName: string; date: string; balance: number }[];
  // Optional so backups made before the name setting existed still restore.
  userName?: string | null;
  recurringOverrides?: { merchantKey: string; status: RecurringOverride }[];
  // Who spent what, by name since ids change on restore. SHARED_NAME
  // stands for Shared. Optional so older backups still restore.
  people?: { name: string; isMe: boolean }[];
  accountPeople?: { accountName: string; person: string }[];
  settleUps?: { month: string; person: string; amount: number }[];
  // The watch list, with the transactions each one flagged (found by
  // account, date, merchant and amount, since ids change on restore).
  watches?: {
    lookFor: string;
    note: string;
    amount: number | null;
    direction: WatchDirection | null;
    keepWatching: boolean;
    createdAt: string;
    closedAt: string | null;
    flags: { accountName: string; date: string; merchant: string; amount: number; status: string }[];
  }[];
};

export async function exportAllData(db: SQLiteDatabase): Promise<DataSnapshot> {
  const accountRows = await db.getAllAsync<{
    name: string;
    type: string;
    cardProduct: string | null;
    annualFee: number | null;
    includeInSavings: number;
    statementReminders: number;
    statementDay: number | null;
    statementDaySetBy: "statement" | "user" | null;
  }>(
    `SELECT name, type, card_product as cardProduct, annual_fee as annualFee,
       include_in_savings as includeInSavings, statement_reminders as statementReminders,
       statement_day as statementDay, statement_day_set_by as statementDaySetBy
     FROM accounts ORDER BY id`
  );
  const accounts = accountRows.map((a) => ({
    ...a,
    includeInSavings: a.includeInSavings === 1,
    statementReminders: a.statementReminders === 1,
  }));
  const categoryRows = await db.getAllAsync<{
    name: string;
    loanAmount: number | null;
    loanAsOfDate: string | null;
    loanInterestRate: number | null;
    loanKind: LoanKind | null;
    loanEscrow: number | null;
    isIncome: number;
  }>(
    `SELECT name, loan_amount as loanAmount, loan_as_of_date as loanAsOfDate, loan_interest_rate as loanInterestRate,
       loan_kind as loanKind, loan_escrow as loanEscrow, is_income as isIncome
     FROM categories ORDER BY id`
  );
  const categories = categoryRows.map((c) => ({ ...c, isIncome: c.isIncome === 1 }));
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
    note: string | null;
    tagList: string | null;
    reimbursed: number | null;
    reimbursedVia: string | null;
    personId: number | null;
  }>(
    `SELECT
       transactions.person_id as personId,
       transactions.note as note,
       transactions.reimbursed as reimbursed,
       transactions.reimbursed_via as reimbursedVia,
       (SELECT group_concat(tags.name, char(31)) FROM transaction_tags
          JOIN tags ON tags.id = transaction_tags.tag_id
          WHERE transaction_tags.transaction_id = transactions.id) as tagList,
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

  const people = await getPeople(db);
  const personName = (id: number | null) =>
    id === SHARED ? SHARED_NAME : (people.find((p) => p.id === id)?.name ?? null);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    people: people.map((p) => ({ name: p.name, isMe: p.isMe })),
    accountPeople: await exportAccountPeople(db, personName),
    settleUps: (await db.getAllAsync<{ month: string; personId: number; amount: number }>(
      "SELECT month, person_id as personId, amount FROM settle_ups"
    )).flatMap((s) => {
      const person = personName(s.personId);
      return person ? [{ month: s.month, person, amount: s.amount }] : [];
    }),
    accounts,
    categories,
    merchantCategoryMap,
    transactions: transactions.map(({ tagList, personId, ...t }) => ({
      ...t,
      person: personName(personId),
      needsReview: t.needsReview === 1,
      ignored: t.ignored === 1,
      tags: tagList ? tagList.split("\u001f") : [],
    })),
    assets,
    assetBalances,
    userName: await getUserName(db),
    customBenefits: await db.getAllAsync<{
      accountName: string;
      name: string;
      amount: number;
      period: BenefitPeriod;
      matchWords: string | null;
      appliedAs: "statementCredit" | "inApp" | null;
      benefitId: string;
    }>(
      `SELECT accounts.name as accountName, custom_benefits.name as name, custom_benefits.amount as amount,
         custom_benefits.period as period, custom_benefits.match_words as matchWords,
         custom_benefits.applied_as as appliedAs,
         'custom-' || custom_benefits.id as benefitId
       FROM custom_benefits JOIN accounts ON accounts.id = custom_benefits.account_id ORDER BY custom_benefits.id`
    ),
    benefitMarks: await db.getAllAsync<{ accountName: string; benefitId: string; periodKey: string; amount: number }>(
      `SELECT accounts.name as accountName, benefit_marks.benefit_id as benefitId,
         benefit_marks.period_key as periodKey, benefit_marks.amount as amount
       FROM benefit_marks JOIN accounts ON accounts.id = benefit_marks.account_id`
    ),
    recurringOverrides: await db.getAllAsync<{ merchantKey: string; status: RecurringOverride }>(
      "SELECT merchant_key as merchantKey, status FROM recurring_overrides"
    ),
    balanceCheckpoints: await db.getAllAsync<{ accountName: string; date: string; balance: number }>(
      `SELECT accounts.name as accountName, balance_checkpoints.date as date, balance_checkpoints.balance as balance
       FROM balance_checkpoints JOIN accounts ON accounts.id = balance_checkpoints.account_id
       ORDER BY balance_checkpoints.date`
    ),
    checkInsDone: await getCheckInsDone(db),
    incomeLabels: await db.getAllAsync<{ merchantKey: string; label: string }>(
      "SELECT merchant_key as merchantKey, label FROM income_sources"
    ),
    statementClosings: await db.getAllAsync<{ accountName: string; date: string }>(
      `SELECT accounts.name as accountName, statement_closings.date as date
       FROM statement_closings JOIN accounts ON accounts.id = statement_closings.account_id`
    ),
    statementSkips: await db.getAllAsync<{ accountName: string; month: string }>(
      `SELECT accounts.name as accountName, statement_skips.month as month
       FROM statement_skips JOIN accounts ON accounts.id = statement_skips.account_id`
    ),
    watches: await exportWatches(db),
  };
}

async function exportWatches(db: SQLiteDatabase): Promise<NonNullable<DataSnapshot["watches"]>> {
  const rows = await db.getAllAsync<WatchRow>(`${WATCH_SELECT} ORDER BY id`);
  const flags = await db.getAllAsync<{ watchId: number; accountName: string; date: string; merchant: string; amount: number; status: string }>(
    `SELECT watch_flags.watch_id as watchId, accounts.name as accountName, transactions.date as date,
       transactions.merchant as merchant, transactions.amount as amount, watch_flags.status as status
     FROM watch_flags
     JOIN transactions ON transactions.id = watch_flags.transaction_id
     JOIN accounts ON accounts.id = transactions.account_id`
  );
  return rows.map((r) => {
    const { id, ...w } = toWatch(r);
    return { ...w, flags: flags.filter((f) => f.watchId === id).map(({ watchId: _, ...f }) => f) };
  });
}

// After a restore's transactions are in: watches look only at what comes
// in from now on, and their old flags find their transactions again.
async function restoreWatches(db: SQLiteDatabase, watches: NonNullable<DataSnapshot["watches"]>) {
  const last = (await db.getFirstAsync<{ last: number | null }>("SELECT MAX(id) as last FROM transactions"))?.last ?? 0;
  for (const w of watches) {
    const id = await addWatch(db, w, last);
    await db.runAsync("UPDATE watches SET created_at = ?, closed_at = ? WHERE id = ?", w.createdAt, w.closedAt, id);
    for (const f of w.flags) {
      const tx = await db.getFirstAsync<{ id: number }>(
        `SELECT transactions.id as id FROM transactions JOIN accounts ON accounts.id = transactions.account_id
         WHERE accounts.name = ? AND transactions.date = ? AND transactions.merchant = ? AND ABS(transactions.amount - ?) < 0.005`,
        f.accountName,
        f.date,
        f.merchant,
        f.amount
      );
      if (tx) await db.runAsync("INSERT OR IGNORE INTO watch_flags (watch_id, transaction_id, status) VALUES (?, ?, ?)", id, tx.id, f.status);
    }
  }
}

// Replaces all local data with the given snapshot -- used to restore from a
// Google Drive backup. Existing local data is discarded, so this is meant
// for restoring onto a fresh/empty database, not merging.
export async function replaceAllData(db: SQLiteDatabase, snapshot: DataSnapshot) {
  await db.execAsync(
    "DELETE FROM settle_ups; DELETE FROM watch_flags; DELETE FROM watches; DELETE FROM income_sources; DELETE FROM statement_closings; DELETE FROM statement_skips; DELETE FROM custom_benefits; DELETE FROM benefit_marks; DELETE FROM transaction_tags; DELETE FROM tags; DELETE FROM transactions; DELETE FROM merchant_category_map; DELETE FROM categories; DELETE FROM accounts; DELETE FROM asset_balances; DELETE FROM assets;"
  );

  const personIdFor = await restorePeople(db, snapshot);

  const categoryIds = new Map<string, number>();
  for (const category of snapshot.categories) {
    const result = await db.runAsync(
      "INSERT INTO categories (name, loan_amount, loan_as_of_date, loan_interest_rate, loan_kind, loan_escrow, is_income) VALUES (?, ?, ?, ?, ?, ?, ?)",
      category.name,
      category.loanAmount ?? null,
      category.loanAsOfDate ?? null,
      category.loanInterestRate ?? null,
      category.loanKind ?? null,
      category.loanEscrow ?? null,
      category.isIncome || category.name.toLowerCase() === INCOME_CATEGORY_NAME.toLowerCase() ? 1 : 0
    );
    categoryIds.set(category.name, result.lastInsertRowId);
  }

  const accountIds = new Map<string, number>();
  for (const account of snapshot.accounts) {
    const result = await db.runAsync(
      `INSERT INTO accounts (name, type, card_product, annual_fee, include_in_savings, statement_reminders,
         statement_day, statement_day_set_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      account.name,
      account.type,
      account.cardProduct ?? null,
      account.annualFee ?? null,
      account.includeInSavings === false ? 0 : 1,
      account.statementReminders === false ? 0 : 1,
      account.statementDay ?? null,
      account.statementDaySetBy ?? null
    );
    accountIds.set(account.name, result.lastInsertRowId);
  }

  for (const a of snapshot.accountPeople ?? []) {
    const accountId = accountIds.get(a.accountName);
    const personId = personIdFor(a.person);
    if (accountId !== undefined && personId !== null) await setAccountDefaultPerson(db, accountId, personId);
  }

  // Older backups have no balances; then whatever this device has stays.
  if (snapshot.balanceCheckpoints) {
    await db.runAsync("DELETE FROM balance_checkpoints");
    for (const c of snapshot.balanceCheckpoints) {
      const accountId = accountIds.get(c.accountName);
      if (accountId !== undefined) await setAccountBalanceCheckpoint(db, accountId, c.balance, c.date);
    }
  }
  for (const month of snapshot.checkInsDone ?? []) await markCheckInDone(db, month);
  for (const l of snapshot.incomeLabels ?? []) {
    await db.runAsync("INSERT OR REPLACE INTO income_sources (merchant_key, label) VALUES (?, ?)", l.merchantKey, l.label);
  }
  for (const c of snapshot.statementClosings ?? []) {
    const accountId = accountIds.get(c.accountName);
    if (accountId !== undefined) await recordStatementClosing(db, accountId, c.date);
  }
  for (const s of snapshot.statementSkips ?? []) {
    const accountId = accountIds.get(s.accountName);
    if (accountId !== undefined) await skipStatementMonth(db, accountId, s.month);
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
    const inserted = await db.runAsync(
      "INSERT INTO transactions (account_id, date, merchant, amount, category_id, needs_review, ignored, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      accountId,
      t.date,
      t.merchant,
      t.amount,
      categoryId,
      t.needsReview ? 1 : 0,
      t.ignored ? 1 : 0,
      personIdFor(t.person ?? null)
    );
    if (t.note || t.tags?.length) {
      await setTransactionNote(db, inserted.lastInsertRowId, t.note ?? "", t.tags ?? []);
    }
    if (t.reimbursed) {
      await setTransactionReimbursed(db, inserted.lastInsertRowId, t.reimbursed, t.reimbursedVia ?? null);
    }
  }

  await restoreWatches(db, snapshot.watches ?? []);

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

  // Custom benefits get new ids on restore; their marks follow the old id to the new one.
  const customIdMap = new Map<string, string>();
  for (const b of snapshot.customBenefits ?? []) {
    const accountId = accountIds.get(b.accountName);
    if (accountId === undefined) continue;
    const result = await db.runAsync(
      "INSERT INTO custom_benefits (account_id, name, amount, period, match_words, applied_as) VALUES (?, ?, ?, ?, ?, ?)",
      accountId,
      b.name,
      b.amount,
      b.period,
      b.matchWords,
      b.appliedAs ?? null
    );
    customIdMap.set(`${b.accountName}|${b.benefitId}`, `custom-${result.lastInsertRowId}`);
  }
  for (const m of snapshot.benefitMarks ?? []) {
    const accountId = accountIds.get(m.accountName);
    const benefitId = customIdMap.get(`${m.accountName}|${m.benefitId}`) ?? m.benefitId;
    if (accountId !== undefined) await setBenefitMark(db, accountId, benefitId, m.periodKey, m.amount);
  }

  // A backup can predate the cleaned-name keys; re-key whatever it brought.
  await setSetting(db, MERCHANT_KEYS_VERSION_KEY, "1");
  const restoreMigration = () => migrateMerchantKeys(db);

  if (snapshot.recurringOverrides) {
    await db.runAsync("DELETE FROM recurring_overrides");
    for (const o of snapshot.recurringOverrides) {
      await db.runAsync(
        "INSERT OR REPLACE INTO recurring_overrides (merchant_key, status) VALUES (?, ?)",
        o.merchantKey,
        o.status
      );
    }
  }
  await restoreMigration();
  // A backup can hold the same wrong dates.
  await repairMisreadClosings(db);
  notifyPeopleChanged();
}

export type AccountTotal = { accountName: string; total: number };

export async function getAccountSummary(
  db: SQLiteDatabase,
  month: string
): Promise<AccountTotal[]> {
  return db.getAllAsync<AccountTotal>(
    `SELECT accounts.name as accountName, SUM(-${SPEND_AMOUNT}) as total
     FROM transactions
     JOIN accounts ON accounts.id = transactions.account_id
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.date LIKE ? AND transactions.ignored = 0 AND ${NOT_BANK_INFLOW}
       AND categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
       AND categories.loan_amount IS NULL
     GROUP BY accounts.name
     ORDER BY total DESC`,
    `${month}%`,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME
  );
}

// ---- Watch list (see lib/watches.ts) ----

type WatchRow = {
  id: number;
  lookFor: string;
  note: string;
  amount: number | null;
  direction: WatchDirection | null;
  keepWatching: number;
  createdAt: string;
  closedAt: string | null;
};

const WATCH_SELECT = `SELECT id, look_for as lookFor, note, amount, direction, keep_watching as keepWatching,
  created_at as createdAt, closed_at as closedAt FROM watches`;

function toWatch(r: WatchRow): Watch {
  return { ...r, keepWatching: r.keepWatching === 1 };
}

export type WatchWithFinds = Watch & { flagged: number; confirmed: number };

export async function getWatches(db: SQLiteDatabase): Promise<WatchWithFinds[]> {
  const rows = await db.getAllAsync<WatchRow>(`${WATCH_SELECT} ORDER BY closed_at IS NOT NULL, COALESCE(closed_at, created_at) DESC`);
  const counts = await db.getAllAsync<{ watchId: number; status: string; n: number }>(
    `SELECT watch_flags.watch_id as watchId, watch_flags.status as status, COUNT(*) as n
     FROM watch_flags JOIN transactions ON transactions.id = watch_flags.transaction_id
     GROUP BY watch_flags.watch_id, watch_flags.status`
  );
  const count = (id: number, status: string) => counts.find((c) => c.watchId === id && c.status === status)?.n ?? 0;
  return rows.map((r) => ({ ...toWatch(r), flagged: count(r.id, "flagged"), confirmed: count(r.id, "confirmed") }));
}

export async function addWatch(
  db: SQLiteDatabase,
  w: { lookFor: string; note: string; amount: number | null; direction: WatchDirection | null; keepWatching: boolean },
  afterTransactionId?: number
): Promise<number> {
  const after =
    afterTransactionId ?? (await db.getFirstAsync<{ last: number | null }>("SELECT MAX(id) as last FROM transactions"))?.last ?? 0;
  const result = await db.runAsync(
    `INSERT INTO watches (look_for, note, amount, direction, keep_watching, after_transaction_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    w.lookFor.trim(),
    w.note.trim(),
    w.amount,
    w.direction,
    w.keepWatching ? 1 : 0,
    after,
    todayISO()
  );
  return result.lastInsertRowId;
}

// Changes what a watch looks for. Flags still waiting that no longer match
// go away, and anything uploaded since the watch began that now does is
// flagged. Returns how many that was.
export async function updateWatch(
  db: SQLiteDatabase,
  id: number,
  w: { lookFor: string; note: string; amount: number | null; direction: WatchDirection | null; keepWatching: boolean }
): Promise<number> {
  const edited = { lookFor: w.lookFor.trim(), amount: w.amount, direction: w.direction };
  await db.runAsync(
    "UPDATE watches SET look_for = ?, note = ?, amount = ?, direction = ?, keep_watching = ? WHERE id = ?",
    edited.lookFor,
    w.note.trim(),
    w.amount,
    w.direction,
    w.keepWatching ? 1 : 0,
    id
  );
  const waiting = await db.getAllAsync<{ id: number; merchant: string; amount: number }>(
    `SELECT transactions.id as id, transactions.merchant as merchant, transactions.amount as amount
     FROM watch_flags JOIN transactions ON transactions.id = watch_flags.transaction_id
     WHERE watch_flags.watch_id = ? AND watch_flags.status = 'flagged'`,
    id
  );
  for (const t of waiting) {
    if (!matchesWatch(edited, t)) await db.runAsync("DELETE FROM watch_flags WHERE watch_id = ? AND transaction_id = ?", id, t.id);
  }
  return scanWatches(db);
}

export async function deleteWatch(db: SQLiteDatabase, id: number) {
  await db.runAsync("DELETE FROM watch_flags WHERE watch_id = ?", id);
  await db.runAsync("DELETE FROM watches WHERE id = ?", id);
}

// Checks transactions added since each open watch was made, flagging new
// matches. Returns how many it flagged.
export async function scanWatches(db: SQLiteDatabase): Promise<number> {
  const open = (await db.getAllAsync<WatchRow & { afterId: number }>(
    `SELECT id, look_for as lookFor, note, amount, direction, keep_watching as keepWatching,
       created_at as createdAt, closed_at as closedAt, after_transaction_id as afterId
     FROM watches WHERE closed_at IS NULL`
  ));
  let found = 0;
  for (const w of open) {
    const candidates = await db.getAllAsync<{ id: number; merchant: string; amount: number }>(
      `SELECT id, merchant, amount FROM transactions
       WHERE id > ? AND id NOT IN (SELECT transaction_id FROM watch_flags WHERE watch_id = ?)`,
      w.afterId,
      w.id
    );
    for (const t of candidates) {
      if (!matchesWatch(toWatch(w), t)) continue;
      await db.runAsync("INSERT OR IGNORE INTO watch_flags (watch_id, transaction_id, status) VALUES (?, ?, 'flagged')", w.id, t.id);
      found++;
    }
  }
  return found;
}

export async function getFlaggedCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM watch_flags JOIN transactions ON transactions.id = watch_flags.transaction_id
     WHERE watch_flags.status = 'flagged'`
  );
  return row?.n ?? 0;
}

// Transactions a watch flagged, waiting for "That's it" or "Not this one".
export async function getFlaggedTransactions(db: SQLiteDatabase): Promise<Transaction[]> {
  const rows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT}
     WHERE transactions.id IN (SELECT transaction_id FROM watch_flags WHERE status = 'flagged')
     ORDER BY transactions.date DESC`
  );
  return rows.map(toTransaction);
}

// "That's it": the watch's note goes on the transaction, and a one-time
// watch closes (its other flags with it). Returns the transaction's note.
export async function confirmWatchFlag(db: SQLiteDatabase, watchId: number, transactionId: number): Promise<string | null> {
  const watch = await db.getFirstAsync<WatchRow>(`${WATCH_SELECT} WHERE id = ?`, watchId);
  const tx = await db.getFirstAsync<{ note: string | null }>("SELECT note FROM transactions WHERE id = ?", transactionId);
  if (!watch || !tx) return tx?.note ?? null;
  // A watch with no note of its own leaves the transaction's note alone.
  const note = watch.note ? noteWithWatch(tx.note, watch.note) : tx.note;
  await db.runAsync("UPDATE transactions SET note = ? WHERE id = ?", note, transactionId);
  await db.runAsync("UPDATE watch_flags SET status = 'confirmed' WHERE watch_id = ? AND transaction_id = ?", watchId, transactionId);
  if (watch.keepWatching !== 1) {
    await db.runAsync("UPDATE watches SET closed_at = ? WHERE id = ?", todayISO(), watchId);
    await db.runAsync("UPDATE watch_flags SET status = 'dismissed' WHERE watch_id = ? AND status = 'flagged'", watchId);
  }
  return note;
}

// "Not this one": unflagged, and the watch keeps looking.
export async function dismissWatchFlag(db: SQLiteDatabase, watchId: number, transactionId: number) {
  await db.runAsync("UPDATE watch_flags SET status = 'dismissed' WHERE watch_id = ? AND transaction_id = ?", watchId, transactionId);
}

// Opens a finished watch again, to keep looking.
export async function reopenWatch(db: SQLiteDatabase, id: number) {
  await db.runAsync("UPDATE watches SET closed_at = NULL WHERE id = ?", id);
}

export async function getWatchFinds(db: SQLiteDatabase, watchId: number): Promise<Transaction[]> {
  const rows = await db.getAllAsync<TransactionRow>(
    `${TRANSACTION_SELECT}
     WHERE transactions.id IN (SELECT transaction_id FROM watch_flags WHERE watch_id = ? AND status = 'confirmed')
     ORDER BY transactions.date DESC`,
    watchId
  );
  return rows.map(toTransaction);
}

// ---- People: who spent what (see lib/people.ts) ----

// Stands for Shared in backups, where people go by name.
const SHARED_NAME = "__shared__";

// "Me" is there from the start, so a second person is all it takes.
async function seedMe(db: SQLiteDatabase) {
  await db.runAsync("INSERT INTO people (name, is_me) SELECT 'Me', 1 WHERE NOT EXISTS (SELECT 1 FROM people)");
}

const peopleListeners = new Set<() => void>();
export function onPeopleChanged(listener: () => void): () => void {
  peopleListeners.add(listener);
  return () => peopleListeners.delete(listener);
}
function notifyPeopleChanged() {
  peopleListeners.forEach((l) => l());
}

export async function getPeople(db: SQLiteDatabase): Promise<Person[]> {
  const rows = await db.getAllAsync<{ id: number; name: string; isMe: number }>(
    "SELECT id, name, is_me as isMe FROM people ORDER BY is_me DESC, id"
  );
  return rows.map((r) => ({ ...r, isMe: r.isMe === 1 }));
}

export async function addPerson(db: SQLiteDatabase, name: string): Promise<number> {
  const result = await db.runAsync("INSERT INTO people (name, is_me) VALUES (?, 0)", name.trim());
  notifyPeopleChanged();
  return result.lastInsertRowId;
}

export async function renamePerson(db: SQLiteDatabase, id: number, name: string) {
  await db.runAsync("UPDATE people SET name = ? WHERE id = ?", name.trim(), id);
  notifyPeopleChanged();
}

// Their transactions stay and go back to nobody's. "Me" can't be removed.
export async function deletePerson(db: SQLiteDatabase, id: number) {
  await db.runAsync("UPDATE transactions SET person_id = NULL WHERE person_id = ?", id);
  await db.runAsync("UPDATE accounts SET default_person_id = NULL WHERE default_person_id = ?", id);
  await db.runAsync("DELETE FROM settle_ups WHERE person_id = ?", id);
  await db.runAsync("DELETE FROM people WHERE id = ? AND is_me = 0", id);
  notifyPeopleChanged();
}

export async function getAccountDefaults(db: SQLiteDatabase): Promise<{ id: number; name: string; defaultPersonId: number | null }[]> {
  return db.getAllAsync("SELECT id, name, default_person_id as defaultPersonId FROM accounts ORDER BY name");
}

// The card decides whose charges are whose: this applies to everything on
// it, past and future. A charge someone set by hand to anyone else stays.
export async function setAccountDefaultPerson(db: SQLiteDatabase, accountId: number, personId: number | null) {
  const previous = await getCardDefaultPerson(db, accountId);
  await db.runAsync("UPDATE accounts SET default_person_id = ? WHERE id = ?", personId, accountId);
  await db.runAsync(
    "UPDATE transactions SET person_id = ? WHERE account_id = ? AND (person_id IS NULL OR person_id = ?)",
    personId,
    accountId,
    previous
  );
}

async function getCardDefaultPerson(db: SQLiteDatabase, accountId: number): Promise<number | null> {
  const row = await db.getFirstAsync<{ personId: number | null }>("SELECT default_person_id as personId FROM accounts WHERE id = ?", accountId);
  return row?.personId ?? null;
}

// An exception to the card's person, for this one transaction.
export async function setTransactionPerson(db: SQLiteDatabase, transactionId: number, personId: number | null) {
  await db.runAsync("UPDATE transactions SET person_id = ? WHERE id = ?", personId, transactionId);
}

// What's shared in a month (YYYY-MM) and where each other person stands.
export async function getSettleUps(
  db: SQLiteDatabase,
  month: string
): Promise<{ sharedTotal: number; people: (SettleUp & { person: Person })[] }> {
  const people = await getPeople(db);
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(-${SPEND_AMOUNT}) as total
     FROM transactions
     JOIN categories ON categories.id = transactions.category_id
     WHERE transactions.date LIKE ? AND transactions.person_id = ? AND transactions.ignored = 0 AND ${NOT_BANK_INFLOW}
       AND categories.is_income = 0 AND LOWER(categories.name) != LOWER(?) AND LOWER(categories.name) != LOWER(?)
       AND categories.loan_amount IS NULL`,
    `${month}%`,
    SHARED,
    INCOME_CATEGORY_NAME,
    PAYMENT_CATEGORY_NAME
  );
  const sharedTotal = Math.max(0, row?.total ?? 0);
  const settled = await db.getAllAsync<{ personId: number; amount: number }>(
    "SELECT person_id as personId, amount FROM settle_ups WHERE month = ?",
    month
  );
  return {
    sharedTotal,
    people: people
      .filter((p) => !p.isMe)
      .map((person) => ({
        person,
        ...settleUp(sharedTotal, people.length, settled.find((s) => s.personId === person.id)?.amount ?? 0),
      })),
  };
}

export async function markSettled(db: SQLiteDatabase, month: string, personId: number, amount: number) {
  await db.runAsync("INSERT OR REPLACE INTO settle_ups (month, person_id, amount) VALUES (?, ?, ?)", month, personId, amount);
}

export async function undoSettled(db: SQLiteDatabase, month: string, personId: number) {
  await db.runAsync("DELETE FROM settle_ups WHERE month = ? AND person_id = ?", month, personId);
}

async function exportAccountPeople(db: SQLiteDatabase, personName: (id: number | null) => string | null) {
  const rows = await getAccountDefaults(db);
  return rows.flatMap((a) => {
    const person = personName(a.defaultPersonId);
    return person ? [{ accountName: a.name, person }] : [];
  });
}

// Puts a backup's people back and returns name -> id for everything that
// points at them. An older backup has none, so this device's people stay.
async function restorePeople(db: SQLiteDatabase, snapshot: DataSnapshot): Promise<(name: string | null) => number | null> {
  if (snapshot.people?.length) {
    await db.runAsync("DELETE FROM people");
    for (const p of snapshot.people) await db.runAsync("INSERT INTO people (name, is_me) VALUES (?, ?)", p.name, p.isMe ? 1 : 0);
  }
  await seedMe(db);
  const byName = new Map((await getPeople(db)).map((p) => [p.name, p.id]));
  const idFor = (name: string | null) => (name === SHARED_NAME ? SHARED : name === null ? null : (byName.get(name) ?? null));
  for (const s of snapshot.settleUps ?? []) {
    const id = idFor(s.person);
    if (id !== null) await markSettled(db, s.month, id, s.amount);
  }
  return idFor;
}
