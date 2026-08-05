import { Fragment, useEffect, useRef, useState } from 'react';
import ConfirmDialog from '../ConfirmDialog.jsx';
import {
  COORDINATOR_ASSIGNMENT_AREAS,
  DEFAULT_DIRECTORY_SETTINGS,
  DEFAULT_EMAIL_INSTRUCTIONS,
  DEFAULT_MEMBERSHIP_SETTINGS,
  DEFAULT_PAYMENT_SETTINGS,
  EMAIL_INSTRUCTION_AREAS,
  archiveMembershipProfile,
  deleteBusinessTypeDefault,
  deleteEventLocationDefault,
  deleteEventTimeDefault,
  importMembersFromCsvRows,
  reactivateMembershipProfile,
  saveDirectorySettings,
  saveEmailInstructions,
  saveBusinessTypeDefault,
  saveEventLocationDefault,
  saveEventTimeDefault,
  saveCoordinatorAssignment,
  sendEmailInstructionsTest,
  saveMembershipProfile,
  saveMembershipSettings,
  savePaymentSettings,
  subscribeToBusinessTypeDefaults,
  subscribeToCoordinatorAssignments,
  subscribeToDirectorySettings,
  subscribeToEmailInstructions,
  subscribeToEventLocationDefaults,
  subscribeToEventTimeDefaults,
  subscribeToMembershipProfiles,
  subscribeToMembershipSettings,
  subscribeToPaymentSettings
} from '../../services/configurationService.js';
import { BUSINESS_TYPES, EVENT_LOCATIONS, EVENT_TYPES } from '../../data/eventOptions.js';
import { formatClockTime } from '../../utils/eventFormat.js';
import { formatPhoneNumber, toTitleCase } from '../../utils/profileFormat.js';

const EMPTY_MEMBER_FORM = {
  email: '',
  firstName: '',
  id: '',
  lastName: '',
  name: '',
  phone: '',
  status: 'Active',
  town: ''
};

const EMPTY_BUSINESS_TYPE_FORM = {
  id: '',
  isActive: true,
  label: '',
  sortOrder: 0,
  value: ''
};

const EMPTY_LOCATION_FORM = {
  address: '',
  defaultEventTypes: [],
  id: '',
  isActive: true,
  label: '',
  sortOrder: 0,
  value: ''
};

const EMPTY_TIME_FORM = {
  endTime: '',
  id: '',
  isActive: true,
  label: '',
  sortOrder: 0,
  startTime: '',
  value: ''
};

const EMPTY_COORDINATOR_FORM = {
  assignedUserId: '',
  contactEmailOverride: '',
  contactPhoneOverride: '',
  isActive: true
};

const MEMBER_FILTERS = ['Pending', 'Active', 'Inactive', 'Archived', 'Unknown'];

