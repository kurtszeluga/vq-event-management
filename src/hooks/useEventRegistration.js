import { useEffect, useState } from 'react';
import { getEvent } from '../services/eventService.js';
import {
  DEFAULT_MEMBERSHIP_SETTINGS,
  subscribeToMembershipSettings
} from '../services/configurationService.js';

const MEMBERSHIP_TERMS_VERSION = '2026-07-16';

// Loads the event being registered for and the membership terms settings
// used to build the registration request. Kept independent of registrant,
// identity, and payment state so it can be swapped or retried without
// disturbing anything the person has already entered.
export function useEventRegistration(eventId) {
  const [event, setEvent] = useState(null);
  const [eventError, setEventError] = useState('');
  const [loadingEvent, setLoadingEvent] = useState(Boolean(eventId));
  const [membershipSettings, setMembershipSettings] = useState(DEFAULT_MEMBERSHIP_SETTINGS);

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

  useEffect(() => {
    const unsubscribe = subscribeToMembershipSettings(
      setMembershipSettings,
      () => setMembershipSettings(DEFAULT_MEMBERSHIP_SETTINGS)
    );

    return unsubscribe;
  }, []);

  const displayedTermsVersion = membershipSettings.termsVersion || MEMBERSHIP_TERMS_VERSION;

  return {
    displayedTermsVersion,
    event,
    eventError,
    loadingEvent,
    membershipSettings
  };
}
