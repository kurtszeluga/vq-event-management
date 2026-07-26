import { useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../ConfirmDialog.jsx';
import ModalDialog from '../ModalDialog.jsx';
import { createAdminRegistration } from '../../services/registrationService.js';
import { formatCurrency } from '../../utils/eventFormat.js';
import {
  buildDisplayName,
  formatPhoneNumber,
  getProfileFirstName,
  getProfileLastName
} from '../../utils/profileFormat.js';
import {
  canPayLaterByCashCheck,
  getEventPaymentTotal,
  isPaidEvent as getIsPaidEvent
} from '../../utils/registrationEligibility.js';

const MAX_VISIBLE_RESULTS = 8;
const ACTIVE_REGISTRATION_STATUSES = ['Pending Payment', 'Registered', 'Waitlisted'];

// Lets an admin with the registerOthers permission submit a registration on
// behalf of a member who doesn't use or is afraid of online tools. The event
// is fixed by which card the admin opened this from - only a member needs
// picking, not an event too. Payment defaults to cash/check only - this UI
// has no card entry at all - but an event that doesn't otherwise offer
// cash/check can be overridden case by case (cashCheckOverride below), for a
// member who cannot pay online regardless of the event's own settings. The
// server (create-registration.js) re-checks the same override independently
// rather than trusting this component's disabled state.
//
// Contact/phone info is shown read-only, straight from the member's own
// profile, and never sent back as profileUpdates - this form registers the
// member for an event, it does not edit their profile. A stale phone or
// missing name blocks submission with a pointer to User Controls instead of
// letting the admin silently rewrite someone else's profile here.
function AdminRegisterMemberPanel({ event, existingRegistrations = [], isFull = false, onClose, onRegistered, open, users }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [duplicateRegistration, setDuplicateRegistration] = useState(null);
  const [cashCheckOverride, setCashCheckOverride] = useState(false);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [paymentReceivedMethod, setPaymentReceivedMethod] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [waitlistConfirmationOpen, setWaitlistConfirmationOpen] = useState(false);
  const idempotencyKeyRef = useRef(createAttemptKey());

  const eventIsPaid = getIsPaidEvent(event || {});
  const eventAllowsCashCheck = canPayLaterByCashCheck(event || {});
  const canOverrideCashCheck = eventIsPaid && !eventAllowsCashCheck;
  const cashCheckAccepted = eventAllowsCashCheck || (canOverrideCashCheck && cashCheckOverride);
  const unsupported = eventIsPaid && !cashCheckAccepted;
  const profileIssue = getProfileIssue(selectedMember);
  // Only offered when the registration will actually hold a seat - a full
  // event goes to the waitlist instead, and collecting payment for a spot
  // that isn't secured yet doesn't make sense until the member is promoted.
  const showPaymentReceivedPrompt = eventIsPaid && cashCheckAccepted && !isFull;

  const filteredMembers = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();

    if (normalized.length < 2) {
      return [];
    }

    return (users || []).filter((member) => getMemberSearchText(member).includes(normalized));
  }, [searchTerm, users]);

  function resetForm() {
    setSearchTerm('');
    setSelectedMember(null);
    setDuplicateRegistration(null);
    setCashCheckOverride(false);
    setPaymentReceived(false);
    setPaymentReceivedMethod('');
    setFormError('');
    setWaitlistConfirmationOpen(false);
    idempotencyKeyRef.current = createAttemptKey();
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleSelectMember(member) {
    setSelectedMember(member);
    setSearchTerm('');
    setDuplicateRegistration(findActiveRegistration(existingRegistrations, member));
    setCashCheckOverride(false);
    setFormError('');
  }

  function handleChangeMember() {
    setSelectedMember(null);
    setDuplicateRegistration(null);
    setCashCheckOverride(false);
    setPaymentReceived(false);
    setPaymentReceivedMethod('');
    setWaitlistConfirmationOpen(false);
    setFormError('');
  }

  async function handleSubmit(event_) {
    event_.preventDefault();
    setFormError('');

    if (!selectedMember) {
      setFormError('Search for and select a member to register.');
      return;
    }

    if (duplicateRegistration) {
      setFormError('This member already has an active registration for this event.');
      return;
    }

    if (profileIssue) {
      setFormError(profileIssue);
      return;
    }

    if (unsupported) {
      setFormError('This event requires online card payment, which admin-initiated registration does not support.');
      return;
    }

    if (showPaymentReceivedPrompt && paymentReceived && !paymentReceivedMethod) {
      setFormError('Select whether the payment received was cash or check.');
      return;
    }

    if (isFull) {
      setWaitlistConfirmationOpen(true);
      return;
    }

    await performSubmit();
  }

  async function performSubmit() {
    setSubmitting(true);

    try {
      const result = await createAdminRegistration({
        allowCashCheckOverride: canOverrideCashCheck && cashCheckOverride,
        email: selectedMember.email || '',
        eventId: event.id,
        idempotencyKey: idempotencyKeyRef.current,
        name: buildDisplayName(getProfileFirstName(selectedMember), getProfileLastName(selectedMember)),
        paymentPreference: eventIsPaid && cashCheckAccepted ? 'cash-check-later' : '',
        paymentReceived: showPaymentReceivedPrompt && paymentReceived,
        paymentReceivedMethod: showPaymentReceivedPrompt && paymentReceived ? paymentReceivedMethod : '',
        phone: selectedMember.phone || '',
        profileUserId: selectedMember.userId || selectedMember.id
      });

      resetForm();
      onRegistered(result);
    } catch (error) {
      setFormError(error.message);
      setWaitlistConfirmationOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedMemberDisplayName = selectedMember
    ? buildDisplayName(getProfileFirstName(selectedMember), getProfileLastName(selectedMember)) || selectedMember.email
    : '';

  return (
    <>
      <ModalDialog
        ariaLabelledBy="admin-register-member-title"
        backdropClassName="registration-modal-backdrop"
        dialogClassName="registration-modal-card"
        onClose={submitting ? undefined : handleClose}
        open={open}
      >
        <div className="form-section-header form-section-header-stacked">
          <div className="form-section-header-top">
            <div>
              <h2 id="admin-register-member-title">Register A Member</h2>
              <p className="section-helper">
                {event?.title || 'This event'} - cash or check payment only.
              </p>
            </div>
            <button
              className="button-link button-reset secondary-action compact-action"
              disabled={submitting}
              type="button"
              onClick={handleClose}
            >
              Close
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          {!selectedMember ? (
            <>
              <label>
                <span>Search Members</span>
                <input
                  autoFocus
                  onChange={(inputEvent) => setSearchTerm(inputEvent.target.value)}
                  placeholder="Search by name, email, or phone"
                  value={searchTerm}
                />
              </label>
              {searchTerm.trim().length >= 2 ? (
                <div className="admin-register-member-results">
                  {filteredMembers.length ? (
                    <>
                      {filteredMembers.slice(0, MAX_VISIBLE_RESULTS).map((member) => (
                        <button
                          className="button-link button-reset secondary-action compact-action admin-register-member-result"
                          key={member.id}
                          type="button"
                          onClick={() => handleSelectMember(member)}
                        >
                          <strong>
                            {buildDisplayName(getProfileFirstName(member), getProfileLastName(member))
                              || member.email
                              || 'Member'}
                          </strong>
                          <span>{member.email}</span>
                        </button>
                      ))}
                      {filteredMembers.length > MAX_VISIBLE_RESULTS ? (
                        <p className="form-help">
                          Showing {MAX_VISIBLE_RESULTS} of {filteredMembers.length} matches - refine your search.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="form-help">No members found.</p>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="admin-register-member-selected">
                <div>
                  <strong>{selectedMemberDisplayName}</strong>
                  <span>{selectedMember.email}</span>
                </div>
                <button
                  className="button-link button-reset secondary-action compact-action"
                  disabled={submitting}
                  type="button"
                  onClick={handleChangeMember}
                >
                  Change
                </button>
              </div>
              {duplicateRegistration ? (
                <p className="form-error">
                  {selectedMemberDisplayName} already has an active registration for this event
                  (status: {duplicateRegistration.status}). Use Change to pick a different member,
                  or manage the existing registration from the table behind this dialog.
                </p>
              ) : null}
              <dl className="registration-detail-grid">
                <div className="registration-detail-item">
                  <dt>Phone</dt>
                  <dd>{formatPhoneNumber(selectedMember.phone || '') || 'Not set'}</dd>
                </div>
              </dl>
              <p className="form-help">
                Name and phone are pulled from {selectedMemberDisplayName || 'the member'}'s profile
                and cannot be edited here. Update it via User Controls first if it needs to change.
              </p>
              {profileIssue && !duplicateRegistration ? (
                <p className="form-error">{profileIssue}</p>
              ) : null}
              {canOverrideCashCheck ? (
                <label className="checkbox-label">
                  <input
                    checked={cashCheckOverride}
                    disabled={submitting}
                    type="checkbox"
                    onChange={(inputEvent) => setCashCheckOverride(inputEvent.target.checked)}
                  />
                  <span>
                    Override: accept cash or check for this registration only, even though this
                    event does not otherwise offer it. Use this only when the member cannot pay
                    online.
                  </span>
                </label>
              ) : null}
              {unsupported ? (
                <p className="form-error">
                  This event requires online card payment, which admin-initiated registration does
                  not support unless the override above is checked. Check it to accept cash or
                  check for this registration only, or have the member register themselves.
                </p>
              ) : eventIsPaid ? (
                <p className="form-help">
                  This registration will be marked pay by cash or check later. Cost:{' '}
                  {formatCurrency(getEventPaymentTotal(event))}.
                </p>
              ) : (
                <p className="form-help">This event is free - no payment is required.</p>
              )}
              {isFull && !unsupported ? (
                <p className="form-error">
                  This event is full. {selectedMemberDisplayName || 'This member'} cannot be given
                  an active seat - submitting will add them to the waitlist instead.
                </p>
              ) : null}
              {showPaymentReceivedPrompt ? (
                <>
                  <label className="checkbox-label">
                    <input
                      checked={paymentReceived}
                      disabled={submitting}
                      type="checkbox"
                      onChange={(inputEvent) => {
                        setPaymentReceived(inputEvent.target.checked);

                        if (!inputEvent.target.checked) {
                          setPaymentReceivedMethod('');
                        }
                      }}
                    />
                    <span>
                      Payment was already received (for example, handed to you in person) - mark
                      it paid now instead of leaving it pending.
                    </span>
                  </label>
                  {paymentReceived ? (
                    <div className="radio-field">
                      <span>How was payment received? *</span>
                      <div className="radio-options">
                        <label className="checkbox-label">
                          <input
                            checked={paymentReceivedMethod === 'Cash'}
                            disabled={submitting}
                            name="paymentReceivedMethod"
                            type="radio"
                            onChange={() => setPaymentReceivedMethod('Cash')}
                          />
                          <span>Cash</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            checked={paymentReceivedMethod === 'Check'}
                            disabled={submitting}
                            name="paymentReceivedMethod"
                            type="radio"
                            onChange={() => setPaymentReceivedMethod('Check')}
                          />
                          <span>Check</span>
                        </label>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
              {formError ? <p className="form-error">{formError}</p> : null}
              <div className="form-actions">
                <button
                  className="button-link button-reset"
                  disabled={
                    submitting
                    || unsupported
                    || Boolean(duplicateRegistration)
                    || Boolean(profileIssue)
                    || (showPaymentReceivedPrompt && paymentReceived && !paymentReceivedMethod)
                  }
                  type="submit"
                >
                  {submitting ? 'Registering...' : 'Register Member'}
                </button>
                <button
                  className="button-link button-reset secondary-action"
                  disabled={submitting}
                  type="button"
                  onClick={handleClose}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      </ModalDialog>
      <ConfirmDialog
        busy={submitting}
        cancelLabel="Go Back"
        confirmLabel="Add To Waitlist"
        description={`This event is full - ${selectedMemberDisplayName || 'this member'} cannot be given an active seat. They will be added to the waitlist instead of an active registration. Continue?`}
        open={waitlistConfirmationOpen}
        title="Event Full - Add To Waitlist Instead?"
        onCancel={() => {
          if (!submitting) {
            setWaitlistConfirmationOpen(false);
          }
        }}
        onConfirm={performSubmit}
      />
    </>
  );
}

// Mirrors create-registration.js's alreadyRegistered check (same status list,
// same userId-or-email match) so the admin sees this before filling out the
// rest of the form, not as a submit-time server error.
function findActiveRegistration(registrations, member) {
  const memberUserId = member?.userId || member?.id || '';
  const memberEmail = normalizeEmail(member?.email);

  return (registrations || []).find((registration) => {
    if (!ACTIVE_REGISTRATION_STATUSES.includes(registration.status)) {
      return false;
    }

    return (memberUserId && registration.userId === memberUserId)
      || (memberEmail && normalizeEmail(registration.email) === memberEmail);
  }) || null;
}

// The registrant name/phone shown here are read straight from the member's
// stored profile (never edited in this form), so a stale or incomplete
// profile has to be fixed at the source - via User Controls - rather than
// patched inline as part of registering them for an event. Also catches an
// inactive/archived account before submit: the server refuses that with
// "Please confirm whether you want to reactivate the matched profile." -
// wording written for a self-registrant choosing to reactivate their own
// profile, which reads as a non sequitur to an admin who never sees a
// reactivation option in this form at all. Checking here, with wording aimed
// at the admin, means that server message should never actually be seen.
function getProfileIssue(member) {
  if (!member) {
    return '';
  }

  if (!isProfileActive(member)) {
    return `This member's account is ${getDisplayAccountStatus(member)}, not Active. Reactivate them via User Controls before registering them for this event.`;
  }

  const firstName = getProfileFirstName(member);
  const lastName = getProfileLastName(member);

  if (!firstName?.trim() || !lastName?.trim()) {
    return "This member's profile is missing a name. Update it via User Controls before registering them.";
  }

  if (String(member.phone || '').replace(/\D/g, '').length < 10) {
    return "This member's profile is missing a valid phone number. Update it via User Controls before registering them.";
  }

  return '';
}

// Mirrors create-registration.js's getProfileStatus() exactly, so this
// client-side gate blocks in precisely the same cases the server would.
function isProfileActive(member) {
  return !isArchivedProfile(member) && member.status === 'Active';
}

function getDisplayAccountStatus(member) {
  return isArchivedProfile(member) ? 'Archived' : (member.status || 'Unknown');
}

function isArchivedProfile(member) {
  return Boolean(member.archivedBy || member.archivedDate || member.status === 'Archived');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getMemberSearchText(member) {
  return [
    member.name,
    getProfileFirstName(member),
    getProfileLastName(member),
    member.email,
    member.phone
  ].filter(Boolean).join(' ').toLowerCase();
}

function createAttemptKey() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default AdminRegisterMemberPanel;
