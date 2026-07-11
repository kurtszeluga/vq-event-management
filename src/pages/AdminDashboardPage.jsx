import { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import EventForm from '../components/admin/EventForm.jsx';
import EventList from '../components/admin/EventList.jsx';
import UserControlPanel from '../components/admin/UserControlPanel.jsx';
import { useAuth } from '../context/useAuth.js';
import {
  deleteEvent,
  subscribeToAdminEvents
} from '../services/eventService.js';

function AdminDashboardPage() {
  const { hasPermission, isSuperUser, userProfile } = useAuth();
  const [editingEvent, setEditingEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const canManageEvents = hasPermission('manageEvents');

  useEffect(() => {
    if (!canManageEvents) {
      setLoadingEvents(false);
      return undefined;
    }

    const unsubscribe = subscribeToAdminEvents(
      (snapshot) => {
        setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
        setEventsError('');
        setLoadingEvents(false);
      },
      (error) => {
        setEventsError(error.message);
        setLoadingEvents(false);
      }
    );

    return unsubscribe;
  }, [canManageEvents]);

  async function handleDelete(event) {
    const confirmed = window.confirm(`Delete "${event.title}"?`);

    if (confirmed) {
      await deleteEvent(event.id, userProfile);
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Admin"
        title="Event/Activities Management Dashboard"
        description="Create classes, workshops, retreats, lectures, challenges, business listings, and sale listings."
      />
      <div className="status-panel">
        <span className="status-dot good" />
        <span>
          Signed in as <strong>{userProfile?.name || userProfile?.email}</strong>.
        </span>
      </div>
      <nav className="admin-module-nav" aria-label="Admin dashboard modules">
        {canManageEvents ? (
          <>
            <a className="button-link" href="#event-details-card">
              Event/Activity Details
            </a>
            <a className="button-link secondary-action" href="#existing-events-card">
              Existing Events
            </a>
          </>
        ) : null}
        {isSuperUser ? (
          <a className="button-link secondary-action" href="#user-controls-card">
            User Controls
          </a>
        ) : null}
      </nav>
      {eventsError && canManageEvents ? <p className="form-error">{eventsError}</p> : null}
      <div className="admin-workspace">
        {canManageEvents ? (
          <>
            <div id="event-details-card">
              <EventForm
                editingEvent={editingEvent}
                onCancelEdit={() => setEditingEvent(null)}
                onSaved={() => setEditingEvent(null)}
                userProfile={userProfile}
              />
            </div>
            <section className="admin-list-panel" id="existing-events-card">
              <div className="form-section-header">
                <h2>Existing events</h2>
                <span>{events.length} total</span>
              </div>
              <EventList
                events={events}
                loading={loadingEvents}
                onDelete={handleDelete}
                onEdit={setEditingEvent}
              />
            </section>
          </>
        ) : null}
        {isSuperUser ? (
          <UserControlPanel currentUserProfile={userProfile} />
        ) : null}
        {!canManageEvents && !isSuperUser ? (
          <div className="empty-state">
            <h2>No Admin Modules Enabled</h2>
            <p>Ask the Super User to update this profile's permissions.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default AdminDashboardPage;
