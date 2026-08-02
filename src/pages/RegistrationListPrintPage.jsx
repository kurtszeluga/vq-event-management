import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import { getEvent } from '../services/eventService.js';
import { getRegistrationsForEvent } from '../services/registrationService.js';
import { formatCurrency, formatEventDate } from '../utils/eventFormat.js';
import { getTotalPaidAmount } from '../utils/registrationFinancials.js';
import { isPaymentPending } from '../utils/registrationEligibility.js';

// Reached via a direct link from the coordinator registration-notification
// email (see api/create-registration.js's sendCoordinatorRegistrationEmail),
// so it fetches its own data by eventId rather than relying on the admin
// SPA's in-memory state, the way ArchivePanel.jsx's print report does.
function RegistrationListPrintPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnModule = location.state?.module || '';
  const { hasPermission } = useAuth();
  const canViewRegistrations = hasPermission('viewRegistrations');
  const [event, setEvent] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [printDocumentHtml, setPrintDocumentHtml] = useState('');
  const printFrameRef = useRef(null);

  useEffect(() => {
    if (!canViewRegistrations) {
      setLoading(false);
      return undefined;
    }

    let active = true;

    async function loadData() {
      try {
        const [eventRecord, registrationRecords] = await Promise.all([
          getEvent(eventId),
          getRegistrationsForEvent(eventId)
        ]);

        if (!active) {
          return;
        }

        setEvent(eventRecord);
        setRegistrations(registrationRecords);
        setError('');
      } catch (loadError) {
        if (active) {
          setError(loadError.message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [canViewRegistrations, eventId]);

  const sortedRegistrations = useMemo(
    () => [...registrations].sort(compareByRegistrationDate),
    [registrations]
  );
  const counts = useMemo(() => sortedRegistrations.reduce(reduceRegistrationCounts, {
    cancelled: 0,
    pendingPayment: 0,
    registered: 0,
    waitlisted: 0
  }), [sortedRegistrations]);
  const totalPaid = useMemo(() => getTotalPaidAmount(sortedRegistrations), [sortedRegistrations]);

  // Printing the live SPA page directly (window.print() on this document)
  // is what made Safari's print dialog take forever - every other report in
  // this app (EventsPage.jsx's event print, ArchivePanel.jsx's archive
  // report, SupplyListViewerPage.jsx's supply list) avoids that by printing
  // a small self-contained HTML document instead, either via a popup or,
  // as here, a hidden same-page iframe. Follow that same proven pattern
  // rather than calling window.print() on this page.
  useEffect(() => {
    if (!printDocumentHtml || !printFrameRef.current) {
      return undefined;
    }

    const frame = printFrameRef.current;

    function handleLoad() {
      const frameWindow = frame.contentWindow;

      if (!frameWindow) {
        setPrintDocumentHtml('');
        return;
      }

      frameWindow.focus();
      window.setTimeout(() => {
        try {
          frameWindow.print();
        } finally {
          setPrintDocumentHtml('');
        }
      }, 150);
    }

    frame.addEventListener('load', handleLoad, { once: true });
    frame.srcdoc = printDocumentHtml;

    return () => {
      frame.removeEventListener('load', handleLoad);
    };
  }, [printDocumentHtml]);

  function handlePrint() {
    setPrintDocumentHtml(buildRegistrationListPrintHtml(event, sortedRegistrations, counts, totalPaid));
  }

  function handleReturn() {
    if (window.opener) {
      window.close();
      return;
    }

    // Reached via an in-app Link from the admin dashboard, which stashes the
    // module it was on (Events/Activities, Registrations, etc.) since that
    // tab is tracked in memory rather than in the URL - a plain history.back()
    // would land on /admin without it, dropping the admin onto the module
    // chooser instead of the list they came from.
    if (returnModule) {
      navigate('/admin', { state: { module: returnModule } });
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    navigate('/admin');
  }

  if (!canViewRegistrations) {
    return (
      <section className="viewer-page">
        <header className="viewer-toolbar">
          <div>
            <p className="viewer-eyebrow">Registration list</p>
            <h1>Permission required</h1>
          </div>
          <div className="viewer-actions">
            <button className="button-link" type="button" onClick={handleReturn}>
              Return
            </button>
          </div>
        </header>
        <p className="form-error">
          Your admin account does not have the View Registrations permission needed to see this list.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="viewer-page">
        <header className="viewer-toolbar">
          <div>
            <p className="viewer-eyebrow">Registration list</p>
            <h1>Loading registrants</h1>
          </div>
        </header>
      </section>
    );
  }

  if (error || !event) {
    return (
      <section className="viewer-page">
        <header className="viewer-toolbar">
          <div>
            <p className="viewer-eyebrow">Registration list</p>
            <h1>Event unavailable</h1>
          </div>
          <div className="viewer-actions">
            <button className="button-link" type="button" onClick={handleReturn}>
              Return
            </button>
          </div>
        </header>
        <p className="form-error">{error || 'This event could not be found.'}</p>
      </section>
    );
  }

  return (
    <section className="viewer-page">
      <header className="viewer-toolbar">
        <div>
          <p className="viewer-eyebrow">Registration list</p>
          <h1>{event.title || event.eventType || 'Event'}</h1>
        </div>
        <div className="viewer-actions">
          <button className="button-link secondary-action" type="button" onClick={handlePrint}>
            Print
          </button>
          <button className="button-link" type="button" onClick={handleReturn}>
            Return
          </button>
        </div>
      </header>
      <article className="registration-admin-card">
        <div className="registration-admin-card-header">
          <div>
            <div className="card-kicker">
              <span>{event.eventType || 'Event / Activity'}</span>
              <strong>
                {sortedRegistrations.length} registrant{sortedRegistrations.length === 1 ? '' : 's'}
              </strong>
            </div>
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
        </div>
        <div className="registration-event-stats">
          <span className={getStatPillClass(counts.registered)}>
            {getCapacitySummary(event, counts.registered)}
          </span>
          <span className={getStatPillClass(counts.registered)}>
            {counts.registered} Registered
          </span>
          <span className={getStatPillClass(counts.waitlisted)}>
            {counts.waitlisted} Waitlisted
          </span>
          <span className={getStatPillClass(counts.pendingPayment)}>
            {counts.pendingPayment} Pending Payment
          </span>
          <span className={getStatPillClass(counts.cancelled)}>
            {counts.cancelled} Cancelled
          </span>
          {event.isPaid ? (
            <span className={getStatPillClass(totalPaid)}>
              {formatCurrency(totalPaid)} Total Paid
            </span>
          ) : null}
        </div>
        <div className="user-table-wrap">
          {sortedRegistrations.length ? (
            <table className="user-table registration-table">
              <thead>
                <tr>
                  <th>Registrant</th>
                  <th>Phone</th>
                  <th>Registered</th>
                  <th>Status</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {sortedRegistrations.map((registration) => (
                  <tr key={registration.id}>
                    <td data-label="Registrant">
                      <strong>{registration.name || 'Registrant'}</strong>
                      <span>{registration.email || 'No email'}</span>
                    </td>
                    <td data-label="Phone">{registration.phone || 'Not Set'}</td>
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
              <p>Nobody has registered for this event yet.</p>
            </div>
          )}
        </div>
      </article>
      <iframe
        aria-hidden="true"
        className="print-helper-frame"
        ref={printFrameRef}
        tabIndex={-1}
        title="Registration list print helper"
      />
    </section>
  );
}

function reduceRegistrationCounts(summary, registration) {
  if (isPaymentPending(registration)) {
    summary.pendingPayment += 1;
  }

  if (registration.status === 'Registered') {
    summary.registered += 1;
  } else if (registration.status === 'Waitlisted') {
    summary.waitlisted += 1;
  } else if (registration.status === 'Cancelled') {
    summary.cancelled += 1;
  }

  return summary;
}

function getCapacitySummary(event, registeredCount) {
  if (event.capacityUnlimited) {
    return 'Unlimited capacity';
  }

  const capacity = Number(event.capacity || 0);

  if (!capacity) {
    return 'Capacity not set';
  }

  const remaining = capacity - registeredCount;

  return remaining < 0
    ? `${registeredCount}/${capacity} filled (over by ${Math.abs(remaining)})`
    : `${registeredCount}/${capacity} filled (${remaining} open)`;
}

function getStatPillClass(count) {
  return Number(count || 0) > 0 ? 'has-count' : 'no-count';
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

// Self-contained print document, matching the pattern already used for the
// public event listing print view (EventsPage.jsx's buildEventPrintHtml) and
// the archive report (ArchivePanel.jsx's buildArchiveReportHtml).
function buildRegistrationListPrintHtml(event, registrations, counts, totalPaid) {
  const title = escapeHtml(event.title || event.eventType || 'Event');
  const eventType = escapeHtml(event.eventType || 'Event / Activity');
  const dateRow = event.eventType === 'Challenges'
    ? ''
    : `<div class="meta-row"><div class="meta-label">Date</div><div>${escapeHtml(formatEventDate(event.date))}</div></div>`;
  const location = escapeHtml(event.location || 'Not Set');
  const registrantCount = `${registrations.length} registrant${registrations.length === 1 ? '' : 's'}`;
  const totalPaidPill = event.isPaid
    ? `<span class="pill">${escapeHtml(formatCurrency(totalPaid))} Total Paid</span>`
    : '';
  const statsPills = [
    getCapacitySummary(event, counts.registered),
    `${counts.registered} Registered`,
    `${counts.waitlisted} Waitlisted`,
    `${counts.pendingPayment} Pending Payment`,
    `${counts.cancelled} Cancelled`
  ].map((text) => `<span class="pill">${escapeHtml(text)}</span>`).join('') + totalPaidPill;
  const rows = registrations.map((registration) => `
    <tr>
      <td>
        <strong>${escapeHtml(registration.name || 'Registrant')}</strong>
        <span>${escapeHtml(registration.email || 'No email')}</span>
      </td>
      <td>${escapeHtml(registration.phone || 'Not Set')}</td>
      <td>${escapeHtml(formatDateTime(registration.registrationDate))}</td>
      <td>${escapeHtml(registration.status || 'Registered')}</td>
      <td>${escapeHtml(formatPaymentSummary(registration))}</td>
    </tr>
  `).join('');
  const tableOrEmpty = registrations.length
    ? `<table>
        <thead>
          <tr><th>Registrant</th><th>Phone</th><th>Registered</th><th>Status</th><th>Payment</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
    : '<p class="empty">Nobody has registered for this event yet.</p>';

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Registration List - ${title}</title>
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
          margin: 18px 0 20px;
        }
        .meta-row {
          display: grid;
          grid-template-columns: 100px 1fr;
          gap: 12px;
        }
        .meta-label {
          font-weight: 800;
        }
        .kicker {
          align-items: center;
          display: flex;
          gap: 10px;
          margin-bottom: 12px;
        }
        .kicker strong {
          font-size: 13px;
        }
        .event-type-pill {
          background: #e9f2ef;
          border: 1px solid #c6dad5;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          padding: 6px 10px;
        }
        .stats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 0 0 24px;
        }
        .pill {
          background: #fff1df;
          border: 1px solid #e5b77f;
          border-radius: 999px;
          color: #8a4b00;
          font-size: 12px;
          font-weight: 800;
          padding: 5px 9px;
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
          vertical-align: top;
        }
        th {
          background: #f6efe9;
          font-weight: 800;
        }
        td span {
          color: #5c6966;
          display: block;
          margin-top: 2px;
        }
        .empty {
          color: #5a6a67;
        }
      </style>
    </head>
    <body>
      <main class="page">
        <p class="eyebrow">Registration list</p>
        <h1>${title}</h1>
        <div class="kicker">
          <span class="event-type-pill">${eventType}</span>
          <strong>${escapeHtml(registrantCount)}</strong>
        </div>
        <div class="meta">
          ${dateRow}
          <div class="meta-row"><div class="meta-label">Location</div><div>${location}</div></div>
        </div>
        <div class="stats">${statsPills}</div>
        ${tableOrEmpty}
      </main>
    </body>
  </html>`;
}

export default RegistrationListPrintPage;
