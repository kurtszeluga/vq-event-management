// CSV for the coordinator's attendee list. Same columns the printed table
// shows, with the registrant's name and email split apart - they share one cell
// on paper for layout reasons, but as separate columns they sort and filter in
// a spreadsheet.
export const REGISTRATION_CSV_HEADERS = [
  'Name',
  'Email',
  'Phone',
  'Registered',
  'Status',
  'Payment',
  'Amount'
];

// A spreadsheet treats a leading =, +, - or @ as the start of a formula, so a
// name or note beginning with one would be executed on open rather than read.
// This file is built to be opened in Excel or Google Sheets, so the value is
// prefixed with an apostrophe to keep it text. Tab and carriage return are here
// because some spreadsheets strip them and re-expose the character behind.
function neutralizeFormula(value) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = neutralizeFormula(text);

  // Always quoted rather than only when it contains a comma: names carry commas
  // and quotes often enough that conditional quoting is the fragile choice.
  return `"${safe.replaceAll('"', '""')}"`;
}

// Plain number, not a formatted currency string, so the column sums in a
// spreadsheet instead of arriving as text. Blank rather than 0 when nothing was
// paid, so an empty cell reads as "nothing recorded" rather than "paid nought".
function formatAmount(registration) {
  const amount = Number(registration?.amountPaid || 0);

  return amount > 0 ? amount.toFixed(2) : '';
}

export function buildRegistrationCsvRow(registration = {}, formatters = {}) {
  const { formatDateTime = (value) => String(value ?? ''), formatPayment = () => '' } = formatters;

  return [
    registration.name || '',
    registration.email || '',
    registration.phone || '',
    registration.registrationDate ? formatDateTime(registration.registrationDate) : '',
    registration.status || 'Registered',
    formatPayment(registration),
    formatAmount(registration)
  ];
}

export function buildRegistrationCsv(registrations = [], formatters = {}) {
  const rows = registrations.map((registration) =>
    buildRegistrationCsvRow(registration, formatters));

  // CRLF: Excel needs it, and every other reader accepts it.
  return [REGISTRATION_CSV_HEADERS, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\r\n');
}

// Kept out of buildRegistrationCsv so the string can be tested without a DOM.
export function downloadCsv(filename, csv) {
  // The BOM is what makes Excel read the file as UTF-8; without it an accented
  // name arrives mangled.
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.download = filename;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Safe for a filename on every platform, and still recognisable in a download
// folder full of them.
export function buildCsvFilename(eventTitle, eventDate) {
  const title = String(eventTitle || 'event')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase() || 'event';
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(eventDate || ''))
    ? String(eventDate).slice(0, 10)
    : '';

  return `registrations-${title}${date ? `-${date}` : ''}.csv`;
}
