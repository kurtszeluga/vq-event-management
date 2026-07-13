import { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import ConfigurationPanel from '../components/admin/ConfigurationPanel.jsx';
import EventForm from '../components/admin/EventForm.jsx';
import EventList from '../components/admin/EventList.jsx';
import UserControlPanel from '../components/admin/UserControlPanel.jsx';
import { useAuth } from '../context/useAuth.js';
import {
  archiveEvent,
  deleteEvent,
  subscribeToAdminEvents
} from '../services/eventService.js';

function AdminDashboardPage() {
  const { hasPermission, isSuperUser, userProfile } = useAuth();
  const [activeModule, setActiveModule] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const [draftEventType, setDraftEventType] = useState('');
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const canManageEvents = hasPermission('manageEvents');
  const canAddUsers = hasPermission('addUsers');
  const eventModuleConfig = {
    'events-activities': {
      title: 'Events/Activities',
      filter: 'All',
      showTypeFilters: true,
      createLabel: 'Create New Event/Activity',
      createType: ''
    },
    'business-listings': {
      title: 'Business Listings',
      filter: 'Business Listing',
      showTypeFilters: false,
      createLabel: 'Create New Business Listing',
      createType: 'Business Listing'
    },
    'for-sale': {
      title: 'For Sale',
      filter: 'For Sale',
      showTypeFilters: false,
      createLabel: 'Create New For Sale Listing',
      createType: 'For Sale'
    }
  };

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
    if (isSuperUser) {
      const confirmed = window.confirm(`Delete "${event.title}"?`);

      if (confirmed) {
        await deleteEvent(event.id, userProfile);
      }
      return;
    }

    const confirmed = window.confirm(`Archive "${event.title}"?`);

    if (confirmed) {
      await archiveEvent(event.id, userProfile);
    }
  }

  function handleEditEvent(event) {
    setDraftEventType('');
    setEditingEvent(event);
    setActiveModule('event-details');
  }

  function handleStartCreate(initialEventType = '') {
    setEditingEvent(null);
    setDraftEventType(initialEventType);
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
                activeModule === 'events-activities' ? '' : 'secondary-action'
              }`}
              type="button"
              onClick={() => setActiveModule('events-activities')}
            >
              Events/Activities
            </button>
            <button
              className={`button-link button-reset ${
                activeModule === 'business-listings' ? '' : 'secondary-action'
              }`}
              type="button"
              onClick={() => setActiveModule('business-listings')}
            >
              Business Listings
            </button>
            <button
              className={`button-link button-reset ${
                activeModule === 'for-sale' ? '' : 'secondary-action'
              }`}
              type="button"
              onClick={() => setActiveModule('for-sale')}
            >
              For Sale
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
              initialEventType={draftEventType}
              onCancelEdit={() => {
                setEditingEvent(null);
                setDraftEventType('');
              }}
              onSaved={() => {
                setEditingEvent(null);
                setDraftEventType('');
              }}
              userProfile={userProfile}
            />
          </div>
        ) : null}
        {canManageEvents && activeModule in eventModuleConfig ? (
          <section className="admin-list-panel" id="existing-events-card">
            <div className="form-section-header form-section-header-stacked">
              <div className="form-section-header-top">
                <h2>{eventModuleConfig[activeModule].title}</h2>
                <span>{events.length} total</span>
              </div>
              {eventModuleConfig[activeModule].createLabel ? (
                <div className="admin-list-panel-actions">
                  <button
                    className="button-link button-reset secondary-action"
                    type="button"
                    onClick={() => handleStartCreate(eventModuleConfig[activeModule].createType)}
                  >
                    {eventModuleConfig[activeModule].createLabel}
                  </button>
                </div>
              ) : null}
            </div>
            <EventList
              events={events}
              loading={loadingEvents}
              onDelete={handleDelete}
              onEdit={handleEditEvent}
              isSuperUser={isSuperUser}
              defaultEventTypeFilter={eventModuleConfig[activeModule].filter}
              showTypeFilters={eventModuleConfig[activeModule].showTypeFilters}
            />
          </section>
        ) : null}
        {(isSuperUser || canAddUsers) && activeModule === 'user-controls' ? (
          <UserControlPanel
            canManageAdminUsers={isSuperUser}
            currentUserProfile={userProfile}
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
