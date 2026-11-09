// Who spent what, for people sharing cards or money. One person uploads; each
// transaction belongs to someone, to everyone ("Shared"), or to nobody yet.
// Nothing here shows until a second person is added.

// Stored in place of a person's id: split equally between everyone.
export const SHARED = -1;

export type Person = { id: number; name: string; isMe: boolean };

// Summary looking at one person: their own, plus their part of what's shared.
export type PersonFilter = { personId: number; peopleCount: number };

export const NAME_MAX = 30;
const RESERVED = ["shared", "everyone"];

// What's wrong with a new name, or null when it's fine.
export function personNameProblem(name: string, others: string[]): string | null {
  const clean = name.trim();
  if (!clean) return "Type a name first.";
  if (clean.length > NAME_MAX) return `Keep it under ${NAME_MAX} letters.`;
  if (RESERVED.includes(clean.toLowerCase())) return `"${clean}" is already used by Fia. Pick another name.`;
  if (others.some((o) => o.trim().toLowerCase() === clean.toLowerCase())) return `You already have ${clean}.`;
  return null;
}

// How much of a transaction counts for this person: 1, a share of 1, or 0.
export function shareOf(assigned: number | null, filter: PersonFilter): number {
  if (assigned === filter.personId) return 1;
  if (assigned === SHARED) return 1 / Math.max(1, filter.peopleCount);
  return 0;
}

// Only this person's transactions, with shared ones scaled to their part.
export function forPerson<T extends { amount: number; reimbursed: number | null; personId: number | null }>(
  rows: T[],
  filter: PersonFilter
): T[] {
  const out: T[] = [];
  for (const t of rows) {
    const share = shareOf(t.personId, filter);
    if (share === 0) continue;
    out.push(share === 1 ? t : { ...t, amount: t.amount * share, reimbursed: t.reimbursed === null ? null : t.reimbursed * share });
  }
  return out;
}

// Carries "looking at this person" along when a screen opens another.
export function personParams(person: Person | undefined, peopleCount: number): Record<string, string> {
  if (!person) return {};
  return { person: String(person.id), personName: person.isMe ? "Your" : `${person.name}'s`, peopleCount: String(peopleCount) };
}

export function personFilterFromParams(person: string | undefined, peopleCount: string | undefined): PersonFilter | undefined {
  const personId = Number(person);
  const count = Number(peopleCount);
  return person && Number.isFinite(personId) && count >= 1 ? { personId, peopleCount: count } : undefined;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

export type SettleUp = { owed: number; settled: number; remaining: number; isSettled: boolean };

// What one other person owes for a month: their equal part of the shared
// spending (whoever uploads paid the card), less what's been settled. New
// shared charges after settling show up as a new amount owed.
export function settleUp(sharedTotal: number, peopleCount: number, settled: number): SettleUp {
  const owed = cents(sharedTotal / Math.max(1, peopleCount));
  const remaining = cents(owed - settled);
  return { owed, settled, remaining, isSettled: settled > 0 && Math.abs(remaining) < 0.005 };
}
