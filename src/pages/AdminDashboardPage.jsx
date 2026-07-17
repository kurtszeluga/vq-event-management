import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import ConfigurationPanel from '../components/admin/ConfigurationPanel.jsx';
import EventForm from '../components/admin/EventForm.jsx';
import EventList from '../components/admin/EventList.jsx';
import RegistrationPanel from '../components/admin/RegistrationPanel.jsx';
import UserControlPanel from '../components/admin/UserControlPanel.jsx';
import { useAuth } from '../context/useAuth.js';
import { archiveEvent, reactivateEvent, subscribeToAdminEvents } from '../services/eventService.js';
import { subscribeToUsers } from '../services/userService.js';

function AdminDashboardPage() {
  const location = useLocation();
  const { hasPermission, isSuperUser, userProfile } = useAuth();
  const [activeModule, setActiveModule] = useState(location.state?.module || '');
  const [userControlsQuickFilter, setUserControlsQuickFilter] = useState(location.state?.userControlsQuickFilter || 'all');
  const [userControlsMembershipFilter, setUserControlsMembershipFilter] = useState(location.state?.userControlsMembershipFilter || 'All');
  const [editingEvent, setEditingEvent] = useState(null);
  const [draftEventType, setDraftEventType] = useState('');
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [pendingMembershipCount, setPendingMembershipCount] = useState(0);
  const canManageEvents = hasPermission('manageEvents');
  const canAddUsers = hasPermission('addUsers');
  const canReviewMemberships = isSuperUser || hasPermission('manageMembershipStatus');
  const canViewRegistrations = hasPermission('viewRegistrations');

  useEffect(() => {
    if (location.state?.module) {
      setActiveModule(location.state.module);
    }

    if (location.state?.userControlsQuickFilter) {
      setUserControlsQuickFilter(location.state.userControlsQuickFilter);
    }

    if (location.state?.userControlsMembershipFilter) {
      setUserControlsMembershipFilter(location.state.userControlsMembershipFilter);
    }
  }, [location.state]);
  const eventModuleConfig = {
    'events-activities': {
      title: 'Events/Activities',
      filter: 'All',
      showTypeFilters: true,
      createLabel: 'Create New Event/Activity',
      createType: '',
      excludedEventTypes: ['Business Listing', 'For Sale', 'Challenges']
    },
    challenges: {
      title: 'Challenges',
      filter: 'Challenges',
      showTypeFilters: false,
      createLabel: 'Create New Challenge',
      createType: 'Challenges',
      excludedEventTypes: []
    },
    'business-listings': {
      title: 'Business Listings',
      filter: 'Business Listing',
      showTypeFilters: false,
      createLabel: 'Create New Business Listing',
      createType: 'Business Listing',
      excludedEventTypes: []
    },
    'for-sale': {
      title: 'For Sale',
      filter: 'For Sale',
      showTypeFilters: false,
      createLabel: 'Create New For Sale Listing',
      createType: 'For Sale',
      excludedEventTypes: []
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

  useEffect(() => {
    if (!canReviewMemberships) {
      setPendingMembershipCount(0);
      return undefined;
    }

    const unsubscribe = subscribeToUsers(
      (snapshot) => {
        const pendingCount = snapshot.docs
          .map((userDoc) => userDoc.data())
          .filter((user) => user.role !== 'Super User' && user.membershipStatus === 'Pending').length;
        setPendingMembershipCount(pendingCount);
      },
      () => {
        setPendingMembershipCount(0);
      },
      { includeAdminProfiles: false }
    );

    return unsubscribe;
  }, [canReviewMemberships]);

  async function handleDelete(event) {
    const isArchived = event.status === 'Archived';
    const confirmed = window.confirm(
      isArchived ? `Reactivate "${event.title}"?` : `Archive "${event.title}"?`
    );

    if (confirmed) {
      if (isArchived) {
        await reactivateEvent(event.id, userProfile);
      } else {
        await archiveEvent(event.id, userProfile);
      }
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

  function openPendingMembershipReview() {
    setUserControlsQuickFilter('pending-review');
    setUserControlsMembershipFilter('Pending');
    setActiveModule('user-controls');
  }

  return (
    <section className="admin-dashboard-page">
      <PageHeader
        eyebrow="Admin"
        title="Admin Dashboard"
        description="Manage programs, workshops, challenges, business listings, and items for sale."
      />
      <nav className="admin-module-nav admin-public-nav" aria-label="Public site links">
        {canReviewMemberships ? (
          <button
            className={`button-link button-reset ${
              pendingMembershipCount ? 'pending-review-button' : 'secondary-action'
            }`}
            type="button"
            onClick={openPendingMembershipReview}
          >
            Pending Membership Reviews ({pendingMembershipCount})
          </button>
        ) : null}
      </nav>
      <nav className="admin-module-nav" aria-label="Admin dashboard modules">
        {canViewRegistrations ? (
          <button
            className={`button-link button-reset ${
              activeModule === 'registrations' ? '' : 'secondary-action'
            }`}
            type="button"
            onClick={() => setActiveModule('registrations')}
          >
            View Current Registrations
          </button>
        ) : null}
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
                activeModule === 'challenges' ? '' : 'secondary-action'
              }`}
              type="button"
              onClick={() => setActiveModule('challenges')}
            >
              Challenges
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
            System Config
          </button>
        ) : null}
      </nav>
      {canReviewMemberships ? (
        <div className={`status-panel pending-review-panel${pendingMembershipCount ? ' pending-home-card' : ''}`}>
          <span className={`status-dot ${pendingMembershipCount ? 'pending' : 'good'}`} />
          <span>
            {pendingMembershipCount
              ? `${pendingMembershipCount} membership ${pendingMembershipCount === 1 ? 'profile is' : 'profiles are'} waiting for review.`
              : 'No membership profiles are waiting for review right now.'}
          </span>
          <button
            className={`button-link button-reset ${pendingMembershipCount ? '' : 'secondary-action'} compact-action`}
            type="button"
            onClick={openPendingMembershipReview}
          >
            Open Pending Review
          </button>
        </div>
      ) : null}
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
              excludedEventTypes={eventModuleConfig[activeModule].excludedEventTypes}
            />
          </section>
        ) : null}
        {(isSuperUser || canAddUsers) && activeModule === 'user-controls' ? (
          <UserControlPanel
            canManageAdminUsers={isSuperUser}
            currentUserProfile={userProfile}
            initialMembershipFilter={userControlsMembershipFilter}
            initialQuickFilter={userControlsQuickFilter}
          />
        ) : null}
        {canViewRegistrations && activeModule === 'registrations' ? (
          <RegistrationPanel
            canManageEvents={canManageEvents}
            currentUserProfile={userProfile}
          />
        ) : null}
        {isSuperUser && activeModule === 'configuration' ? (
          <ConfigurationPanel currentUserProfile={userProfile} />
        ) : null}
        {!canManageEvents && !isSuperUser && !canAddUsers && !canViewRegistrations ? (
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
