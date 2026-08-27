/**
 * CSV building and download helpers.
 *
 * The previous inline exporter concatenated raw values straight into the file, so a
 * single comma or quote in a subject line silently shifted every following column.
 * Everything goes through escapeCell here instead.
 */

/** RFC 4180 escaping: quote the field and double any embedded quotes. */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str === '') return '';
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  // Leading BOM so Excel opens UTF-8 subjects (emoji, accents) correctly.
  return '﻿' + lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function timestampedFilename(slug: string): string {
  return `mailflow_${slug}_${new Date().toISOString().split('T')[0]}.csv`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const MESSAGE_HEADERS = [
  'Date', 'From Name', 'From Email', 'Domain', 'Subject',
  'Snippet', 'Size (bytes)', 'Size', 'Unread', 'Labels', 'Thread ID',
];

/**
 * Column layout shared by every message-level export.
 *
 * "Has Attachment" is gone. It was derived from a `HAS_ATTACHMENT` label id, which
 * Gmail does not issue — the column was blank on every row of every export,
 * including the attachments export, where it read as "no attachments found". The
 * metadata these rows are built from carries no attachment flag, so the column had
 * nothing behind it and an empty column is worse than no column.
 */
export function messageToRow(email: any, senderDetails: { displayName: string; emailAddr: string; rootDomain: string }): unknown[] {
  const labels: string[] = email.labelIds || [];
  const size = email.sizeEstimate || 0;
  const date = email.date instanceof Date ? email.date : new Date(email.date);
  return [
    isNaN(date.getTime()) ? '' : date.toISOString(),
    senderDetails.displayName,
    senderDetails.emailAddr,
    senderDetails.rootDomain,
    email.subject || '(No Subject)',
    email.snippet || '',
    size,
    formatBytes(size),
    labels.includes('UNREAD') ? 'Yes' : 'No',
    labels.join(' | '),
    // Thread-scanned rows set `id` to the thread; message-scanned rows set it to the
    // message and carry `threadId` separately. This column is headed "Thread ID", so
    // it has to prefer the latter or it silently mixes two kinds of identifier.
    email.threadId || email.id || '',
  ];
}
