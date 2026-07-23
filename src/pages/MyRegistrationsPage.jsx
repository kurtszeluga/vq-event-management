import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { subscribeToPublishedEvents } from '../services/eventService.js';
import {
  subscribeToRegistrationPayments,
  subscribeToUserRegistrations
} from '../services/registrationService.js';
import {
  formatEventDate,
  formatRegistrationDateRange,
  formatTimeRange,
  getRegistrationEndDate,
  getRegistrationStartDate
} from '../utils/eventFormat.js';

function MyRegistrationsPage() {
  const { currentUser, loading } = useAuth();
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [paymentError, setPaymentError] = useState('');
  const [payments, setPayments] = useState([]);
  const [registrationError, setRegistrationError] = useState('');
  const [registrations, setRegistrations] = useState([]);
  const [selectedRegistrationId, setSelectedRegistrationId] = useState('');

  useEffect(() => {
    if (!currentUser?.uid) {
      setLoadingRecords(false);
      setRegistrations([]);
      return undefined;
    }

    setLoadingRecords(true);

    return subscribeToUserRegistrations(
      currentUser.uid,
      (snapshot) => {
        setRegistrations(snapshot.docs.map((registrationDoc) => ({
          id: registrationDoc.id,
          ...registrationDoc.data()
        })));
        setRegistrationError('');
        setLoadingRecords(false);
      },
      (error) => {
        setRegistrationError(error.message);
        setLoadingRecords(false);
      }
    );
  }, [currentUser]);

  useEffect(() => subscribeToPublishedEvents(
    (snapshot) => {
      setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
      setEventsError('');
    },
    (error) => setEventsError(error.message)
  ), []);

  useEffect(() => {
    if (!selectedRegistrationId) {
      setPayments([]);
      setPaymentError('');
      return undefined;
    }

    return subscribeToRegistrationPayments(
      selectedRegistrationId,
      currentUser.uid,
      (snapshot) => {
        setPayments(snapshot.docs
          .map((paymentDoc) => ({ id: paymentDoc.id, ...paymentDoc.data() }))
          .sort((first, second) => getTimestampValue(second.createdDate) - getTimestampValue(first.createdDate)));
        setPaymentError('');
      },
      (error) => {
        setPayments([]);
        setPaymentError(error.message);
      }
    );
  }, [currentUser, selectedRegistrationId]);

  const eventMap = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events]
  );
  const sortedRegistrations = useMemo(
    () => [...registrations].sort((first, second) =>
      getTimestampValue(second.registrationDate) - getTimestampValue(first.registrationDate)
    ),
    [registrations]
  );

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Loading Registrations</h2>
        <p>Checking your account.</p>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: { pathname: '/my-registrations' } }} replace />;
  }

  return (
    <section>
      <PageHeader
        eyebrow="My Account"
        title="My Registrations"
        description="Review your current and past program, workshop, retreat, and challenge registrations."
      />
      <div className="my-registrations-panel">
        {registrationError ? <p className="form-error">{registrationError}</p> : null}
        {eventsError ? <p className="form-error">{eventsError}</p> : null}
        {loadingRecords ? (
          <div className="empty-state compact-empty-state">
            <h2>Loading Registrations</h2>
            <p>Retrieving your registration history.</p>
          </div>
        ) : null}
        {!loadingRecords && !sortedRegistrations.length ? (
          <div className="empty-state compact-empty-state">
            <h2>No registrations found</h2>
            <p>You do not have any registrations recorded for this account yet.</p>
            <Link className="button-link" to="/events">
              Browse Programs & Activities
            </Link>
          </div>
        ) : null}
        {sortedRegistrations.length ? (
          <div className="user-table-wrap">
            <table className="user-table my-registrations-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Registration Status</th>
                  <th>Payment</th>
                  <th>Registered</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRegistrations.map((registration) => {
                  const event = eventMap.get(registration.eventId);
                  const isSelected = selectedRegistrationId === registration.id;
                  const relatedRegistrations = getRelatedRegistrations(registration, sortedRegistrations);

                  return (
                    <Fragment key={registration.id}>
                      <tr className={isSelected ? 'selected-registration-row' : ''} key={registration.id}>
                        <td data-label="Event">
                          <strong>{event?.title || registration.eventTitle || registration.eventId || 'Event'}</strong>
                        </td>
                        <td data-label="Date">
                          {event ? (
                            <>
                              <span>{formatEventDate(event.date)}</span>
                              {event.eventType !== 'Challenges' ? (
                                <span className="table-subtext">{formatTimeRange(event.startTime, event.endTime)}</span>
                              ) : null}
                            </>
                          ) : (
                            <span>Not listed</span>
                          )}
                        </td>
                        <td data-label="Registration Status">{registration.status || 'Registered'}</td>
                        <td data-label="Payment">{formatPaymentSummary(registration)}</td>
                        <td data-label="Registered">{formatDateTime(registration.registrationDate)}</td>
                        <td data-label="Actions">
                          <button
                            className="button-link button-reset compact-action"
                            type="button"
                            onClick={() => setSelectedRegistrationId(isSelected ? '' : registration.id)}
                          >
                            {isSelected ? 'Hide Details' : 'Details'}
                          </button>
                        </td>
                      </tr>
                      {isSelected ? (
                        <tr className="my-registration-detail-row" key={`${registration.id}-details`}>
                          <td colSpan="6">
                            <MyRegistrationDetails
                              event={event}
                              paymentError={paymentError}
                              payments={payments}
                              registration={registration}
                              relatedRegistrations={relatedRegistrations}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MyRegistrationDetails({
  event,
  paymentError,
  payments,
  registration,
  relatedRegistrations
}) {
  return (
    <div className="my-registration-details">
      <div className="my-registration-details-header">
        <div>
          <strong>{event?.title || registration.eventTitle || registration.eventId || 'Registration Details'}</strong>
          <span>{registration.name || registration.email || 'Registrant'}</span>
        </div>
        <button
          className="button-link button-reset secondary-action compact-action"
          type="button"
          onClick={() => printRegistrationDetails({ event, payments, registration, relatedRegistrations })}
        >
          Print Registration
        </button>
      </div>
      <dl className="registration-detail-grid">
        <DetailItem label="Event Type" value={event?.eventType || registration.eventType || 'Event / Activity'} />
        <DetailItem label="Event Date" value={event ? formatEventDate(event.date) : 'Not listed'} />
        {event?.eventType !== 'Challenges' ? (
          <DetailItem label="Event Time" value={event ? formatTimeRange(event.startTime, event.endTime) : 'Not listed'} />
        ) : null}
        <DetailItem label="Location" value={event?.location || registration.eventLocation || 'Not listed'} />
        {event && (getRegistrationStartDate(event) || getRegistrationEndDate(event)) ? (
          <DetailItem label="Registration Open/Closes" value={formatRegistrationDateRange(event)} />
        ) : null}
        <DetailItem label="Registered Date/Time" value={formatDateTime(registration.registrationDate)} />
        <DetailItem label="Registration Status" value={registration.status || 'Registered'} />
        <DetailItem label="Membership When Registered" value={registration.membershipStatusAtRegistration || 'Unknown'} />
        <DetailItem label="Email" value={registration.email || 'No email'} />
        <DetailItem label="Phone" value={registration.phone || 'No phone'} />
        <DetailItem label="Amount Due" value={formatCurrency(getAmountDue(registration))} />
        <DetailItem label="Amount Paid" value={formatCurrency(registration.amountPaid || 0)} />
        <DetailItem label="Payment Status" value={formatPaymentSummary(registration)} />
        <DetailItem label="Payment Updated" value={formatDateTime(registration.paymentUpdatedDate)} />
        <DetailItem label="Payment Note" value={registration.paymentNote || 'None'} />
      </dl>
      {relatedRegistrations.length > 1 ? (
        <div className="registration-history-list">
          <strong>Registration History</strong>
          {relatedRegistrations.map((record) => (
            <div className="registration-history-item" key={record.id}>
              <span>{formatDateTime(record.registrationDate)}</span>
              <span>{record.status || 'Registered'}</span>
              <span>{formatPaymentSummary(record)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <PaymentHistoryList payments={payments} />
      {paymentError ? <p className="form-error">{paymentError}</p> : null}
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="registration-detail-item">
      <dt>{label}</dt>
      <dd>{value || 'Not Set'}</dd>
    </div>
  );
}

function PaymentHistoryList({ payments }) {
  if (!payments.length) {
    return (
      <div className="payment-history-list">
        <strong>Payment History</strong>
        <p className="form-help">No payment history has been recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="payment-history-list">
      <strong>Payment History</strong>
      {payments.map((payment) => (
        <div className="payment-history-item" key={payment.id || payment.paymentId}>
          <div>
            <strong>
              {payment.status || 'Pending'}
              {payment.method ? ` (${payment.method})` : ''}
            </strong>
            <span>{formatDateTime(payment.createdDate)}</span>
          </div>
          <div>
            <span>{formatCurrency(payment.amount || 0)}</span>
            <span>{payment.createdByName || payment.createdByEmail || 'Recorded by system'}</span>
          </div>
          {payment.note ? <p>{payment.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

function formatPaymentSummary(registration) {
  const status = registration.paymentStatus || 'Pending';
  const method = registration.paymentMethod ? ` (${registration.paymentMethod})` : '';
  const amount = Number(registration.amountPaid || 0);
  const amountText = amount > 0 ? ` - ${formatCurrency(amount)}` : '';

  return `${status}${method}${amountText}`;
}

function getAmountDue(registration) {
  return Number(
    registration.amountDue
    ?? registration.paymentAmountDue
    ?? registration.totalDue
    ?? registration.eventCost
    ?? 0
  );
}

function getRelatedRegistrations(registration, registrations) {
  return registrations
    .filter((record) =>
      record.eventId === registration.eventId
      && (
        record.userId && record.userId === registration.userId
        || normalizeEmail(record.email) && normalizeEmail(record.email) === normalizeEmail(registration.email)
      )
    )
    .sort((first, second) => getTimestampValue(second.registrationDate) - getTimestampValue(first.registrationDate));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function printRegistrationDetails({
  event,
  payments,
  registration,
  relatedRegistrations
}) {
  const printWindow = window.open('', '_blank', 'width=900,height=720');

  if (!printWindow) {
    window.print();
    return;
  }

  const eventTitle = event?.title || registration.eventTitle || registration.eventId || 'Registration Details';
  const paymentRows = payments.length
    ? payments.map((payment) => `
        <tr>
          <td>${escapeHtml(formatDateTime(payment.createdDate))}</td>
          <td>${escapeHtml(payment.status || 'Pending')}</td>
          <td>${escapeHtml(payment.method || '')}</td>
          <td>${escapeHtml(formatCurrency(payment.amount || 0))}</td>
          <td>${escapeHtml(payment.note || '')}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5">No payment history has been recorded.</td></tr>';
  const historyRows = relatedRegistrations.length > 1
    ? relatedRegistrations.map((record) => `
        <tr>
          <td>${escapeHtml(formatDateTime(record.registrationDate))}</td>
          <td>${escapeHtml(record.status || 'Registered')}</td>
          <td>${escapeHtml(formatPaymentSummary(record))}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="3">No prior registration history for this event.</td></tr>';

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(eventTitle)} Registration</title>
        <style>
          body { color: #1d2927; font-family: Arial, sans-serif; margin: 32px; }
          h1 { color: #8a2f1f; font-size: 24px; margin: 0 0 6px; }
          h2 { border-bottom: 2px solid #8a2f1f; font-size: 16px; margin: 24px 0 10px; padding-bottom: 5px; }
          dl { display: grid; gap: 8px 18px; grid-template-columns: 180px 1fr; }
          dt { color: #5c6966; font-weight: 700; }
          dd { margin: 0; }
          table { border-collapse: collapse; margin-top: 8px; width: 100%; }
          th, td { border: 1px solid #ded5ca; padding: 8px; text-align: left; }
          th { background: #fff1df; }
          .muted { color: #5c6966; margin: 0 0 20px; }
          @media print { button { display: none; } body { margin: 20px; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Print</button>
        <h1>${escapeHtml(eventTitle)}</h1>
        <p class="muted">Registration summary for ${escapeHtml(registration.name || registration.email || 'Registrant')}</p>
        <h2>Registration Details</h2>
        <dl>
          <dt>Event Type</dt><dd>${escapeHtml(event?.eventType || registration.eventType || 'Event / Activity')}</dd>
          <dt>Event Date</dt><dd>${escapeHtml(event ? formatEventDate(event.date) : 'Not listed')}</dd>
          <dt>Event Time</dt><dd>${escapeHtml(event && event.eventType !== 'Challenges' ? formatTimeRange(event.startTime, event.endTime) : 'Not listed')}</dd>
          <dt>Location</dt><dd>${escapeHtml(event?.location || registration.eventLocation || 'Not listed')}</dd>
          <dt>Registered Date/Time</dt><dd>${escapeHtml(formatDateTime(registration.registrationDate))}</dd>
          <dt>Registration Status</dt><dd>${escapeHtml(registration.status || 'Registered')}</dd>
          <dt>Email</dt><dd>${escapeHtml(registration.email || 'No email')}</dd>
          <dt>Phone</dt><dd>${escapeHtml(registration.phone || 'No phone')}</dd>
          <dt>Amount Due</dt><dd>${escapeHtml(formatCurrency(getAmountDue(registration)))}</dd>
          <dt>Amount Paid</dt><dd>${escapeHtml(formatCurrency(registration.amountPaid || 0))}</dd>
          <dt>Payment Status</dt><dd>${escapeHtml(formatPaymentSummary(registration))}</dd>
          <dt>Payment Note</dt><dd>${escapeHtml(registration.paymentNote || 'None')}</dd>
        </dl>
        <h2>Registration History</h2>
        <table>
          <thead><tr><th>Date</th><th>Status</th><th>Payment</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
        <h2>Payment History</h2>
        <table>
          <thead><tr><th>Date</th><th>Status</th><th>Method</th><th>Amount</th><th>Note</th></tr></thead>
          <tbody>${paymentRows}</tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString(undefined, {
    currency: 'USD',
    style: 'currency'
  });
}

function formatDateTime(value) {
  if (!value) {
    return 'Not Set';
  }

  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not Set' : date.toLocaleString();
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

export default MyRegistrationsPage;
