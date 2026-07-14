import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import {
  createRegistration,
  lookupRegistrationEmail
} from '../services/registrationService.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';
import { formatPhoneNumber, toTitleCase } from '../utils/profileFormat.js';

function RegisterPage() {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') || '';
  const [confirmation, setConfirmation] = useState(null);
  const [email, setEmail] = useState('');
  const [event, setEvent] = useState(null);
  const [eventError, setEventError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loadingEvent, setLoadingEvent] = useState(Boolean(eventId));
  const [lookup, setLookup] = useState(null);
  const [lookupComplete, setLookupComplete] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [reactivateProfile, setReactivateProfile] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setLoadingEvent(false);
      setEvent(null);
      return undefined;
    }

    let active = true;

    async function loadEvent() {
      setLoadingEvent(true);
      try {
        const eventRecord = await getEvent(eventId);

        if (active) {
          setEvent(eventRecord);
          setEventError('');
        }
      } catch (error) {
        if (active) {
          setEventError(error.message);
        }
      } finally {
        if (active) {
          setLoadingEvent(false);
        }
      }
    }

    loadEvent();

    return () => {
      active = false;
    };
  }, [eventId]);

  const registrationUnavailable = useMemo(() => {
    if (!event) {
      return '';
    }

    if (!isEventVisible(event)) {
      return 'This event is not currently available.';
    }

    if (!event.registrationOpen) {
      return 'Registration is not currently open for this event.';
    }

    if (['Business Listing', 'For Sale'].includes(event.eventType)) {
      return 'This listing does not accept registrations.';
    }

    return '';
  }, [event]);

  const membershipBlocked = lookupComplete
    && ['profile-membership-blocked', 'membership-blocked'].includes(lookup?.status);
  const matchedProfile = lookup?.profile || null;
  const needsProfileConfirmation = matchedProfile
    && matchedProfile.status === 'Active'
    && !profileConfirmed;
  const needsProfileReactivation = matchedProfile
    && matchedProfile.status !== 'Active'
    && !reactivateProfile;
  const canShowRegistrantFields = lookupComplete
    && !membershipBlocked
    && !needsProfileConfirmation
    && !needsProfileReactivation;

  async function handleEmailLookup() {
    const normalizedEmail = email.trim().toLowerCase();

    setFieldErrors({});
    setFormError('');
    setConfirmation(null);
    setLookup(null);
    setLookupComplete(false);
    setProfileConfirmed(false);
    setReactivateProfile(false);

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setFieldErrors({ email: 'Valid email is required.' });
      setFormError('Enter a valid email address first.');
      return;
    }

    setLookupLoading(true);

    try {
      const result = await lookupRegistrationEmail(normalizedEmail);
      setEmail(normalizedEmail);
      setLookup(result);
      setLookupComplete(true);

      if (result.profile) {
        setName(result.profile.name || '');
        setPhone(result.profile.phone || '');
      }
    } catch (error) {
      setFormError(error.message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSubmit(formEvent) {
    formEvent.preventDefault();
    const errors = validateForm({ email, name, phone });

    setFieldErrors(errors);
    setFormError('');
    setConfirmation(null);

    if (!lookupComplete) {
      setFormError('Please look up the email address first.');
      return;
    }

    if (needsProfileConfirmation || needsProfileReactivation) {
      setFormError('Please confirm the matched profile before registering.');
      return;
    }

    if (Object.keys(errors).length) {
      setFormError('Please fix the highlighted fields.');
      return;
    }

    if (registrationUnavailable) {
      setFormError(registrationUnavailable);
      return;
    }

    setSubmitting(true);

    try {
      const result = await createRegistration({
        email,
        eventId,
        name,
        phone,
        profileUserId: matchedProfile?.userId || '',
        reactivateProfile
      });
      setConfirmation(result);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!eventId) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Select an Event"
          description="Choose an event before starting registration."
        />
        <Link className="button-link" to="/events">
          View Events
        </Link>
      </section>
    );
  }

  if (loadingEvent) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Loading Registration"
          description="Preparing the event registration form."
        />
      </section>
    );
  }

  if (eventError || !event) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Event Unavailable"
          description={eventError || 'This event could not be found.'}
        />
        <Link className="button-link" to="/events">
          Back To Events
        </Link>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Registration"
        title={`Register For ${event.title}`}
        description="Start with your email address so we can check your profile and membership."
      />
      <div className="registration-layout">
        <EventSummary event={event} />
        <form className="form-panel registration-form" onSubmit={handleSubmit}>
          {registrationUnavailable ? (
            <p className="form-error">{registrationUnavailable}</p>
          ) : null}
          {formError ? <p className="form-error">{formError}</p> : null}
          {confirmation ? (
            <RegistrationConfirmation confirmation={confirmation} event={event} email={email} />
          ) : null}
          <label>
            <span>Email *</span>
            <input
              className={fieldErrors.email ? 'field-invalid' : ''}
              disabled={submitting || Boolean(confirmation)}
              onChange={(inputEvent) => {
                setEmail(inputEvent.target.value);
                setLookupComplete(false);
                setLookup(null);
                setProfileConfirmed(false);
                setReactivateProfile(false);
              }}
              type="email"
              value={email}
            />
          </label>
          <button
            className="button-link button-reset"
            disabled={lookupLoading || submitting || Boolean(confirmation)}
            type="button"
            onClick={handleEmailLookup}
          >
            {lookupLoading ? 'Checking...' : 'Check Email'}
          </button>
          {lookupComplete ? (
            <LookupResult
              lookup={lookup}
              onConfirmProfile={() => setProfileConfirmed(true)}
              onReactivate={() => setReactivateProfile(true)}
              profileConfirmed={profileConfirmed}
              reactivateProfile={reactivateProfile}
            />
          ) : null}
          {canShowRegistrantFields ? (
            <>
              <label>
                <span>Name *</span>
                <input
                  className={fieldErrors.name ? 'field-invalid' : ''}
                  disabled={submitting || Boolean(confirmation)}
                  onBlur={(inputEvent) => setName(toTitleCase(inputEvent.target.value))}
                  onChange={(inputEvent) => setName(inputEvent.target.value)}
                  value={name}
                />
              </label>
              <label>
                <span>Phone *</span>
                <input
                  className={fieldErrors.phone ? 'field-invalid' : ''}
                  disabled={submitting || Boolean(confirmation)}
                  onChange={(inputEvent) => setPhone(formatPhoneNumber(inputEvent.target.value))}
                  type="tel"
                  value={phone}
                />
              </label>
              <button
                className="button-link button-reset"
                disabled={submitting || Boolean(confirmation) || Boolean(registrationUnavailable)}
                type="submit"
              >
                {submitting ? 'Submitting...' : 'Submit Registration'}
              </button>
            </>
          ) : null}
          <Link className="button-link secondary-action" to={`/events/${eventId}`}>
            Cancel
          </Link>
        </form>
      </div>
    </section>
  );
}

