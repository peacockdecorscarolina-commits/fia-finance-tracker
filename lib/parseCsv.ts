import type { ExtractedTransaction } from "./types";

// Reads a bank's "download transactions" CSV export -- the fallback for
// banks whose PDF statements parseStatement can't read yet. Every bank
// names its columns differently, so columns are found by header name, and
// for header-less exports (Wells Fargo's has none) by what the cells look
// like. Amounts keep the file's own sign; banks disagree on whether a
// purchase is + or -, so the upload screen offers a flip.

// Splits one CSV line into cells, honoring "quoted, cells" and "" escapes.
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

// "2026-01-03", "01/03/2026" or "1/3/26" -> "2026-01-03". US month-first order.
function parseCsvDate(value: string): string | null {
  let y: number, m: number, d: number;
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (us) {
    [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// "$1,234.56", "-12.00", "(12.00)" (accounting-style negative) -> number.
function parseCsvAmount(value: string): number | null {
  let v = value.replace(/[$,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return negative ? -n : n;
}

type Columns = { date: number; description: number; amount: number; debit: number; credit: number };

// Finds the first header cell matching any pattern, trying patterns in order
// so the more specific ones win ("Transaction Date" over "Post Date").
function findColumn(headers: string[], patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const index = headers.findIndex((h) => pattern.test(h));
    if (index !== -1) return index;
  }
  return -1;
}

function findHeaderColumns(headers: string[]): Columns | null {
  const columns = {
    date: findColumn(headers, [/^(transaction |trans\.? )?date$/i, /trans.*date/i, /date/i]),
    description: findColumn(headers, [/description/i, /merchant/i, /payee/i, /^name$/i, /details/i, /memo/i]),
    amount: findColumn(headers, [/^amount$/i, /amount/i]),
    debit: findColumn(headers, [/debit/i, /withdrawal/i]),
    credit: findColumn(headers, [/credit/i, /deposit/i]),
  };
  const hasAmount = columns.amount !== -1 || columns.debit !== -1 || columns.credit !== -1;
  return columns.date !== -1 && columns.description !== -1 && hasAmount ? columns : null;
}

function rowFromColumns(cells: string[], columns: Columns): ExtractedTransaction | null {
  const date = parseCsvDate(cells[columns.date] ?? "");
  const merchant = (cells[columns.description] ?? "").trim();
  let amount: number | null;
  if (columns.amount !== -1) {
    amount = parseCsvAmount(cells[columns.amount] ?? "");
  } else {
    // Separate Debit/Credit columns hold unsigned values; a purchase is a debit.
    const debit = parseCsvAmount(cells[columns.debit] ?? "");
    const credit = parseCsvAmount(cells[columns.credit] ?? "");
    amount = debit === null && credit === null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
  }
  if (!date || !merchant || amount === null || amount === 0) return null;
  return { date, merchant, amount, category: "Other", needsReview: true };
}

// No header row: take the first date-looking cell, the first amount-looking
// cell after it, and the longest remaining text as the description.
function rowFromShape(cells: string[]): ExtractedTransaction | null {
  const dateIndex = cells.findIndex((c) => parseCsvDate(c) !== null);
  if (dateIndex === -1) return null;
  const amountIndex = cells.findIndex((c, i) => i !== dateIndex && parseCsvAmount(c) !== null);
  if (amountIndex === -1) return null;
  const merchant = cells
    .filter((c, i) => i !== dateIndex && i !== amountIndex && /[A-Za-z]/.test(c))
    .sort((a, b) => b.length - a.length)[0];
  const amount = parseCsvAmount(cells[amountIndex])!;
  if (!merchant || amount === 0) return null;
  return { date: parseCsvDate(cells[dateIndex])!, merchant, amount, category: "Other", needsReview: true };
}

export function parseCsv(text: string): ExtractedTransaction[] {
  const rows = text
    .replace(/^﻿/, "") // Excel's byte-order mark
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(splitCsvLine);

  // Some exports put a title or account summary above the real header.
  const headerIndex = rows.slice(0, 10).findIndex((cells) => findHeaderColumns(cells) !== null);
  if (headerIndex !== -1) {
    const columns = findHeaderColumns(rows[headerIndex])!;
    return rows
      .slice(headerIndex + 1)
      .map((cells) => rowFromColumns(cells, columns))
      .filter((t): t is ExtractedTransaction => t !== null);
  }
  return rows.map(rowFromShape).filter((t): t is ExtractedTransaction => t !== null);
}

// A statement is mostly purchases, so if most amounts are positive the file
// probably writes purchases as + (Amex does) -- the app stores them as -.
export function csvLooksReversed(transactions: ExtractedTransaction[]): boolean {
  const positive = transactions.filter((t) => t.amount > 0).length;
  return positive > transactions.length / 2;
}
