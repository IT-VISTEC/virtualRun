/** Tiny CSV export helpers (admin). Excel-friendly: UTF-8 BOM, CRLF, quoted cells. */

type Cell = string | number | boolean | null | undefined;

function cell(v: Cell): string {
  if (v == null) return '';
  let s = String(v);
  // Formula injection guard: a name like "=HYPERLINK(...)" must not run in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => Cell }[]): string {
  const head = columns.map((c) => cell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(','));
  return [head, ...body].join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