function ConfigurationPanel({ currentUserProfile }) {
  const csvInputRef = useRef(null);
  const [error, setError] = useState('');
  const [coordinatorForms, setCoordinatorForms] = useState({});
  const [coordinatorMessages, setCoordinatorMessages] = useState({});
  const [csvPreview, setCsvPreview] = useState(null);
  const [directorySettings, setDirectorySettings] = useState(DEFAULT_DIRECTORY_SETTINGS);
  const [emailInstructions, setEmailInstructions] = useState(DEFAULT_EMAIL_INSTRUCTIONS);
  const [emailTestArea, setEmailTestArea] = useState(EMAIL_INSTRUCTION_AREAS[0].areaId);
  const [emailTestRecipient, setEmailTestRecipient] = useState(currentUserProfile?.email || '');
  const [businessTypes, setBusinessTypes] = useState([]);
  const [businessTypeForm, setBusinessTypeForm] = useState(EMPTY_BUSINESS_TYPE_FORM);
  const [businessTypeFormOpen, setBusinessTypeFormOpen] = useState(false);
  const [eventLocations, setEventLocations] = useState([]);
  const [eventTimes, setEventTimes] = useState([]);
  const [importMessage, setImportMessage] = useState('');
  const [importReviewRows, setImportReviewRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationFormOpen, setLocationFormOpen] = useState(false);
  const [locationForm, setLocationForm] = useState(EMPTY_LOCATION_FORM);
  const [annualRefreshConfirmOpen, setAnnualRefreshConfirmOpen] = useState(false);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER_FORM);
  const [memberImportMode, setMemberImportMode] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState('Active');
  const [members, setMembers] = useState([]);
  const [configurationView, setConfigurationView] = useState('membership');
  const [paymentSettings, setPaymentSettings] = useState(DEFAULT_PAYMENT_SETTINGS);
  const [savingSection, setSavingSection] = useState('');
  const [settings, setSettings] = useState(DEFAULT_MEMBERSHIP_SETTINGS);
  const [successMessage, setSuccessMessage] = useState('');
  const [timeFormOpen, setTimeFormOpen] = useState(false);
  const [timeForm, setTimeForm] = useState(EMPTY_TIME_FORM);
  const memberCounts = getMemberCounts(members);
  const filteredMembers = sortMembersByLastName(
    members.filter((member) => (member.membershipStatus || 'Unknown') === memberStatusFilter)
  );

  function renderMemberForm() {
    return (
      <form className="configuration-form-grid" onSubmit={handleSaveMember}>
        <label>
          <span>First Name</span>
          <input
            value={memberForm.firstName}
            onBlur={(event) =>
              setMemberForm((current) => ({ ...current, firstName: toTitleCase(event.target.value) }))
            }
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, firstName: event.target.value }))
            }
          />
        </label>
        <label>
          <span>Last Name</span>
          <input
            value={memberForm.lastName}
            onBlur={(event) =>
              setMemberForm((current) => ({ ...current, lastName: toTitleCase(event.target.value) }))
            }
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, lastName: event.target.value }))
            }
          />
        </label>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={memberForm.email}
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, email: event.target.value }))
            }
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            type="tel"
            value={memberForm.phone}
            onChange={(event) =>
              setMemberForm((current) => ({
                ...current,
                phone: formatPhoneNumber(event.target.value)
              }))
            }
          />
        </label>
        <label>
          <span>Town</span>
          <input
            value={memberForm.town}
            onBlur={(event) =>
              setMemberForm((current) => ({ ...current, town: toTitleCase(event.target.value) }))
            }
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, town: event.target.value }))
            }
          />
        </label>
        <label>
          <span>Status</span>
          <select
            value={memberForm.status}
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, status: event.target.value }))
            }
          >
            <option value="Pending">Pending</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Archived">Archived</option>
            <option value="Unknown">Unknown</option>
          </select>
        </label>
        <div className="configuration-actions configuration-span">
          <button className="button-link button-reset" disabled={savingSection === 'member'} type="submit">
            {savingSection === 'member' ? 'Saving...' : memberForm.id ? 'Save Membership Profile' : 'Save New Profile'}
          </button>
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setMemberForm(EMPTY_MEMBER_FORM);
              setMemberFormOpen(false);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  useEffect(() => {
    let pendingLoads = 7;
    const markLoaded = () => {
      pendingLoads -= 1;
      if (pendingLoads <= 0) {
        setLoading(false);
      }
    };
    const handleError = (snapshotError) => {
      setError(snapshotError.message);
      setLoading(false);
    };
    const unsubscribers = [
      subscribeToMembershipSettings((nextSettings) => {
        setSettings(nextSettings);
        markLoaded();
      }, handleError),
      subscribeToPaymentSettings((nextSettings) => {
        setPaymentSettings(nextSettings);
        markLoaded();
      }, handleError),
      subscribeToEmailInstructions((nextInstructions) => {
        setEmailInstructions(nextInstructions);
        markLoaded();
      }, handleError),
      subscribeToMembershipProfiles((snapshot) => {
        setMembers(snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() })));
        markLoaded();
      }, handleError),
      subscribeToBusinessTypeDefaults((snapshot) => {
        setBusinessTypes(
          snapshot.docs.map((typeDoc) => ({ id: typeDoc.id, ...typeDoc.data() }))
        );
        markLoaded();
      }, handleError),
      subscribeToEventLocationDefaults((snapshot) => {
        setEventLocations(
          snapshot.docs.map((locationDoc) => ({ id: locationDoc.id, ...locationDoc.data() }))
        );
        markLoaded();
      }, handleError),
      subscribeToEventTimeDefaults((snapshot) => {
        setEventTimes(snapshot.docs.map((timeDoc) => ({ id: timeDoc.id, ...timeDoc.data() })));
        markLoaded();
      }, handleError),
      subscribeToCoordinatorAssignments((snapshot) => {
        const assignments = snapshot.docs.map((assignmentDoc) => ({
          id: assignmentDoc.id,
          ...assignmentDoc.data()
        }));
        setCoordinatorForms((current) => getCoordinatorForms(assignments, current));
        markLoaded();
      }, handleError),
      subscribeToDirectorySettings((settingsSnapshot) => {
        setDirectorySettings(settingsSnapshot);
        markLoaded();
      }, handleError)
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  async function handleSaveSettings(event) {
    event.preventDefault();
    await runSave('settings', async () => {
      await saveMembershipSettings(settings, currentUserProfile);
      setSuccessMessage('Membership check settings saved.');
    });
  }

  async function handleSaveEmailInstructions(event) {
    event.preventDefault();
    await runSave('emailInstructions', async () => {
      await saveEmailInstructions(emailInstructions, currentUserProfile);
      setSuccessMessage('Email instructions saved.');
    });
  }

  async function handleSavePaymentSettings(event) {
    event.preventDefault();
    await runSave('paymentSettings', async () => {
      await savePaymentSettings(paymentSettings, currentUserProfile);
      setSuccessMessage('Payment settings saved.');
    });
  }

  async function handleSaveDirectorySettings(event) {
    event.preventDefault();
    await runSave('directorySettings', async () => {
      await saveDirectorySettings(directorySettings, currentUserProfile);
      setSuccessMessage('Directory settings saved.');
    });
  }

  async function handleSendEmailInstructionsTest() {
    if (!emailTestRecipient.trim()) {
      setError('Enter an email address for the test message.');
      return;
    }

    await runSave('emailInstructionsTest', async () => {
      await sendEmailInstructionsTest({
        areaId: emailTestArea,
        instructions: emailInstructions,
        recipientEmail: emailTestRecipient
      });
      setSuccessMessage(`Test email sent to ${emailTestRecipient.trim()}.`);
    });
  }

  async function handleSaveMember(event) {
    event.preventDefault();

    if (
      !memberForm.firstName.trim()
      && !memberForm.lastName.trim()
      && !memberForm.name.trim()
      && !memberForm.email.trim()
      && !memberForm.phone.trim()
    ) {
      setError('Enter at least a name, email, or phone number for the profile.');
      return;
    }

    await runSave('member', async () => {
      const firstName = toTitleCase(memberForm.firstName);
      const lastName = toTitleCase(memberForm.lastName);
      await saveMembershipProfile(
        {
          ...memberForm,
          firstName,
          lastName,
          name: toTitleCase(memberForm.name || [firstName, lastName].filter(Boolean).join(' '))
        },
        currentUserProfile
      );
      setMemberForm(EMPTY_MEMBER_FORM);
      setMemberFormOpen(false);
      setSuccessMessage('Membership profile saved.');
    });
  }

  // Step 1: pick a file. Parses it entirely client side - nothing is
  // written to Firestore here - so problems in the CSV surface as a
  // reviewable preview instead of a partial import you have to untangle.
  async function handleCsvFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!memberImportMode) {
      setError('Choose an import mode before uploading the membership CSV.');
      return;
    }

    setAnnualRefreshConfirmOpen(false);
    setError('');
    setSuccessMessage('');
    setImportMessage('');
    setImportReviewRows([]);

    try {
      const text = await file.text();
      const analysis = analyzeMemberCsv(text);

      if (!analysis.totalDataRows) {
        setError(`"${file.name}" has no data rows to import.`);
        setCsvPreview(null);
        return;
      }

      setCsvPreview({ fileName: file.name, ...analysis });
    } catch (readError) {
      setError(readError.message);
      setCsvPreview(null);
    }
  }

  function handleCancelCsvPreview() {
    setCsvPreview(null);
  }

  // Step 2: the admin has reviewed the preview and explicitly confirms -
  // only now does anything reach Firestore, in batches under the hood.
  // Rows with issues (see analyzeMemberCsv) import anyway, landing with a
  // Pending membership status and a review note - durable in the profile
  // itself, so it survives navigating away and is findable via the
  // existing Pending filter instead of living only in this component's
  // state until the next re-render wipes it.
  async function handleConfirmCsvImport() {
    if (!csvPreview?.validRows.length) {
      return;
    }

    await runSave('csv', async () => {
      const importResult = await importMembersFromCsvRows(csvPreview.validRows, currentUserProfile, {
        mode: memberImportMode
      });
      setImportReviewRows(importResult.reviewRows || []);
      const skippedText = importResult.skippedSuperUserCount
        ? ` ${importResult.skippedSuperUserCount} Super User row(s) skipped.`
        : '';
      const pendingText = importResult.pendingReviewCount
        ? ` ${importResult.pendingReviewCount} row(s) had missing or invalid data and were set to Pending - find them under the Pending filter below.`
        : '';
      setImportMessage(
        memberImportMode === 'annualRefresh'
          ? `${importResult.importedCount} profiles imported. ${importResult.updatedCount} updated, ${importResult.createdCount} created, ${importResult.inactivatedCount} missing profiles marked inactive membership. ${importResult.reviewCount} phone-only matches need review.${skippedText}${pendingText}`
          : `${importResult.importedCount} profiles imported. ${importResult.updatedCount} updated, ${importResult.createdCount} created. ${importResult.reviewCount} phone-only matches need review.${skippedText}${pendingText}`
      );
      setCsvPreview(null);
    });
  }

  async function handleSaveBusinessType(event) {
    event.preventDefault();

    if (!businessTypeForm.label.trim()) {
      setError('Business type label is required.');
      return;
    }

    await runSave('businessType', async () => {
      await saveBusinessTypeDefault(businessTypeForm, currentUserProfile);
      setBusinessTypeForm(EMPTY_BUSINESS_TYPE_FORM);
      setBusinessTypeFormOpen(false);
      setSuccessMessage('Business type saved.');
    });
  }

  async function handleSaveLocation(event) {
    event.preventDefault();

    if (!locationForm.label.trim()) {
      setError('Location label is required.');
      return;
    }

    await runSave('location', async () => {
      await saveEventLocationDefault(locationForm, currentUserProfile);
      setLocationForm(EMPTY_LOCATION_FORM);
      setLocationFormOpen(false);
      setSuccessMessage('Default location saved.');
    });
  }

  async function handleSaveTime(event) {
    event.preventDefault();

    if (!timeForm.label.trim()) {
      setError('Time label is required.');
      return;
    }

    await runSave('time', async () => {
      await saveEventTimeDefault(timeForm, currentUserProfile);
      setTimeForm(EMPTY_TIME_FORM);
      setTimeFormOpen(false);
      setSuccessMessage('Default time saved.');
    });
  }

  async function handleSaveCoordinator(area) {
    const form = getCoordinatorForm(coordinatorForms, area.areaId);
    const profile = getProfileByCoordinatorId(members, form.assignedUserId);

    setError('');
    setSuccessMessage('');
    setCoordinatorMessage(area.areaId, '');

    if (!profile) {
      setCoordinatorMessage(area.areaId, `Choose a profile for ${area.areaLabel}.`, 'error');
      return;
    }

    setSavingSection(`coordinator-${area.areaId}`);

    try {
      await saveCoordinatorAssignment(
        {
          ...form,
          areaId: area.areaId
        },
        profile,
        currentUserProfile
      );
      setCoordinatorMessage(area.areaId, `${area.areaLabel} coordinator saved.`, 'success');
    } catch (saveError) {
      setCoordinatorMessage(area.areaId, saveError.message, 'error');
    } finally {
      setSavingSection('');
    }
  }

  function setCoordinatorMessage(areaId, text, type = 'error') {
    setCoordinatorMessages((current) => ({
      ...current,
      [areaId]: text ? { text, type } : null
    }));
  }

  async function runSave(section, callback) {
    setError('');
    setSuccessMessage('');
    setSavingSection(section);

    try {
      await callback();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingSection('');
    }
  }

  function renderMembershipCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Membership Check</h3>
          <p>Control whether event and activity registration requires an active Guild membership on the profile.</p>
        </div>
        <form className="configuration-card-body" onSubmit={handleSaveSettings}>
          <label className="checkbox-label">
            <input
              checked={settings.requireMembershipCheck}
              type="checkbox"
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  requireMembershipCheck: event.target.checked
                }))
              }
            />
            <span>Require Active Guild Membership For Registration</span>
          </label>
          <p className="form-help">
            Turn this off temporarily to test registrations without a matching active-membership
            profile. Leave it on for normal operation - registration already stays open to any
            event that explicitly allows non-member registration, regardless of this setting.
          </p>
          <label>
            <span>Membership Terms Version</span>
            <input
              placeholder="Example: 2026 Membership Terms"
              value={settings.termsVersion || ''}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  termsVersion: event.target.value
                }))
              }
            />
          </label>
          <label>
            <span>Membership Terms And Conditions Text</span>
            <textarea
              placeholder="Enter the terms and conditions new members must agree to."
              value={settings.termsText || ''}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  termsText: event.target.value
                }))
              }
            />
            <span className="form-help">
              This text appears on the Become A Member form above the agreement checkbox.
            </span>
          </label>
          <button
            className="button-link button-reset configuration-submit-button"
            disabled={savingSection === 'settings'}
            type="submit"
          >
            {savingSection === 'settings' ? 'Saving...' : 'Save Membership Settings'}
          </button>
        </form>
      </article>
    );
  }

  function renderPaymentSettingsCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Payment Settings</h3>
          <p>Set payment defaults used when creating paid programs, workshops, retreats, and other paid activities.</p>
        </div>
        <form className="configuration-card-body" onSubmit={handleSavePaymentSettings}>
          <label className="payment-service-fee-field">
            <span>Default Service Fee</span>
            <input
              min="0"
              step="0.01"
              type="number"
              value={paymentSettings.defaultServiceFee ?? 1}
              onChange={(event) =>
                setPaymentSettings((current) => ({
                  ...current,
                  defaultServiceFee: event.target.value
                }))
              }
            />
            <span className="form-help">
              Used as the starting service fee when an event or activity is marked as paid.
            </span>
          </label>
          <label className="checkbox-label registration-exception-checkbox">
            <input
              checked={Boolean(paymentSettings.allowAppInitiatedRefunds)}
              type="checkbox"
              onChange={(event) =>
                setPaymentSettings((current) => ({
                  ...current,
                  allowAppInitiatedRefunds: event.target.checked
                }))
              }
            />
            <span className="checkbox-label-copy">
              <strong>Process Square Refunds From This App</strong>
              <small>
                Keep off while refunds are handled by the treasurer in Square and only recorded here afterward.
              </small>
            </span>
          </label>
          <label className="checkbox-label registration-exception-checkbox">
            <input
              checked={paymentSettings.enableCardPayments !== false}
              type="checkbox"
              onChange={(event) =>
                setPaymentSettings((current) => ({
                  ...current,
                  enableCardPayments: event.target.checked
                }))
              }
            />
            <span className="checkbox-label-copy">
              <strong>Card Payments</strong>
              <small>Allow members to pay online by entering card details through Square.</small>
            </span>
          </label>
          <label className="checkbox-label registration-exception-checkbox">
            <input
              checked={Boolean(paymentSettings.enableApplePay)}
              type="checkbox"
              onChange={(event) =>
                setPaymentSettings((current) => ({
                  ...current,
                  enableApplePay: event.target.checked
                }))
              }
            />
            <span className="checkbox-label-copy">
              <strong>Apple Pay</strong>
              <small>Enable after Apple Pay is configured for this domain in Square.</small>
            </span>
          </label>
          <label className="checkbox-label registration-exception-checkbox">
            <input
              checked={Boolean(paymentSettings.enableGooglePay)}
              type="checkbox"
              onChange={(event) =>
                setPaymentSettings((current) => ({
                  ...current,
                  enableGooglePay: event.target.checked
                }))
              }
            />
            <span className="checkbox-label-copy">
              <strong>Google Pay</strong>
              <small>Enable after Google Pay is tested with the Square payment form.</small>
            </span>
          </label>
          <button
            className="button-link button-reset configuration-submit-button"
            disabled={savingSection === 'paymentSettings'}
            type="submit"
          >
            {savingSection === 'paymentSettings' ? 'Saving...' : 'Save Payment Settings'}
          </button>
        </form>
      </article>
    );
  }

  function renderDirectorySettingsCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Directory Settings</h3>
          <p>Control what active members can see in the member directory.</p>
        </div>
        <form className="configuration-card-body" onSubmit={handleSaveDirectorySettings}>
          <label className="checkbox-label registration-exception-checkbox">
            <input
              checked={Boolean(directorySettings.enableMemberDirectory)}
              type="checkbox"
              onChange={(event) =>
                setDirectorySettings((current) => ({
                  ...current,
                  enableMemberDirectory: event.target.checked
                }))
              }
            />
            <span className="checkbox-label-copy">
              <strong>Enable Member Directory</strong>
              <small>Allow active members to view the member-only directory.</small>
            </span>
          </label>
          <div className="configuration-checkbox-panel">
            <strong>Directory Fields</strong>
            <div className="configuration-checkbox-grid">
              {[
                ['showEmail', 'Email'],
                ['showPhone', 'Phone'],
                ['showCityState', 'City/State'],
                ['showFullAddress', 'Full Address']
              ].map(([key, label]) => (
                <label className="checkbox-label compact-checkbox-label" key={key}>
                  <input
                    checked={Boolean(directorySettings[key])}
                    type="checkbox"
                    onChange={(event) =>
                      setDirectorySettings((current) => ({
                        ...current,
                        [key]: event.target.checked
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          <label>
            <span>Directory Note</span>
            <textarea
              placeholder="Optional note shown at the top of the member directory."
              value={directorySettings.directoryNote || ''}
              onChange={(event) =>
                setDirectorySettings((current) => ({
                  ...current,
                  directoryNote: event.target.value
                }))
              }
            />
          </label>
          <button
            className="button-link button-reset configuration-submit-button"
            disabled={savingSection === 'directorySettings'}
            type="submit"
          >
            {savingSection === 'directorySettings' ? 'Saving...' : 'Save Directory Settings'}
          </button>
        </form>
      </article>
    );
  }

  function renderEmailInstructionsCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Email Instructions</h3>
          <p>
            Add area-specific comments or instructions for confirmation emails. These notes
            will appear after the event or membership summary.
          </p>
        </div>
        <form className="configuration-card-body" onSubmit={handleSaveEmailInstructions}>
          <label className="checkbox-label">
            <input
              checked={Boolean(emailInstructions.sendRegistrationConfirmations)}
              type="checkbox"
              onChange={(event) =>
                setEmailInstructions((current) => ({
                  ...current,
                  sendRegistrationConfirmations: event.target.checked
                }))
              }
            />
            <span>Send Confirmation Emails</span>
          </label>
          <p className="form-help">
            Turn this off while testing registrations or membership signup to prevent confirmation emails from being sent.
          </p>
          <label className="checkbox-label">
            <input
              checked={Boolean(emailInstructions.sendCoordinatorRegistrationNotifications)}
              type="checkbox"
              onChange={(event) =>
                setEmailInstructions((current) => ({
                  ...current,
                  sendCoordinatorRegistrationNotifications: event.target.checked
                }))
              }
            />
            <span>Notify Coordinators Of New Registrations</span>
          </label>
          <p className="form-help">
            Sends the area coordinator an email for every new registration or waitlist signup, with current
            capacity/payment status and a link to print the full registrant list. Independent of the confirmation
            emails above.
          </p>
          <div className="configuration-form-grid">
            {EMAIL_INSTRUCTION_AREAS.map((area) => (
              <label className="configuration-span" key={area.areaId}>
                <span>{area.areaLabel} Email Comments/Instructions</span>
                <textarea
                  placeholder={`Enter ${area.areaLabel.toLowerCase()} confirmation email notes.`}
                  value={emailInstructions[area.areaId] || ''}
                  onChange={(event) =>
                    setEmailInstructions((current) => ({
                      ...current,
                      [area.areaId]: event.target.value
                    }))
                  }
                />
                <span className="form-help">{area.helperText}</span>
              </label>
            ))}
          </div>
          <button
            className="button-link button-reset configuration-submit-button"
            disabled={savingSection === 'emailInstructions'}
            type="submit"
          >
            {savingSection === 'emailInstructions' ? 'Saving...' : 'Save Email Instructions'}
          </button>
          <div className="configuration-form-grid">
            <label>
              <span>Test Email Area</span>
              <select
                value={emailTestArea}
                onChange={(event) => setEmailTestArea(event.target.value)}
              >
                {EMAIL_INSTRUCTION_AREAS.map((area) => (
                  <option key={area.areaId} value={area.areaId}>
                    {area.areaLabel}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Test Email Address</span>
              <input
                type="email"
                value={emailTestRecipient}
                onChange={(event) => setEmailTestRecipient(event.target.value)}
              />
            </label>
          </div>
          <button
            className="button-link button-reset secondary-action configuration-submit-button"
            disabled={savingSection === 'emailInstructionsTest'}
            type="button"
            onClick={handleSendEmailInstructionsTest}
          >
            {savingSection === 'emailInstructionsTest' ? 'Sending...' : 'Send Test Email'}
          </button>
        </form>
      </article>
    );
  }

  function renderCsvPreview() {
    const { columns, duplicateEmails, fileName, skippedRows, totalDataRows, validRows } = csvPreview;
    const canImport = validRows.length > 0 && savingSection !== 'csv';
    const rowsNeedingReview = validRows.filter((row) => row.issues.length);

    return (
      <div className="configuration-csv-preview">
        <h4>{fileName}</h4>
        <p className="form-help">
          {totalDataRows} row{totalDataRows === 1 ? '' : 's'} found, {validRows.length} ready to
          import{rowsNeedingReview.length ? `, ${rowsNeedingReview.length} will need review` : ''}
          {skippedRows.length ? `, ${skippedRows.length} skipped` : ''}.
        </p>
        {!validRows.length ? (
          <p className="csv-preview-warning csv-preview-error">
            None of these rows have a name, email, or phone number. Check that the file has First
            Name/Last Name, Email, and Phone columns, then choose the file again.
          </p>
        ) : null}
        {/* Which columns were recognised, shown before anything is imported.
            An unmatched column is silent otherwise - every value in it comes
            back empty and the per-row issues look identical to a file where
            that data is genuinely blank. Only genuine gaps are warned about:
            a full-name column is the alternative to first/last rather than an
            extra requirement, and town is decoration. */}
        {columns ? (
          <div className={columns.missing.length ? 'csv-preview-warning' : 'form-help'}>
            <p>
              <strong>Columns found:</strong>{' '}
              {columns.described
                .filter((column) => column.found)
                .map((column) => `${column.label} ("${column.sourceHeader}")`)
                .join(', ') || 'none'}
              .
            </p>
            {columns.missing.length ? (
              <p>
                <strong>Could not find: {columns.missing.join(', ')}.</strong> Those will be empty
                for every row. If the file does have them under a different heading, rename the
                heading and choose the file again rather than importing and fixing{' '}
                {totalDataRows} profile{totalDataRows === 1 ? '' : 's'} by hand.
              </p>
            ) : null}
            {columns.unusedHeaders.length ? (
              <p>
                Columns in the file that were not used:{' '}
                {columns.unusedHeaders.map((header) => `"${header}"`).join(', ')}
                {columns.missing.length ? ' - one of these may be what is missing above' : ''}.
              </p>
            ) : null}
            {columns.missingOptional.length ? (
              <p>Not present, which is fine: {columns.missingOptional.join(', ')}.</p>
            ) : null}
          </div>
        ) : null}
        {rowsNeedingReview.length ? (
          <div className="csv-preview-warning">
            <p>
              {rowsNeedingReview.length} row{rowsNeedingReview.length === 1 ? '' : 's'} will import
              with a <strong>Pending</strong> membership status instead of being skipped, since{' '}
              {rowsNeedingReview.length === 1 ? 'it has' : 'they have'} missing or invalid data - find{' '}
              {rowsNeedingReview.length === 1 ? 'it' : 'them'} under the Pending filter below to fix
              and set to Active:
            </p>
            <ul>
              {rowsNeedingReview.map((row) => (
                <li key={row.dataRowNumber}>
                  Row {row.dataRowNumber} ({row.name || row.email || row.phone || 'blank'}):{' '}
                  {row.issues.join('; ')}.
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {skippedRows.length ? (
          <p className="csv-preview-warning">
            {skippedRows.length} row{skippedRows.length === 1 ? '' : 's'} skipped (no name, email, or
            phone): data row{skippedRows.length === 1 ? '' : 's'}{' '}
            {skippedRows.map((row) => row.dataRowNumber).join(', ')}.
          </p>
        ) : null}
        {duplicateEmails.length ? (
          <p className="csv-preview-warning">
            {duplicateEmails.length} email{duplicateEmails.length === 1 ? '' : 's'} appear more than
            once - only the last row for each will be imported:{' '}
            {duplicateEmails
              .map(({ email, rowNumbers }) => `${email} (rows ${rowNumbers.join(', ')})`)
              .join('; ')}
            .
          </p>
        ) : null}
        <div className="configuration-actions configuration-actions-tight">
          <button
            className="button-link button-reset secondary-action"
            disabled={!canImport}
            type="button"
            onClick={() => {
              if (memberImportMode === 'annualRefresh') {
                setAnnualRefreshConfirmOpen(true);
              } else {
                handleConfirmCsvImport();
              }
            }}
          >
            {savingSection === 'csv' ? 'Importing...' : `Import ${validRows.length} Profile${validRows.length === 1 ? '' : 's'}`}
          </button>
          <button
            className="button-link button-reset"
            disabled={savingSection === 'csv'}
            type="button"
            onClick={handleCancelCsvPreview}
          >
            Choose A Different File
          </button>
        </div>
      </div>
    );
  }

  function renderMemberListCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Membership Profiles</h3>
          <p>
            Upload a CSV (First Name, Last Name, Email, Phone - Status and Town optional) to update
            profile membership. Email matches update automatically; phone-only matches are held for review.
          </p>
        </div>
        <div className="configuration-summary" aria-label="Membership profile totals">
          <span>Pending: {memberCounts.pending}</span>
          <span>Active: {memberCounts.active}</span>
          <span>Inactive: {memberCounts.inactive}</span>
          <span>Archived: {memberCounts.archived}</span>
          <span>Unknown: {memberCounts.unknown}</span>
          <span>Total: {memberCounts.total}</span>
        </div>
        <div className="configuration-actions configuration-actions-tight">
          <label className="configuration-inline-label">
            <span>Import Mode</span>
            <select
              value={memberImportMode}
              onChange={(event) => setMemberImportMode(event.target.value)}
            >
              <option value="">Choose Import Mode</option>
              <option value="addUpdate">Add/Update Only</option>
              <option value="annualRefresh">Annual Refresh</option>
            </select>
          </label>
          <input
            accept=".csv,text/csv"
            className="visually-hidden-file"
            ref={csvInputRef}
            type="file"
            onChange={handleCsvFileSelected}
          />
          <button
            className="button-link button-reset secondary-action"
            disabled={savingSection === 'csv' || !memberImportMode}
            type="button"
            onClick={() => csvInputRef.current?.click()}
          >
            Choose Membership CSV
          </button>
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setMemberForm(EMPTY_MEMBER_FORM);
              setMemberFormOpen(true);
            }}
          >
            Add Profile
          </button>
        </div>
        <p className="form-help">
          <strong>Add/Update Only</strong> adds new profiles and updates matches already found in the
          file; membership status comes from each row, and profiles not in the CSV are left alone.{' '}
          <strong>Annual Refresh</strong> is for uploading the complete, current paid roster: every
          profile in the file is marked Active for the year, and any profile that is currently Active
          but missing from the file is marked Inactive. Only use Annual Refresh with a complete
          membership list - a partial list will deactivate everyone left out of it.
        </p>
        {importMessage ? <p className="form-help">{importMessage}</p> : null}
        {csvPreview ? renderCsvPreview() : null}
        {importReviewRows.length ? (
          <div className="configuration-review-list">
            <h4>Import Review</h4>
            <p className="form-help">
              These CSV rows matched by phone only and were not updated automatically.
            </p>
            {importReviewRows.map((row, index) => (
              <div className="configuration-review-item" key={`${row.csvEmail}-${row.csvPhone}-${index}`}>
                <strong>{row.csvName || row.csvEmail || row.csvPhone || 'CSV Row'}</strong>
                <span>{row.csvEmail || 'No Email'} | {row.csvPhone || 'No Phone'}</span>
                <span>
                  Possible profile: {row.possibleMatches
                    .map((match) => match.name || match.email || match.phone)
                    .join(', ')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="status-filter-group" aria-label="Membership status filter">
          {MEMBER_FILTERS.map((status) => (
            <button
              className={`status-filter-button${memberStatusFilter === status ? ' active' : ''}${status === 'Archived' && memberStatusFilter === status ? ' archive-active' : ''}`}
              key={status}
              type="button"
              onClick={() => setMemberStatusFilter(status)}
            >
              {status} ({memberCounts[status.toLowerCase()]})
            </button>
          ))}
        </div>
        {memberFormOpen && !memberForm.id ? renderMemberForm() : null}
        <ConfigurationTable
          columns={['First Name', 'Last Name', 'Email', 'Phone', 'Membership', 'Profile', 'Actions']}
          emptyText={`No ${memberStatusFilter.toLowerCase()} membership profiles found.`}
          rows={filteredMembers.map((member) => ({
            id: member.id,
            cells: [
              member.firstName || getFirstNameFallback(member.name) || '-',
              member.lastName || getLastNameFallback(member.name) || '-',
              member.email || '-',
              member.phone || '-',
              member.membershipStatus || 'Unknown',
              member.status || 'Active',
            <RowActions
                key={member.id}
                deleteConfirm={`${
                  member.membershipStatus === 'Archived' ? 'Reactivate' : 'Archive'
                } ${member.name || member.email || member.phone}?`}
                deleteLabel={member.membershipStatus === 'Archived' ? 'Reactivate' : 'Archive'}
                onDelete={() =>
                  (member.membershipStatus === 'Archived'
                    ? reactivateMembershipProfile(member, currentUserProfile)
                    : archiveMembershipProfile(member, currentUserProfile))
                }
                onEdit={() => {
                  setMemberForm({
                    ...EMPTY_MEMBER_FORM,
                    ...member,
                    status: member.membershipStatus || 'Unknown',
                    town: member.billingAddress?.city || ''
                  });
                  setMemberFormOpen(true);
                }}
              />
            ],
            detail: memberFormOpen && memberForm.id === member.id ? renderMemberForm() : null
          }))}
        />
        <ConfirmDialog
          busy={savingSection === 'csv'}
          cancelLabel="Cancel"
          confirmLabel="Run Annual Refresh"
          description={
            `This file has ${csvPreview?.validRows.length ?? 0} profile(s). Every one of them will `
            + 'be marked Active for the year with a membership payment recorded. Your membership '
            + `list currently has ${memberCounts.total - memberCounts.archived} non-archived `
            + 'profile(s) - any of those NOT matched by this file will be marked Inactive. Make '
            + 'sure this file is the complete, current membership roster before continuing - a '
            + 'partial list will deactivate everyone left out of it.'
          }
          open={annualRefreshConfirmOpen}
          title="Confirm Annual Refresh"
          tone="danger"
          onCancel={() => setAnnualRefreshConfirmOpen(false)}
          onConfirm={async () => {
            setAnnualRefreshConfirmOpen(false);
            await handleConfirmCsvImport();
          }}
        />
      </article>
    );
  }

  function renderBusinessTypeCard() {
    const displayedTypes = mergeDefaultBusinessTypes(businessTypes);

    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Business Types</h3>
          <p>
            These groups appear in the business listing type dropdown, and are shown at the top of
            each business listing card.
          </p>
        </div>
        <div className="configuration-actions">
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setBusinessTypeForm(EMPTY_BUSINESS_TYPE_FORM);
              setBusinessTypeFormOpen(true);
            }}
          >
            Add Business Type
          </button>
        </div>
        {businessTypeFormOpen ? (
          <form className="configuration-form-grid configuration-edit-window" onSubmit={handleSaveBusinessType}>
            <label>
              <span>Business Type Label *</span>
              <input
                value={businessTypeForm.label}
                onBlur={(event) =>
                  setBusinessTypeForm((current) => ({
                    ...current,
                    label: toTitleCase(event.target.value)
                  }))
                }
                onChange={(event) =>
                  setBusinessTypeForm((current) => ({ ...current, label: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Dropdown Value</span>
              <input
                value={businessTypeForm.value}
                onChange={(event) =>
                  setBusinessTypeForm((current) => ({ ...current, value: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Sort Order</span>
              <input
                min="0"
                type="number"
                value={businessTypeForm.sortOrder}
                onChange={(event) =>
                  setBusinessTypeForm((current) => ({ ...current, sortOrder: event.target.value }))
                }
              />
            </label>
            <label className="checkbox-label compact-checkbox-label">
              <input
                checked={businessTypeForm.isActive}
                type="checkbox"
                onChange={(event) =>
                  setBusinessTypeForm((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              <span>Active</span>
            </label>
            <div className="configuration-actions configuration-span">
              <button className="button-link button-reset" disabled={savingSection === 'businessType'} type="submit">
                {savingSection === 'businessType'
                  ? 'Saving...'
                  : businessTypeForm.id
                    ? 'Save Business Type'
                    : 'Save New Business Type'}
              </button>
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => {
                  setBusinessTypeForm(EMPTY_BUSINESS_TYPE_FORM);
                  setBusinessTypeFormOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <ConfigurationTable
          columns={['Business Type', 'Value', 'Status', 'Actions']}
          emptyText="No business types have been added yet."
          rows={displayedTypes.map((businessType) => ({
            id: businessType.id,
            cells: [
              <strong key={`${businessType.id}-label`}>{businessType.label}</strong>,
              businessType.value,
              businessType.isBuiltIn
                ? 'Built-in Default'
                : businessType.isActive === false
                  ? 'Inactive'
                  : 'Active',
              <RowActions
                key={businessType.id}
                deleteConfirm="Delete this business type? Listings already using it keep the value they were saved with."
                onDelete={
                  businessType.isBuiltIn
                    ? null
                    : () => deleteBusinessTypeDefault(businessType, currentUserProfile)
                }
                onEdit={() => {
                  setBusinessTypeForm({
                    ...EMPTY_BUSINESS_TYPE_FORM,
                    ...businessType,
                    id: businessType.isBuiltIn ? '' : businessType.id,
                    isActive: businessType.isActive !== false
                  });
                  setBusinessTypeFormOpen(true);
                }}
              />
            ]
          }))}
        />
      </article>
    );
  }

  function renderLocationCard() {
    const displayedLocations = mergeDefaultLocations(eventLocations);

    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Default Locations</h3>
          <p>These locations appear in the event/activity location dropdown.</p>
        </div>
        <div className="configuration-actions">
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setLocationForm(EMPTY_LOCATION_FORM);
              setLocationFormOpen(true);
            }}
          >
            Add Location
          </button>
        </div>
        {locationFormOpen ? (
          <form className="configuration-form-grid configuration-edit-window location-edit-window" onSubmit={handleSaveLocation}>
            <label>
              <span>Location Label *</span>
              <input
                value={locationForm.label}
                onBlur={(event) =>
                  setLocationForm((current) => ({ ...current, label: toTitleCase(event.target.value) }))
                }
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, label: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Dropdown Value</span>
              <input
                value={locationForm.value}
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, value: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Sort Order</span>
              <input
                min="0"
                type="number"
                value={locationForm.sortOrder}
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, sortOrder: event.target.value }))
                }
              />
            </label>
            <label className="configuration-span">
              <span>Address / Notes</span>
              <input
                value={locationForm.address}
                onBlur={(event) =>
                  setLocationForm((current) => ({ ...current, address: toTitleCase(event.target.value) }))
                }
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, address: event.target.value }))
                }
              />
            </label>
            <fieldset className="configuration-span configuration-checkbox-panel">
              <legend>Default For Event Type</legend>
              <p className="form-help">
                Choose which event types should auto-select this location when creating a new record.
              </p>
              <div className="configuration-checkbox-grid">
                {EVENT_TYPES
                  .filter((eventType) => !['Business Listing', 'For Sale'].includes(eventType))
                  .map((eventType) => (
                    <label className="checkbox-label compact-checkbox-label" key={eventType}>
                      <input
                        checked={(locationForm.defaultEventTypes || []).includes(eventType)}
                        type="checkbox"
                        onChange={(event) =>
                          setLocationForm((current) => ({
                            ...current,
                            defaultEventTypes: toggleListValue(
                              current.defaultEventTypes || [],
                              eventType,
                              event.target.checked
                            )
                          }))
                        }
                      />
                      <span>{eventType}</span>
                    </label>
                  ))}
              </div>
            </fieldset>
            <label className="checkbox-label compact-checkbox-label">
              <input
                checked={locationForm.isActive}
                type="checkbox"
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              <span>Active</span>
            </label>
            <div className="configuration-actions configuration-span">
              <button className="button-link button-reset" disabled={savingSection === 'location'} type="submit">
                {savingSection === 'location' ? 'Saving...' : locationForm.id ? 'Save Location' : 'Save New Location'}
              </button>
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => {
                  setLocationForm(EMPTY_LOCATION_FORM);
                  setLocationFormOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <ConfigurationTable
          columns={['Location', 'Value', 'Defaults', 'Status', 'Actions']}
          emptyText="No default locations have been added yet."
          rows={displayedLocations.map((location) => ({
            id: location.id,
            cells: [
              <>
                <strong>{location.label}</strong>
                <span>{location.address}</span>
              </>,
              location.value,
              formatLocationDefaultTypes(location.defaultEventTypes),
              location.isBuiltIn ? 'Built-in Default' : location.isActive === false ? 'Inactive' : 'Active',
              <RowActions
                key={location.id}
                onDelete={location.isBuiltIn ? null : () => deleteEventLocationDefault(location, currentUserProfile)}
                onEdit={() => {
                  setLocationForm({
                    ...EMPTY_LOCATION_FORM,
                    ...location,
                    id: location.isBuiltIn ? '' : location.id,
                    isActive: location.isActive !== false
                  });
                  setLocationFormOpen(true);
                }}
              />
            ]
          }))}
        />
      </article>
    );
  }

  function renderTimeCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Default Start/End Times</h3>
          <p>These time blocks appear in the event/activity time dropdown.</p>
        </div>
        <div className="configuration-actions">
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setTimeForm(EMPTY_TIME_FORM);
              setTimeFormOpen(true);
            }}
          >
            Add Time
          </button>
        </div>
        {timeFormOpen ? (
          <form className="configuration-form-grid" onSubmit={handleSaveTime}>
            <label>
              <span>Time Label *</span>
              <input
                value={timeForm.label}
                onBlur={(event) =>
                  setTimeForm((current) => ({ ...current, label: toTitleCase(event.target.value) }))
                }
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, label: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Dropdown Value</span>
              <input
                value={timeForm.value}
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, value: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Start Time</span>
              <input
                type="time"
                value={timeForm.startTime}
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, startTime: event.target.value }))
                }
              />
            </label>
            <label>
              <span>End Time</span>
              <input
                type="time"
                value={timeForm.endTime}
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, endTime: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Sort Order</span>
              <input
                min="0"
                type="number"
                value={timeForm.sortOrder}
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, sortOrder: event.target.value }))
                }
              />
            </label>
            <label className="checkbox-label">
              <input
                checked={timeForm.isActive}
                type="checkbox"
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              <span>Active</span>
            </label>
            <div className="configuration-actions configuration-span">
              <button className="button-link button-reset" disabled={savingSection === 'time'} type="submit">
                {savingSection === 'time' ? 'Saving...' : timeForm.id ? 'Save Time' : 'Save New Time'}
              </button>
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => {
                  setTimeForm(EMPTY_TIME_FORM);
                  setTimeFormOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <ConfigurationTable
          columns={['Time', 'Start/End', 'Status', 'Actions']}
          emptyText="No default times have been added yet."
          rows={eventTimes.map((timeOption) => ({
            id: timeOption.id,
            cells: [
              <>
                <strong>{timeOption.label}</strong>
                <span>{timeOption.value}</span>
              </>,
              formatConfigurationTimeRange(timeOption.startTime, timeOption.endTime),
              timeOption.isActive === false ? 'Inactive' : 'Active',
              <RowActions
                key={timeOption.id}
                onDelete={() => deleteEventTimeDefault(timeOption, currentUserProfile)}
                onEdit={() => {
                  setTimeForm({ ...EMPTY_TIME_FORM, ...timeOption });
                  setTimeFormOpen(true);
                }}
              />
            ]
          }))}
        />
      </article>
    );
  }

  function renderCoordinatorCard() {
    const profileOptions = members
      .filter((member) => member.status !== 'Archived')
      .sort((first, second) =>
        (first.name || first.email || '').localeCompare(second.name || second.email || '')
      );

    function updateCoordinatorForm(areaId, changes) {
      setCoordinatorMessage(areaId, '');
      setCoordinatorForms((current) => ({
        ...current,
        [areaId]: {
          ...getCoordinatorForm(current, areaId),
          ...changes
        }
      }));
    }

    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Coordinator Assignments</h3>
          <p>
            Assign the profile responsible for each area. Override contact details only when
            a corporate or shared Guild contact should be shown instead of the profile contact.
          </p>
        </div>
        <div className="coordinator-area-list">
          {COORDINATOR_ASSIGNMENT_AREAS.map((area) => {
            const form = getCoordinatorForm(coordinatorForms, area.areaId);
            const savingKey = `coordinator-${area.areaId}`;
            const selectedProfile = getProfileByCoordinatorId(members, form.assignedUserId);
            const effectiveContact = getEffectiveCoordinatorContact(form, selectedProfile);
            const coordinatorMessage = coordinatorMessages[area.areaId];

            return (
              <section className="coordinator-area-card" key={area.areaId}>
                <div className="coordinator-area-heading">
                  <div>
                    <h4>{area.areaLabel}</h4>
                    <p>{area.coveredTypes.join(', ')}</p>
                  </div>
                  <label className="checkbox-label coordinator-active-toggle">
                    <input
                      checked={form.isActive !== false}
                      type="checkbox"
                      onChange={(event) =>
                        updateCoordinatorForm(area.areaId, {
                          isActive: event.target.checked
                        })
                      }
                    />
                    <span>Active</span>
                  </label>
                </div>
                <div className="configuration-form-grid coordinator-form-grid">
                  <label className="configuration-span">
                    <span>Assigned Profile</span>
                    <select
                      value={form.assignedUserId}
                      onChange={(event) =>
                        updateCoordinatorForm(area.areaId, {
                          assignedUserId: event.target.value
                        })
                      }
                    >
                      <option value="">Choose Profile</option>
                      {profileOptions.map((profile) => {
                        const profileId = profile.userId || profile.id;
                        return (
                          <option key={profile.id} value={profileId}>
                            {profile.name || profile.email || profileId}
                            {profile.role ? ` - ${profile.role}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    <span>Email Override</span>
                    <input
                      placeholder={selectedProfile?.email || 'Use profile email'}
                      type="email"
                      value={form.contactEmailOverride}
                      onChange={(event) =>
                        updateCoordinatorForm(area.areaId, {
                          contactEmailOverride: event.target.value
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Phone Override</span>
                    <input
                      placeholder={selectedProfile?.phone || 'Use profile phone'}
                      type="tel"
                      value={form.contactPhoneOverride}
                      onChange={(event) =>
                        updateCoordinatorForm(area.areaId, {
                          contactPhoneOverride: formatPhoneNumber(event.target.value)
                        })
                      }
                    />
                  </label>
                </div>
                <div className="configuration-summary coordinator-preview">
                  <span>Contact: {effectiveContact.name || 'Not assigned'}</span>
                  <span>Email: {effectiveContact.email || 'Not listed'}</span>
                  <span>Phone: {effectiveContact.phone || 'Not listed'}</span>
                </div>
                {coordinatorMessage?.text ? (
                  <p className={coordinatorMessage.type === 'success' ? 'form-success' : 'form-error'}>
                    {coordinatorMessage.text}
                  </p>
                ) : null}
                <div className="configuration-actions">
                  <button
                    className="button-link button-reset configuration-submit-button"
                    disabled={savingSection === savingKey}
                    type="button"
                    onClick={() => handleSaveCoordinator(area)}
                  >
                    {savingSection === savingKey ? 'Saving...' : `Save ${area.areaLabel}`}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </article>
    );
  }

  return (
    <section className="admin-form configuration-panel">
      {loading ? <p>Loading configuration...</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}

      <section className="admin-list-panel configuration-shell">
        <div className="form-section-header form-section-header-stacked configuration-shell-header">
          <div className="form-section-header-top">
            <h2>Configuration</h2>
            <span>Super User Only</span>
          </div>
          <div className="configuration-card-actions configuration-shell-actions">
            {[
              ['membership', 'Membership Check'],
              ['paymentSettings', 'Payment Settings'],
              ['directorySettings', 'Directory Settings'],
              ['emailInstructions', 'Email Instructions'],
              ['members', 'Membership Profiles'],
              ['coordinators', 'Coordinator Assignments'],
              ['businessTypes', 'Business Types'],
              ['locations', 'Default Locations'],
              ['times', 'Default Start/End Times']
            ].map(([value, label]) => (
              <button
                key={value}
                className={`button-link button-reset ${configurationView === value ? '' : 'secondary-action'}`}
                type="button"
                onClick={() => setConfigurationView(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {configurationView === 'membership' ? renderMembershipCard() : null}
        {configurationView === 'paymentSettings' ? renderPaymentSettingsCard() : null}
        {configurationView === 'directorySettings' ? renderDirectorySettingsCard() : null}
        {configurationView === 'emailInstructions' ? renderEmailInstructionsCard() : null}
        {configurationView === 'members' ? renderMemberListCard() : null}
        {configurationView === 'coordinators' ? renderCoordinatorCard() : null}
        {configurationView === 'businessTypes' ? renderBusinessTypeCard() : null}
        {configurationView === 'locations' ? renderLocationCard() : null}
        {configurationView === 'times' ? renderTimeCard() : null}
      </section>
    </section>
  );
}

function RowActions({
  deleteConfirm = 'Delete this item?',
  deleteLabel = 'Delete',
  onDelete,
  onEdit
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleDelete() {
    setConfirmOpen(true);
  }

  return (
    <>
      <div className="card-actions">
        <button className="button-link button-reset" type="button" onClick={onEdit}>
          Edit
        </button>
        {onDelete ? (
          <button className="danger-button archive-action" type="button" onClick={handleDelete}>
            {deleteLabel}
          </button>
        ) : null}
      </div>
      <ConfirmDialog
        cancelLabel="Keep Item"
        confirmLabel={deleteLabel}
        description={deleteConfirm}
        open={confirmOpen}
        title={deleteLabel}
        tone="danger"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          await onDelete();
          setConfirmOpen(false);
        }}
      />
    </>
  );
}

// Built-ins sort after anything configured and cannot be deleted, matching how
// default locations behave - a Super User overrides one by configuring a type
// with the same value rather than removing it.
function mergeDefaultBusinessTypes(configuredBusinessTypes) {
  const configuredValues = new Set(configuredBusinessTypes.map((businessType) => businessType.value));

  return [
    ...configuredBusinessTypes,
    ...BUSINESS_TYPES
      .filter((businessType) => !configuredValues.has(businessType.value))
      .map((businessType, index) => ({
        ...businessType,
        id: `built-in-business-type-${businessType.value}`,
        isActive: true,
        isBuiltIn: true,
        sortOrder: 9000 + index
      }))
  ];
}

function mergeDefaultLocations(configuredLocations) {
  const configuredValues = new Set(configuredLocations.map((location) => location.value));

  return [
    ...configuredLocations,
    ...EVENT_LOCATIONS
      .filter((location) => !configuredValues.has(location.value))
      .map((location, index) => ({
        ...location,
        address: location.address || '',
        defaultEventTypes: location.defaultEventTypes || [],
        id: `built-in-location-${location.value}`,
        isActive: true,
        isBuiltIn: true,
        sortOrder: 9000 + index
      }))
  ];
}

function toggleListValue(values, value, checked) {
  const currentValues = new Set(values);

  if (checked) {
    currentValues.add(value);
  } else {
    currentValues.delete(value);
  }

  return Array.from(currentValues);
}

function formatLocationDefaultTypes(defaultEventTypes = []) {
  return defaultEventTypes.length ? defaultEventTypes.join(', ') : '-';
}

function ConfigurationTable({ columns, emptyText, rows }) {
  if (!rows.length) {
    return <p className="empty-inline">{emptyText}</p>;
  }

  return (
    <div className="user-table-wrap">
      <table className="user-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <tr key={row.id}>
                {row.cells.map((cell, index) => (
                  <td data-label={columns[index]} key={`${row.id}-${columns[index]}`}>
                    {cell}
                  </td>
                ))}
              </tr>
              {row.detail ? (
                <tr className="configuration-detail-row" key={`${row.id}-detail`}>
                  <td className="configuration-detail-cell" colSpan={columns.length}>
                    {row.detail}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getCoordinatorForms(assignments, currentForms = {}) {
  return COORDINATOR_ASSIGNMENT_AREAS.reduce((forms, area) => {
    const assignment = assignments.find((item) =>
      item.coordinatorAreaId === area.areaId || item.id === area.areaId
    );
    forms[area.areaId] = {
      ...EMPTY_COORDINATOR_FORM,
      ...currentForms[area.areaId],
      ...(assignment ? {
        assignedUserId: assignment.assignedUserId || '',
        contactEmailOverride: assignment.contactEmailOverride || '',
        contactPhoneOverride: assignment.contactPhoneOverride || '',
        isActive: assignment.isActive !== false
      } : {})
    };
    return forms;
  }, {});
}

function getCoordinatorForm(forms, areaId) {
  return {
    ...EMPTY_COORDINATOR_FORM,
    ...(forms[areaId] || {})
  };
}

function getProfileByCoordinatorId(profiles, userId) {
  return profiles.find((profile) =>
    userId && (profile.userId === userId || profile.id === userId)
  ) || null;
}

function getEffectiveCoordinatorContact(form, profile) {
  return {
    email: form.contactEmailOverride || profile?.email || '',
    name: profile?.name || [profile?.firstName, profile?.lastName].filter(Boolean).join(' '),
    phone: form.contactPhoneOverride || profile?.phone || ''
  };
}

function getMemberCounts(members) {
  return members.reduce(
    (counts, member) => {
      if (member.membershipStatus === 'Pending') {
        counts.pending += 1;
      } else if (member.membershipStatus === 'Archived') {
        counts.archived += 1;
      } else if (member.membershipStatus === 'Inactive') {
        counts.inactive += 1;
      } else if (member.membershipStatus === 'Active') {
        counts.active += 1;
      } else {
        counts.unknown += 1;
      }

      counts.total += 1;
      return counts;
    },
    { active: 0, archived: 0, inactive: 0, pending: 0, total: 0, unknown: 0 }
  );
}

function getFirstNameFallback(name = '') {
  return name.trim().split(/\s+/)[0] || '';
}

function getLastNameFallback(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function sortMembersByLastName(members) {
  return [...members].sort((firstMember, secondMember) => {
    const firstValue = getMemberSortValue(firstMember);
    const secondValue = getMemberSortValue(secondMember);

    return firstValue.localeCompare(secondValue, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function getMemberSortValue(member) {
  return [
    member.lastName || getLastNameFallback(member.name),
    member.firstName || getFirstNameFallback(member.name),
    member.email || ''
  ].join(' ');
}

function formatConfigurationTimeRange(startTime, endTime) {
  const formattedStart = formatClockTime(startTime);
  const formattedEnd = formatClockTime(endTime);

  if (!formattedStart && !formattedEnd) {
    return '-';
  }

  return [formattedStart || '-', formattedEnd || '-'].join(' / ');
}

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A US phone column sometimes carries a leading country code (11 digits
// starting with 1) - strip that before checking for the expected 10.
function getMemberCsvPhoneDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');

  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

// Every row needs a full name plus at least one working way to reach the
// member (email or phone) - members without email are common here, so
// email and phone are alternatives, not both required. Rather than reject
// a row outright, a row with issues still imports (see importMembersFromCsvRows)
// but lands with a Pending membership status and a review note instead of
// silently accepting bad data or dropping the row entirely - the admin can
// find and fix it right in the profile list. emailInvalid/phoneInvalid flag
// which field (if any) is malformed enough that it should not be written
// as-is, so a bad value doesn't overwrite a good existing one.
function getMemberCsvRowIssues(row) {
  const issues = [];
  const emailInvalid = Boolean(row.email) && !EMAIL_FORMAT.test(row.email);
  const phoneInvalid = Boolean(row.phoneDigitCount) && row.phoneDigitCount !== 10;

  if (!row.name) {
    issues.push('Missing name');
  } else if (!row.hasFullNameColumn) {
    if (!row.firstName) {
      issues.push('Missing first name');
    }
    if (!row.lastName) {
      issues.push('Missing last name');
    }
  }

  if (emailInvalid) {
    issues.push('Invalid email format');
  }

  if (phoneInvalid) {
    issues.push(`Phone number has ${row.phoneDigitCount} digits (expected 10)`);
  }

  if (!row.email && !row.phoneDigitCount) {
    issues.push('Missing email and phone number - at least one is required');
  } else if (!row.email) {
    // Flagged on its own, not only when the phone is missing too. A member
    // with a phone but no email imports perfectly cleanly and is then
    // unreachable by everything this system sends - registration
    // confirmations, waitlist offers, cancellation notices - and can never be
    // sent a verification code by email. One such member went unnoticed from
    // the July import until August. Not a blocker; the row still imports.
    issues.push('Missing email - this member cannot be emailed');
  }

  return { emailInvalid, issues, phoneInvalid };
}

// Parses every data row and sorts it into rows ready to import vs. rows
// with nothing usable in them (skippedRows - no name, email, or phone at
// all, so there is nothing to build a profile from), plus a duplicate-email
// check. Rows with usable-but-invalid data (missing name, missing both
// email and phone, a malformed email, or a phone number with the wrong
// digit count) are NOT excluded here - they still import (see
// importMembersFromCsvRows), just flagged with an `issues` list so the
// preview can warn about them before the admin confirms. All client side,
// no Firestore involved. dataRowNumber is 1-based among data rows only
// (blank rows and the header/banner rows above them don't count), matching
// what you'd get counting down the spreadsheet from the header.
export function analyzeMemberCsv(text) {
  const rows = parseCsvRows(text);
  const headerRowIndex = findMemberCsvHeaderRowIndex(rows);
  const headerFound = rows[headerRowIndex]?.some(
    (cell) => HEADER_ROW_HINT_TOKENS.has(normalizeCsvHeader(cell).toLowerCase())
  ) || false;
  const headerRow = rows[headerRowIndex] || [];
  const dataRows = rows.slice(headerRowIndex + 1);
  const headers = headerRow.map(normalizeCsvHeader);
  const columnMap = getMemberCsvColumnMap(headers);

  const parsedRows = dataRows.map((row, index) => {
    const record = {};

    headers.forEach((header, headerIndex) => {
      record[header] = row[headerIndex] || '';
    });
    const firstName = getCsvValue(record, FIRST_NAME_HEADERS)
      || getCsvColumnValue(row, columnMap.firstName);
    const lastName = getCsvValue(record, LAST_NAME_HEADERS)
      || getCsvColumnValue(row, columnMap.lastName);
    const fullName = getCsvValue(record, NAME_COLUMN_HEADERS);
    const email = getCsvValue(record, EMAIL_HEADERS)
      || getCsvColumnValue(row, columnMap.email);
    const phone = getCsvValue(record, PHONE_HEADERS)
      || getCsvColumnValue(row, columnMap.phone);
    const town = getCsvValue(record, TOWN_HEADERS)
      || getCsvColumnValue(row, columnMap.town);

    return {
      dataRowNumber: index + 1,
      email,
      firstName: toTitleCase(firstName),
      hasFullNameColumn: Boolean(fullName),
      lastName: toTitleCase(lastName),
      name: toTitleCase(fullName || [firstName, lastName].filter(Boolean).join(' ')),
      notes: getCsvValue(record, ['notes', 'note', 'comments']),
      phone: formatPhoneNumber(phone),
      phoneDigitCount: getMemberCsvPhoneDigits(phone).length,
      status: getCsvValue(record, ['status']).toLowerCase() === 'inactive'
        ? 'Inactive'
        : 'Active',
      town: toTitleCase(town)
    };
  });

  const skippedRows = parsedRows.filter((row) => !(row.name || row.email || row.phone));
  const validRows = parsedRows
    .filter((row) => row.name || row.email || row.phone)
    .map((row) => ({ ...row, ...getMemberCsvRowIssues(row) }));

  const emailRowNumbers = new Map();
  validRows.forEach((row) => {
    if (!row.email) {
      return;
    }

    emailRowNumbers.set(row.email, [...(emailRowNumbers.get(row.email) || []), row.dataRowNumber]);
  });
  const duplicateEmails = [...emailRowNumbers.entries()]
    .filter(([, rowNumbers]) => rowNumbers.length > 1)
    .map(([email, rowNumbers]) => ({ email, rowNumbers }));

  return {
    columns: describeMemberCsvColumns(headerRow, headers, columnMap),
    duplicateEmails,
    headerFound,
    skippedRows,
    totalDataRows: parsedRows.length,
    validRows
  };
}

// What the header row was understood as. A column that matched nothing is the
// failure worth surfacing: it is silent, it affects every row at once, and the
// per-row issues cannot distinguish it from a file where that data is simply
// blank.
//
// Not every absent column is a problem, though, and saying so indiscriminately
// buries the one that matters. A full-name column is the ALTERNATIVE to
// first/last, not an additional requirement, and town is decoration. Only
// genuine gaps are reported as such.
function describeMemberCsvColumns(headerRow, headers, columnMap) {
  const described = [
    { aliases: FIRST_NAME_HEADERS, key: 'firstName', label: 'First name' },
    { aliases: LAST_NAME_HEADERS, key: 'lastName', label: 'Last name' },
    { aliases: NAME_COLUMN_HEADERS, key: 'name', label: 'Full name' },
    { aliases: EMAIL_HEADERS, key: 'email', label: 'Email' },
    { aliases: PHONE_HEADERS, key: 'phone', label: 'Phone' },
    { aliases: TOWN_HEADERS, key: 'town', label: 'Town' }
  ].map(({ aliases, key, label }) => {
    const index = key === 'name' ? getHeaderIndex(headers, aliases) : columnMap[key] ?? -1;

    return {
      found: index >= 0,
      index,
      key,
      label,
      // The header exactly as it appears in the file, so the admin can see
      // what to rename rather than guessing at the normalized form.
      sourceHeader: index >= 0 ? String(headerRow[index] || '').trim() : ''
    };
  });

  const byKey = Object.fromEntries(described.map((column) => [column.key, column]));
  // Either spelling of a name satisfies the requirement.
  const hasAnyName = byKey.name.found || (byKey.firstName.found && byKey.lastName.found);
  const missing = [];

  if (!hasAnyName) {
    missing.push(byKey.firstName.found || byKey.lastName.found
      ? 'the other half of the name (only one of First name / Last name was found)'
      : 'a name (no First name / Last name or Full name column)');
  }

  if (!byKey.email.found) {
    missing.push('Email');
  }

  if (!byKey.phone.found) {
    missing.push('Phone');
  }

  const matchedIndexes = new Set(described.filter((column) => column.found).map((column) => column.index));

  return {
    described,
    hasAnyName,
    // Absent but harmless - worth a neutral mention, not a warning.
    missingOptional: byKey.town.found ? [] : ['Town'],
    missing,
    unusedHeaders: headerRow
      .map((header, index) => ({ header: String(header || '').trim(), index }))
      .filter(({ header, index }) => header && !matchedIndexes.has(index))
      .map(({ header }) => header)
  };
}

export function parseMemberCsv(text) {
  return analyzeMemberCsv(text).validRows;
}

// Matching is exact against a normalized header (normalizeCsvHeader lowercases
// and camel-cases), so every spelling a roster export might use has to be
// listed. A header that matches nothing maps the whole column to -1 and every
// value silently comes back empty - which is why unmatched columns are now
// reported to the admin rather than left to be discovered months later.
const FIRST_NAME_HEADERS = ['firstName', 'firstname', 'first', 'givenName', 'givenname', 'fName'];
const LAST_NAME_HEADERS = ['lastName', 'lastname', 'last', 'surname', 'familyName', 'familyname', 'lName'];
const EMAIL_HEADERS = [
  'email', 'emailAddress', 'eMail', 'eMailAddress', 'primaryEmail', 'memberEmail',
  'emailAddr', 'contactEmail', 'homeEmail'
];
const PHONE_HEADERS = [
  'phone', 'phoneNumber', 'telephone', 'mobile', 'primaryPhone', 'memberPhone',
  'cell', 'cellPhone', 'homePhone', 'contactPhone', 'phoneNo'
];
const NAME_COLUMN_HEADERS = ['name', 'member', 'memberName', 'fullName', 'displayName'];
const TOWN_HEADERS = ['town', 'city', 'townCity', 'cityTown', 'homeTown'];
const HEADER_ROW_HINT_TOKENS = new Set([
  ...FIRST_NAME_HEADERS,
  ...LAST_NAME_HEADERS,
  ...EMAIL_HEADERS,
  ...PHONE_HEADERS,
  ...NAME_COLUMN_HEADERS,
  ...TOWN_HEADERS
].map((token) => token.toLowerCase()));
const HEADER_ROW_SCAN_LIMIT = 20;

// Roster exports often carry a title/banner row (e.g. "Village Quilters
// Roster July 2026") above the real column headers. Blank rows are already
// dropped by parseCsvRows, but a banner row is not blank, so find the first
// row that actually looks like a header instead of assuming row 0 is it.
function findMemberCsvHeaderRowIndex(rows) {
  const scanLimit = Math.min(rows.length, HEADER_ROW_SCAN_LIMIT);

  for (let index = 0; index < scanLimit; index += 1) {
    const isHeaderRow = rows[index].some(
      (cell) => HEADER_ROW_HINT_TOKENS.has(normalizeCsvHeader(cell).toLowerCase())
    );

    if (isHeaderRow) {
      return index;
    }
  }

  return 0;
}

function normalizeCsvHeader(header) {
  return normalizeCsvCell(header)
    .replace(/^\uFEFF/, '')
    .replace(/^ï»¿/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+([a-z0-9])/g, (_, character) => character.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function getCsvValue(record, keys) {
  for (const key of keys) {
    if (record[key]) {
      return normalizeCsvCell(record[key]);
    }
  }

  return '';
}

function getMemberCsvColumnMap(headers) {
  return {
    email: getHeaderIndex(headers, EMAIL_HEADERS),
    firstName: getHeaderIndex(headers, FIRST_NAME_HEADERS),
    lastName: getHeaderIndex(headers, LAST_NAME_HEADERS),
    phone: getHeaderIndex(headers, PHONE_HEADERS),
    town: getHeaderIndex(headers, TOWN_HEADERS)
  };
}

function getHeaderIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.includes(header));
}

function getCsvColumnValue(row, index) {
  return index >= 0 ? normalizeCsvCell(row[index] || '') : '';
}

function normalizeCsvCell(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/^\uFEFF/, '')
    .replace(/^ï»¿/, '')
    .trim();
}

function parseCsvRows(text) {
  const delimiter = detectCsvDelimiter(text);
  const rows = [];
  let cell = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === delimiter && !inQuotes) {
      row.push(normalizeCsvCell(cell));
      cell = '';
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }
      row.push(normalizeCsvCell(cell));
      if (row.some(Boolean)) {
        rows.push(row);
      }
      cell = '';
      row = [];
    } else {
      cell += character;
    }
  }

  row.push(normalizeCsvCell(cell));
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function detectCsvDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const candidates = [',', '\t', ';'];

  return candidates
    .map((delimiter) => ({
      delimiter,
      count: firstLine.split(delimiter).length
    }))
    .sort((first, second) => second.count - first.count)[0].delimiter;
}

export default ConfigurationPanel;
