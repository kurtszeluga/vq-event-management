import { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import ConfigurationPanel from '../components/admin/ConfigurationPanel.jsx';
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
  const [activeModule, setActiveModule] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const canManageEvents = hasPermission('manageEvents');
  const canAddUsers = hasPermission('addUsers');

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

  function handleEditEvent(event) {
    setEditingEvent(event);
    setActiveModule('event-details');
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
            <button
              className={`button-link button-reset ${
                activeModule === 'event-details' ? '' : 'secondary-action'
              }`}
              type="button"
              onClick={() => setActiveModule('event-details')}
            >
              Create New Event/Activity
            </button>
            <button
              className={`button-link button-reset ${
                activeModule === 'existing-events' ? '' : 'secondary-action'
              }`}
              type="button"
              onClick={() => setActiveModule('existing-events')}
            >
              Existing Events
            </button>
          </>
        ) : null}
        {isSuperUser || canAddUsers ? (
          <button
            className={`button-link button-reset ${
              activeModule === 'user-controls' ? '' : 'secondary-action'
            }`}
            type="button"
            onClick={() => setActiveModule('user-controls')}
          >
            User Controls
          </button>
        ) : null}
        {isSuperUser || canAddUsers ? (
          <button
            className={`button-link button-reset ${
              activeModule === 'add-user' ? '' : 'secondary-action'
            }`}
            type="button"
            onClick={() => setActiveModule('add-user')}
          >
            Add User
          </button>
        ) : null}
        {isSuperUser ? (
          <button
            className={`button-link button-reset ${
              activeModule === 'configuration' ? '' : 'secondary-action'
            }`}
            type="button"
            onClick={() => setActiveModule('configuration')}
          >
            Configuration
          </button>
        ) : null}
      </nav>
      {eventsError && canManageEvents ? <p className="form-error">{eventsError}</p> : null}
      <div className="admin-workspace">
        {!activeModule && (canManageEvents || isSuperUser || canAddUsers) ? (
          <div className="empty-state">
            <h2>Select A Module</h2>
            <p>Use the buttons above to open the part of the dashboard you need.</p>
          </div>
        ) : null}
        {canManageEvents && activeModule === 'event-details' ? (
          <div id="event-details-card">
            <EventForm
              editingEvent={editingEvent}
              onCancelEdit={() => setEditingEvent(null)}
              onSaved={() => setEditingEvent(null)}
              userProfile={userProfile}
            />
          </div>
        ) : null}
        {canManageEvents && activeModule === 'existing-events' ? (
          <section className="admin-list-panel" id="existing-events-card">
            <div className="form-section-header">
              <h2>Existing events</h2>
              <span>{events.length} total</span>
            </div>
            <EventList
              events={events}
              loading={loadingEvents}
              onDelete={handleDelete}
              onEdit={handleEditEvent}
            />
          </section>
        ) : null}
        {(isSuperUser || canAddUsers) && ['user-controls', 'add-user'].includes(activeModule) ? (
          <UserControlPanel
            addUserOnOpen={activeModule === 'add-user'}
            canManageAdminUsers={isSuperUser}
            currentUserProfile={userProfile}
            key={activeModule}
          />
        ) : null}
        {isSuperUser && activeModule === 'configuration' ? (
          <ConfigurationPanel currentUserProfile={userProfile} />
        ) : null}
        {!canManageEvents && !isSuperUser && !canAddUsers ? (
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
