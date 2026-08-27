import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The date on an email row.
 *
 * Rows used to render `{ month: 'short', day: 'numeric' }`, which is compact but
 * drops the year — so a message from March 2019 and one from last March both read
 * "Mar 4". In a mailbox where the whole point is sorting out years of accumulated
 * mail, that is the single most important thing the row had to say.
 *
 * Showing the year on every row would pad the column for the recent mail that is
 * most of what anyone looks at, so it appears only when it is not the current year
 * — the convention every mail client uses. Today collapses further to a time,
 * which is what distinguishes this morning's mail from this afternoon's.
 */
export function formatEmailDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (isNaN(time)) return '';

  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // A date in the future is a clock skew or a malformed header rather than a
  // prediction, so it keeps its year instead of being read as "this year".
  if (date.getFullYear() === now.getFullYear() && time <= now.getTime()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
