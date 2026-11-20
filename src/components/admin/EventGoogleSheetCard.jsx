import { useEffect, useMemo, useState } from 'react';
import {
  getEventRegistrationSheetState,
  syncEventRegistrationSheet
} from '../../services/eventService.js';
import { getEventRegistrationSheet } from '../../services/eventRegistrationSheet.js';
import { getRegistrationSheetSettings } from '../../services/configurationService.js';
import { getRegistrationSheetStatus } from '../../utils/registrationSheetStatus.js';

// Everything about an event's Google Sheet, in one place with its name on it.
//
// These controls used to live in the registration list's PRINT page toolbar,
// mixed in with Export CSV, Print and Return. Nobody opens a print view to
// reach a spreadsheet, so in practice they were hidden: the quickest way to
// the sheet was to remember that the print page had a link on it.
//
// The loading is deliberately forgiving in the same way the print page's was.
// Each of the three reads can fail on its own without taking the card down,
// because "we could not tell you about the sheet" is a smaller problem than a
// card that will not render.

const SHEET_TONE_CLASS = {
  error: 'form-error',
  info: 'form-info',
  notice: 'form-notice'
};

// Says what happened to the coordinator's own rows as well as to the synced
// ones - somebody who has typed into the sheet wants to know the rewrite put
// them back, not just that it ran.
function buildSyncSummary({ manualRowCount = 0, rowCount = 0 }) {
  const registrations = `${rowCount} registration${rowCount === 1 ? '' : 's'}`;

  if (!manualRowCount) {
    return `Sheet updated with ${registrations}.`;
  }

  return `Sheet updated with ${registrations}, keeping ${manualRowCount} `
    + `hand-entered row${manualRowCount === 1 ? '' : 's'}.`;
}

function EventGoogleSheetCard({ eventId, eventTitle = '', registrations = [], onClose }) {
  const [sheetLink, setSheetLink] = useState(null);
  const [sheetsEnabled, setSheetsEnabled] = useState(null);
  const [sheetEdited, setSheetEdited] = useState(false);
  const [sheetMessage, setSheetMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadSheet() {
      const [sheetRecord, sheetSettings, sheetState] = await Promise.all([
        getEventRegistrationSheet(eventId).catch(() => null),
        getRegistrationSheetSettings().catch(() => 'unreadable'),
        // Only the server can reach Drive, and this is the one question the
        // app's own records cannot answer.
        getEventRegistrationSheetState(eventId).catch(() => null)
      ]);

      if (!active) {
        return;
      }

      setSheetLink(sheetRecord);
      setSheetsEnabled(
        sheetSettings === 'unreadable'
          ? null
          : sheetSettings?.enableRegistrationSheets === true
      );
      setSheetEdited(sheetState?.editedSinceSync === true);
      setLoading(false);
    }

    loadSheet();

    return () => {
      active = false;
    };
  }, [eventId]);

  const sheetStatus = useMemo(
    () => getRegistrationSheetStatus({
      editedSinceSync: sheetEdited,
      enabled: sheetsEnabled,
      registrations,
      sheet: sheetLink
    }),
    [registrations, sheetEdited, sheetLink, sheetsEnabled]
  );

  async function handleSync() {
    setSyncing(true);
    setSheetMessage('');

    try {
      const result = await syncEventRegistrationSheet(eventId);

      setSheetLink(await getEventRegistrationSheet(eventId));
      // The rewrite has just put the sheet back, so whatever was edited by
      // hand no longer differs - without this the warning would persist until
      // the card was reopened.
      setSheetEdited(false);
      setSheetMessage(result.ok ? buildSyncSummary(result) : (
        result.reason || 'The sheet could not be updated.'
      ));
    } catch (syncError) {
      setSheetMessage(syncError.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <article className="admin-list-panel" id="event-google-sheet-card">
      <div className="form-section-header form-section-header-stacked">
        <h2>Google Sheet</h2>
        {eventTitle ? <p className="form-help">{eventTitle}</p> : null}
      </div>
      {loading ? (
        <p className="form-help">Checking this event&apos;s sheet...</p>
      ) : (
        <>
          {sheetMessage ? <p className="form-success">{sheetMessage}</p> : null}
          {!sheetMessage && sheetStatus.message ? (
            <p className={SHEET_TONE_CLASS[sheetStatus.tone] || 'form-info'}>
              {sheetStatus.message}
            </p>
          ) : null}
          {/* The prominent button and the quiet one are deliberately not the
              same control. The sync runs itself on every registration,
              cancellation and payment change, so a permanent Update button
              reads as an instruction - which is how coordinators came to
              believe they had to press it each time. It appears only where
              pressing it does something; otherwise the quiet refresh stays
              available, because a row deleted from the sheet by hand cannot be
              detected from here and that is the only way back from one. */}
          {sheetStatus.canRefresh && !sheetStatus.actionable ? (
            <p className="form-help">
              <button
                className="text-button"
                disabled={syncing}
                type="button"
                onClick={handleSync}
              >
                {syncing ? 'Updating...' : 'Update now'}
              </button>
              {sheetStatus.refreshHint ? ` ${sheetStatus.refreshHint}` : null}
            </p>
          ) : null}
          <div className="form-actions">
            {sheetStatus.state !== 'disabled' && sheetLink?.spreadsheetUrl ? (
              <a
                className="button-link"
                href={sheetLink.spreadsheetUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Open Google Sheet
              </a>
            ) : null}
            {sheetStatus.actionable ? (
              <button
                className="button-link button-reset secondary-action"
                disabled={syncing}
                type="button"
                onClick={handleSync}
              >
                {syncing ? 'Working...' : sheetStatus.actionLabel}
              </button>
            ) : null}
            {onClose ? (
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={onClose}
              >
                Close
              </button>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}

export default EventGoogleSheetCard;