function LookupResult({
  lookup,
  onConfirmProfile,
  onReactivate,
  profileConfirmed,
  reactivateProfile
}) {
  const profile = lookup?.profile;

  if (!lookup) {
    return null;
  }

  if (['profile-membership-blocked', 'membership-blocked'].includes(lookup.status)) {
    return (
      <div className="form-error">
        Your membership status is not currently active. Please contact an administrator before registering.
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="registration-lookup-card">
        <strong>No Profile Found</strong>
        <span>Continue entering your information. Membership will be checked again when you submit.</span>
      </div>
    );
  }

  return (
    <div className="registration-lookup-card">
      <strong>Profile Found</strong>
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{profile.name || 'Not listed'}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{profile.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{profile.phone || 'Not listed'}</dd>
        </div>
        <div>
          <dt>Profile Status</dt>
          <dd>{profile.status}</dd>
        </div>
        <div>
          <dt>Membership</dt>
          <dd>{profile.membershipStatus}</dd>
        </div>
      </dl>
      {profile.status === 'Active' ? (
        <button
          className="button-link button-reset"
          disabled={profileConfirmed}
          type="button"
          onClick={onConfirmProfile}
        >
          {profileConfirmed ? 'Profile Confirmed' : 'Yes, This Is Me'}
        </button>
      ) : (
        <button
          className="button-link button-reset"
          disabled={reactivateProfile}
          type="button"
          onClick={onReactivate}
        >
          {reactivateProfile ? 'Profile Will Be Reactivated' : 'Reactivate And Continue'}
        </button>
      )}
    </div>
  );
}

function EventSummary({ event }) {
  const cost = event.isPaid ? formatCurrency(event.cost) : 'Free';

  return (
    <aside className="registration-summary">
      <h2>{event.title}</h2>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{event.eventType}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatEventDate(event.date)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{event.location || 'To be announced'}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{cost}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{event.capacityUnlimited ? 'Unlimited' : event.capacity || 'To be announced'}</dd>
        </div>
      </dl>
    </aside>
  );
}

function RegistrationConfirmation({ confirmation, email, event }) {
  return (
    <div className="form-success">
      <strong>
        {confirmation.status === 'Waitlisted'
          ? 'You have been added to the waitlist.'
          : 'Registration confirmed.'}
      </strong>
      <span>
        {confirmation.profileReactivated ? ' Your profile was reactivated.' : ''}
        {confirmation.paymentRequired
          ? ' Payment is pending and will be handled when the payment module is enabled.'
          : ` You are registered for ${event.title}.`}
      </span>
      <div className="registration-account-prompt">
        <span>Want faster registration next time?</span>
        <Link className="button-link secondary-action" to={`/signup?email=${encodeURIComponent(email)}`}>
          Create Account
        </Link>
      </div>
    </div>
  );
}

function validateForm({ email, name, phone }) {
  const errors = {};

  if (!name.trim()) {
    errors.name = 'Name is required.';
  }

  if (!email.trim() || !email.includes('@')) {
    errors.email = 'Valid email is required.';
  }

  if (phone.replace(/\D/g, '').length < 10) {
    errors.phone = 'Phone number is required.';
  }

  return errors;
}

export default RegisterPage;
