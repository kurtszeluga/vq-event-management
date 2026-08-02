import { useMemo, useState } from 'react';
import { formatCurrency, formatEventDate } from '../../utils/eventFormat.js';
import { getTotalPaidAmount } from '../../utils/registrationFinancials.js';

// Registrations are never deleted when an event archives (see
// PROJECT_UPGRADE.md's 2026-07-26 archive-cascade entry), so this panel is a
// read-only historical view built from data AdminDashboardPage already
// subscribes to - it does not open its own Firestore subscription. Editing a
// payment or cancelling a registration still belongs to the regular
// Registrations tab; un-archive first if a correction is genuinely needed.
function ArchivePanel({
  canViewRegistrations = false,
  events = [],
  loading = false,
  onReactivate,
  registrationsByEventId = {}
}) {
  const [selectedEventId, setSelectedEventId] = useState('');

  const archivedEvents = useMemo(
    () => events
      .filter((event) => event.status === 'Archived')
      .sort((first, second) => getEventDateValue(second) - getEventDateValue(first)),
    [events]
  );
  const selectedEvent = archivedEvents.find((event) => event.id === selectedEventId) || null;
  const selectedRegistrations = useMemo(
    () => [...(registrationsByEventId[selectedEventId] || [])].sort(compareByRegistrationDate),
    [registrationsByEventId, selectedEventId]
  );
  const selectedTotalPaid = useMemo(
    () => getTotalPaidAmount(selectedRegistrations),
    [selectedRegistrations]
  );

  function handleSelectEvent(eventId) {
    setSelectedEventId(eventId);
  }

  function handleBackToArchive() {
    setSelectedEventId('');
  }

  function handlePrintReport() {
    if (!selectedEvent) {
      return;
    }

    const popup = window.open('', 'vq-archive-report', 'popup,width=1000,height=800');

    if (!popup) {
      return;
    }

    const html = buildArchiveReportHtml(selectedEvent, selectedRegistrations, selectedTotalPaid);

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  }

  if (loading) {
    return (
      <section className="admin-list-panel">
        <div className="empty-state">
          <h2>Loading Archive</h2>
          <p>Retrieving archived events from Firestore.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-list-panel" id="archive-card">
      <div className="form-section-header form-section-header-stacked">
        <div className="form-section-header-top">
          <h2>Archive</h2>
          <span>
            {selectedEvent
              ? `${selectedRegistrations.length} registration record${selectedRegistrations.length === 1 ? '' : 's'}`
              : `${archivedEvents.length} archived event${archivedEvents.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>
      {!archivedEvents.length ? (
        <div className="empty-state compact-empty-state">
          <h2>No archived events</h2>
          <p>Events archived from Manage/Edit will appear here, along with their full registration history.</p>
        </div>
      ) : null}
      {archivedEvents.length && !selectedEvent ? (
        <div className="registration-admin-list">
          {archivedEvents.map((event) => {
            const eventRegistrations = registrationsByEventId[event.id] || [];
            const totalPaid = getTotalPaidAmount(eventRegistrations);

            return (
              <article className="registration-event-card" key={event.id}>
                <div className="registration-event-stats">
                  <span className="status-pill neutral">Archived</span>
                  <span className="event-registration-pill">
                    <strong>{eventRegistrations.length}</strong>
                    {eventRegistrations.length === 1 ? 'Registration Record' : 'Registration Records'}
                  </span>
                  {canViewRegistrations && event.isPaid ? (
                    <span className="event-registration-pill active">
                      <strong>{formatCurrency(totalPaid)}</strong>
                      Total Paid
                    </span>
                  ) : null}
                </div>
                <div className="registration-event-card-main">
                  <div className="card-kicker">
                    <span>{event.eventType || 'Event / Activity'}</span>
                  </div>
                  <h3>{event.title || 'Untitled Event'}</h3>
                  <dl className="registration-event-info">
                    {event.eventType !== 'Challenges' ? (
                      <div>
                        <dt>Date</dt>
                        <dd>{formatEventDate(event.date)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Location</dt>
                      <dd>{event.location || 'Not Set'}</dd>
                    </div>
                  </dl>
                </div>
                <div className="registration-event-card-actions">
                  {canViewRegistrations ? (
                    <button
                      className="button-link button-reset compact-action registration-event-edit-button"
                      type="button"
                      onClick={() => handleSelectEvent(event.id)}
                    >
                      View Registrants
                    </button>
                  ) : null}
                  <button
                    className="button-link button-reset secondary-action compact-action"
                    type="button"
                    onClick={() => onReactivate?.(event)}
                  >
                    Un-archive
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {selectedEvent ? (
        <article className="registration-admin-card">
          <div className="registration-admin-card-header">
            <div>
              <div className="card-kicker">
                <span>{selectedEvent.eventType || 'Event / Activity'}</span>
                <strong>
                  {selectedRegistrations.length} registrant{selectedRegistrations.length === 1 ? '' : 's'}
                </strong>
              </div>
              <h3>{selectedEvent.title || 'Untitled Event'}</h3>
              <dl className="registration-event-info">
                <div>
                  <dt>Date</dt>
                  <dd>{formatEventDate(selectedEvent.date)}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{selectedEvent.location || 'Not Set'}</dd>
                </div>
                {selectedEvent.isPaid ? (
                  <div>
                    <dt>Total Paid</dt>
                    <dd>{formatCurrency(selectedTotalPaid)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
          <div className="user-table-wrap">
            {selectedRegistrations.length ? (
              <table className="user-table registration-table">
                <thead>
                  <tr>
                    <th>Registrant</th>
                    <th>Registered</th>
                    <th>Status</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRegistrations.map((registration) => (
                    <tr key={registration.id}>
                      <td data-label="Registrant">
                        <strong>{registration.name || 'Registrant'}</strong>
                        <span>{registration.email || 'No email'}</span>
                      </td>
                      <td data-label="Registered">{formatDateTime(registration.registrationDate)}</td>
                      <td data-label="Status">{registration.status || 'Registered'}</td>
                      <td data-label="Payment">{formatPaymentSummary(registration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state compact-empty-state">
                <h2>No registration records</h2>
                <p>This archived event has no registration history.</p>
              </div>
            )}
          </div>
          <div className="form-actions registration-detail-footer-actions">
            {canViewRegistrations ? (
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={handlePrintReport}
              >
                Print Report
              </button>
            ) : null}
            <button
              className="button-link button-reset secondary-action"
              type="button"
              onClick={() => onReactivate?.(selectedEvent)}
            >
              Un-archive
            </button>
            <button
              className="button-link button-reset"
              type="button"
              onClick={handleBackToArchive}
            >
              Back To Archive
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

function getEventDateValue(event) {
  const parsed = Date.parse(event?.date || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareByRegistrationDate(first, second) {
  return getTimestampValue(second?.registrationDate) - getTimestampValue(first?.registrationDate);
}

function getTimestampValue(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatDateTime(value) {
  if (!value) {
    return 'Not Set';
  }

  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not Set' : date.toLocaleString();
}

function normalizePaymentMethod(method) {
  return method === 'None' ? '' : method || '';
}

function formatPaymentSummary(registration) {
  if (!registration) {
    return 'Pending';
  }

  const status = registration.paymentStatus || 'Pending';
  const method = normalizePaymentMethod(registration.paymentMethod);

  return method ? `${status} (${method})` : status;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Self-contained print window, matching the pattern already used for the
// public event listing print view (EventsPage.jsx's buildEventPrintHtml) -
// no dedicated route or re-fetch, since the caller already has the live
// registration data on hand.
function buildArchiveReportHtml(event, registrations, totalPaid) {
  const title = escapeHtml(event.title || 'Untitled Event');
  const eventType = escapeHtml(event.eventType || 'Event / Activity');
  const dateRow = event.eventType === 'Challenges'
    ? ''
    : `<div class="meta-row"><div class="meta-label">Date</div><div>${escapeHtml(formatEventDate(event.date))}</div></div>`;
  const location = escapeHtml(event.location || 'Not Set');
  const totalPaidRow = event.isPaid
    ? `<div class="meta-row"><div class="meta-label">Total Paid</div><div>${escapeHtml(formatCurrency(totalPaid))}</div></div>`
    : '';
  const rows = registrations.map((registration) => `
    <tr>
      <td>${escapeHtml(registration.name || 'Registrant')}</td>
      <td>${escapeHtml(registration.email || 'No email')}</td>
      <td>${escapeHtml(formatDateTime(registration.registrationDate))}</td>
      <td>${escapeHtml(registration.status || 'Registered')}</td>
      <td>${escapeHtml(formatPaymentSummary(registration))}</td>
    </tr>
  `).join('');
  const tableOrEmpty = registrations.length
    ? `<table>
        <thead>
          <tr><th>Registrant</th><th>Email</th><th>Registered</th><th>Status</th><th>Payment</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
    : '<p class="empty">This archived event has no registration history.</p>';

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Archive Report - ${title}</title>
      <style>
        :root {
          color: #1d2927;
          background: #ffffff;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        html, body {
          margin: 0;
          padding: 0;
        }
        body {
          padding: 32px 28px 40px;
        }
        .page {
          margin: 0 auto;
          max-width: 900px;
        }
        .topbar {
          align-items: flex-start;
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 22px;
        }
        .eyebrow {
          color: #9a4d2f;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          margin: 0 0 8px;
          text-transform: uppercase;
        }
        h1 {
          font-size: 26px;
          line-height: 1.15;
          margin: 0;
        }
        .meta {
          display: grid;
          gap: 10px;
          margin: 18px 0 24px;
        }
        .meta-row {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 12px;
        }
        .meta-label {
          font-weight: 800;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          background: #e9f2ef;
          border: 1px solid #c6dad5;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          padding: 6px 10px;
          margin-bottom: 12px;
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        th, td {
          border-bottom: 1px solid #ded5ca;
          font-size: 13px;
          padding: 8px 10px;
          text-align: left;
        }
        th {
          background: #f6efe9;
          font-weight: 800;
        }
        .empty {
          color: #5a6a67;
        }
        .actions {
          display: inline-flex;
          gap: 8px;
          margin-top: 4px;
        }
        button {
          appearance: none;
          border: 1px solid #225c56;
          border-radius: 8px;
          background: #225c56;
          color: #fff;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
          padding: 10px 14px;
        }
        button.secondary {
          background: #fff;
          color: #225c56;
        }
        @media print {
          body {
            padding: 0;
          }
          .actions {
            display: none;
          }
        }
      </style>
    </head>
    <body onload="window.setTimeout(function () { window.print(); }, 150)">
      <main class="page">
        <div class="topbar">
          <div>
            <p class="eyebrow">Archive Report</p>
            <h1>${title}</h1>
          </div>
          <div class="actions">
            <button type="button" onclick="window.print()">Print</button>
            <button type="button" class="secondary" onclick="window.close()">Close</button>
          </div>
        </div>
        <div class="pill">${eventType}</div>
        <div class="meta">
          ${dateRow}
          <div class="meta-row"><div class="meta-label">Location</div><div>${location}</div></div>
          <div class="meta-row"><div class="meta-label">Registrants</div><div>${registrations.length}</div></div>
          ${totalPaidRow}
        </div>
        ${tableOrEmpty}
      </main>
    </body>
  </html>`;
}

export default ArchivePanel;
