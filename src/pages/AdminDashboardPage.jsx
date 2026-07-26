import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import PageHeader from '../components/PageHeader.jsx';
import ArchivePanel from '../components/admin/ArchivePanel.jsx';
import ConfigurationPanel from '../components/admin/ConfigurationPanel.jsx';
import EventForm from '../components/admin/EventForm.jsx';
import EventList from '../components/admin/EventList.jsx';
import PaymentReconciliationPanel from '../components/admin/PaymentReconciliationPanel.jsx';
import RegistrationPanel from '../components/admin/RegistrationPanel.jsx';
import UserControlPanel from '../components/admin/UserControlPanel.jsx';
import { useAuth } from '../context/useAuth.js';
import { archiveEvent, reactivateEvent, subscribeToAdminEvents } from '../services/eventService.js';
import {
  loadPublicRegistrationCounts,
  subscribeToRegistrations,
  subscribeToSquareWebhookEvents
} from '../services/registrationService.js';
import { subscribeToUsers } from '../services/userService.js';
import { isCashCheckAwaitingCollection } from '../utils/registrationEligibility.js';
import { getTotalPaidAmount } from '../utils/registrationFinancials.js';

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
  const [eventRegistrationCounts, setEventRegistrationCounts] = useState({});
  const [lastSavedEventId, setLastSavedEventId] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [pendingMembershipCount, setPendingMembershipCount] = useState(0);
  const [squareNeedsReviewCount, setSquareNeedsReviewCount] = useState(0);
  const [registrations, setRegistrations] = useState([]);
  const [pendingArchiveEvent, setPendingArchiveEvent] = useState(null);
  const [pendingArchiveEventId, setPendingArchiveEventId] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [moduleNavOpen, setModuleNavOpen] = useState(false);
  const canManageEvents = hasPermission('manageEvents');
  const canAddUsers = hasPermission('addUsers');
  const canRegisterOthers = isSuperUser || hasPermission('registerOthers');
  const canReviewMemberships = isSuperUser || hasPermission('manageMembershipStatus');
  const canViewRegistrations = hasPermission('viewRegistrations');
  // Single source of truth for the Manage/Edit row: the desktop buttons, the
  // collapsed mobile toggle's label, and the mobile list all read from this.
  const manageModules = [
    { id: 'registrations', label: 'Registrations', visible: canViewRegistrations },
    { id: 'payment-review', label: 'Payment Review', visible: canViewRegistrations },
    { id: 'events-activities', label: 'Events/Activities', visible: canManageEvents },
    { id: 'challenges', label: 'Challenges', visible: canManageEvents },
    { id: 'business-listings', label: 'Business Listings', visible: canManageEvents },
    { id: 'for-sale', label: 'For Sale', visible: canManageEvents },
    { id: 'archive', label: 'Archive', visible: canManageEvents },
    { id: 'user-controls', label: 'User Controls', visible: isSuperUser || canAddUsers },
    { id: 'configuration', label: 'Setup / System Config', visible: isSuperUser }
  ].filter((module) => module.visible);
  const activeManageLabel =
    manageModules.find((module) => module.id === activeModule)?.label || 'Choose a section';

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
    if (!canManageEvents || !events.length) {
      setEventRegistrationCounts({});
      return undefined;
    }

    const eventIds = events.map((event) => event.id).filter(Boolean);
    let active = true;

    function refreshCounts() {
      loadPublicRegistrationCounts(eventIds)
        .then((counts) => {
          if (active) {
            setEventRegistrationCounts(counts);
          }
        })
        .catch(() => {
          if (active) {
            setEventRegistrationCounts({});
          }
        });
    }

    refreshCounts();
    const intervalId = window.setInterval(refreshCounts, 15000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [canManageEvents, events]);

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

  useEffect(() => {
    if (!canViewRegistrations) {
      setSquareNeedsReviewCount(0);
      return undefined;
    }

    const unsubscribe = subscribeToSquareWebhookEvents(
      (snapshot) => {
        setSquareNeedsReviewCount(snapshot.docs
          .map((eventDoc) => eventDoc.data())
          .filter((event) => String(event.reconciliationStatus || '').includes('Needs Review')).length);
      },
      () => {
        setSquareNeedsReviewCount(0);
      }
    );

    return unsubscribe;
  }, [canViewRegistrations]);

  // Single source for every registration-derived figure on this page: the
  // Payment Review badge's cash/check half, the Archive tab's registrant
  // lists, and each event card's Total Paid stat. One subscription instead of
  // one per consumer, since they all read the same collection.
  useEffect(() => {
    if (!canViewRegistrations) {
      setRegistrations([]);
      return undefined;
    }

    const unsubscribe = subscribeToRegistrations(
      (snapshot) => {
        setRegistrations(snapshot.docs.map((registrationDoc) => ({
          id: registrationDoc.id,
          ...registrationDoc.data()
        })));
      },
      () => {
        setRegistrations([]);
      }
    );

    return unsubscribe;
  }, [canViewRegistrations]);

  const cashCheckAwaitingCount = useMemo(
    () => registrations.filter(isCashCheckAwaitingCollection).length,
    [registrations]
  );
  const paymentReviewCount = squareNeedsReviewCount + cashCheckAwaitingCount;
  // A refusal (e.g. pending payments) can only fail again on retry, so the
  // dialog offers no confirm action once one has occurred - only a way out.
  const isArchiveBlocked = Boolean(archiveError);
  const registrationsByEventId = useMemo(() => {
    const grouped = {};

    registrations.forEach((registration) => {
      if (!registration.eventId) {
        return;
      }

      (grouped[registration.eventId] ||= []).push(registration);
    });

    return grouped;
  }, [registrations]);
  const totalPaidByEventId = useMemo(() => {
    const totals = {};

    Object.entries(registrationsByEventId).forEach(([eventId, eventRegistrations]) => {
      totals[eventId] = getTotalPaidAmount(eventRegistrations);
    });

    return totals;
  }, [registrationsByEventId]);

  async function handleDelete(event) {
    setArchiveError('');
    setPendingArchiveEvent(event);
  }

  async function handleConfirmArchiveEvent() {
    if (!pendingArchiveEvent) {
      return;
    }

    const isArchived = pendingArchiveEvent.status === 'Archived';
    setArchiveError('');
    setPendingArchiveEventId(pendingArchiveEvent.id);

    try {
      if (isArchived) {
        await reactivateEvent(pendingArchiveEvent.id, userProfile);
      } else {
        await archiveEvent(pendingArchiveEvent.id, userProfile);
      }
      setPendingArchiveEvent(null);
    } catch (error) {
      setArchiveError(error.message || 'This event could not be archived.');
    } finally {
      setPendingArchiveEventId('');
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

  function getEventModuleForType(eventType) {
    if (eventType === 'Challenges') {
      return 'challenges';
    }

    if (eventType === 'Business Listing') {
      return 'business-listings';
    }

    if (eventType === 'For Sale') {
      return 'for-sale';
    }

    return 'events-activities';
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
      {canReviewMemberships || canViewRegistrations ? (
        <nav className="admin-alert-strip" aria-label="Needs attention">
          {canReviewMemberships ? (
            <button
              className={`admin-alert-chip${pendingMembershipCount ? ' pending' : ''}`}
              type="button"
              onClick={openPendingMembershipReview}
            >
              <span className="admin-alert-dot" aria-hidden="true" />
              {pendingMembershipCount
                ? `${pendingMembershipCount} membership review${pendingMembershipCount === 1 ? '' : 's'} pending`
                : 'No membership reviews pending'}
            </button>
          ) : null}
          {canViewRegistrations ? (
            <button
              className={`admin-alert-chip${paymentReviewCount ? ' pending' : ''}`}
              type="button"
              onClick={() => setActiveModule('payment-review')}
            >
              <span className="admin-alert-dot" aria-hidden="true" />
              {paymentReviewCount
                ? `${paymentReviewCount} payment${paymentReviewCount === 1 ? ' needs' : 's need'} review`
                : 'No payments need review'}
            </button>
          ) : null}
        </nav>
      ) : null}
      <nav className="admin-module-nav admin-manage-nav admin-tab-nav" aria-label="Admin dashboard modules">
        <button
          className="admin-nav-toggle button-link button-reset"
          type="button"
          aria-controls="admin-module-list"
          aria-expanded={moduleNavOpen}
          onClick={() => setModuleNavOpen((open) => !open)}
        >
          <span>Manage/Edit: {activeManageLabel}</span>
          <span aria-hidden="true">{moduleNavOpen ? '▲' : '▼'}</span>
        </button>
        <div className={`admin-module-list${moduleNavOpen ? ' is-open' : ''}`} id="admin-module-list">
          {manageModules.map((module) => (
            <Fragment key={module.id}>
              {module.id === 'user-controls' ? (
                <span className="admin-tab-divider" aria-hidden="true" />
              ) : null}
              <button
                aria-current={activeModule === module.id ? 'page' : undefined}
                className={`admin-tab-button${activeModule === module.id ? ' active' : ''}`}
                type="button"
                onClick={() => {
                  setActiveModule(module.id);
                  setModuleNavOpen(false);
                }}
              >
                {module.label}
              </button>
            </Fragment>
          ))}
        </div>
      </nav>
      {eventsError && canManageEvents ? <p className="form-error">{eventsError}</p> : null}
      <div className="admin-workspace">
        {!activeModule && (canManageEvents || isSuperUser || canAddUsers) ? (
          <div className="empty-state">
            <h2>Choose what you want to manage</h2>
            <p>Use Manage/Edit above to open registrations, events, listings, user profiles, or setup tools.</p>
          </div>
        ) : null}
        {canManageEvents && activeModule === 'event-details' ? (
          <div id="event-details-card">
            <EventForm
              editingEvent={editingEvent}
              initialEventType={draftEventType}
              onCancelEdit={() => {
                setActiveModule(getEventModuleForType(editingEvent?.eventType || draftEventType));
                setEditingEvent(null);
                setDraftEventType('');
              }}
              onSaved={(savedEvent) => {
                const savedEventId = editingEvent?.id || savedEvent?.eventId || savedEvent?.id || '';
                setEditingEvent(null);
                setDraftEventType('');
                setLastSavedEventId(savedEventId);
                setActiveModule(
                  getEventModuleForType(savedEvent?.eventType || editingEvent?.eventType || draftEventType)
                );
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
              registrationCounts={eventRegistrationCounts}
              totalPaidByEventId={canViewRegistrations ? totalPaidByEventId : {}}
              loading={loadingEvents}
              onDelete={handleDelete}
              onEdit={handleEditEvent}
              isSuperUser={isSuperUser}
              lastSavedEventId={lastSavedEventId}
              defaultEventTypeFilter={eventModuleConfig[activeModule].filter}
              showTypeFilters={eventModuleConfig[activeModule].showTypeFilters}
              excludedEventTypes={eventModuleConfig[activeModule].excludedEventTypes}
            />
          </section>
        ) : null}
        {canManageEvents && activeModule === 'archive' ? (
          <ArchivePanel
            canViewRegistrations={canViewRegistrations}
            events={events}
            loading={loadingEvents}
            onReactivate={handleDelete}
            registrationsByEventId={registrationsByEventId}
          />
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
            canRegisterOthers={canRegisterOthers}
            currentUserProfile={userProfile}
          />
        ) : null}
        {canViewRegistrations && activeModule === 'payment-review' ? (
          <PaymentReconciliationPanel />
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
      <ConfirmDialog
        busy={pendingArchiveEventId === pendingArchiveEvent?.id}
        cancelLabel="Cancel"
        confirmLabel={pendingArchiveEvent?.status === 'Archived' ? 'Reactivate Event' : 'Archive Event'}
        description={
          pendingArchiveEvent
            ? pendingArchiveEvent.status === 'Archived'
              ? `Reactivate "${pendingArchiveEvent.title}"?`
              : `Archive "${pendingArchiveEvent.title}"?`
            : ''
        }
        error={archiveError}
        open={Boolean(pendingArchiveEvent)}
        showConfirm={!isArchiveBlocked}
        title={pendingArchiveEvent?.status === 'Archived' ? 'Reactivate Event' : 'Archive Event'}
        tone="danger"
        onCancel={() => {
          if (!pendingArchiveEventId) {
            setArchiveError('');
            setPendingArchiveEvent(null);
          }
        }}
        onConfirm={handleConfirmArchiveEvent}
      />
    </section>
  );
}

export default AdminDashboardPage;
