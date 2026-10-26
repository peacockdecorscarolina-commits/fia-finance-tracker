import type { Transaction } from "./types";

function csvField(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function transactionsToCsv(transactions: Transaction[]): string {
  const header = ["Date", "Merchant", "Amount", "Account", "Category", "Ignored", "Note", "Tags"];
  const rows = transactions.map((t) => [
    t.date,
    csvField(t.merchant),
    t.amount.toFixed(2),
    csvField(t.accountName),
    csvField(t.categoryName),
    t.ignored ? "Yes" : "No",
    csvField(t.note ?? ""),
    csvField(t.tags.map((tag) => `#${tag}`).join(" ")),
  ]);
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// Web-only -- this app only ships as a web export, so a plain anchor-click
// download is the simplest cross-browser way to save a file.
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
