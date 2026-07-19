import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { subscribeToPublishedEvents } from '../services/eventService.js';
import { subscribeToUserRegistrations } from '../services/registrationService.js';
import { formatEventDate, formatTimeRange } from '../utils/eventFormat.js';

function MyRegistrationsPage() {
  const { currentUser, loading } = useAuth();
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [registrationError, setRegistrationError] = useState('');
  const [registrations, setRegistrations] = useState([]);

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
                </tr>
              </thead>
              <tbody>
                {sortedRegistrations.map((registration) => {
                  const event = eventMap.get(registration.eventId);

                  return (
                    <tr key={registration.id}>
                      <td data-label="Event">
                        <strong>{event?.title || registration.eventTitle || registration.eventId || 'Event'}</strong>
                        {event ? (
                          <Link className="table-inline-link" to={`/events/${event.id}?registered=1`}>
                            View Event
                          </Link>
                        ) : null}
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
                    </tr>
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

function formatPaymentSummary(registration) {
  const status = registration.paymentStatus || 'Pending';
  const method = registration.paymentMethod ? ` (${registration.paymentMethod})` : '';
  const amount = Number(registration.amountPaid || 0);
  const amountText = amount > 0 ? ` - ${formatCurrency(amount)}` : '';

  return `${status}${method}${amountText}`;
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
