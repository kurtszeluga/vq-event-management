import { useEffect, useMemo, useState } from 'react';
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

  function handlePrint() {
    window.focus();
    window.print();
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
              <div>
                <dt>Date</dt>
                <dd>{formatEventDate(event.date)}</dd>
              </div>
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

export default RegistrationListPrintPage;
