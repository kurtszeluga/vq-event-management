import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_EVENT_FORM,
  EVENT_LOCATIONS,
  EVENT_TIME_OPTIONS,
  EVENT_TYPES
} from '../../data/eventOptions.js';
import { createEvent, updateEvent } from '../../services/eventService.js';
import {
  deleteEventFile,
  uploadEventImage,
  uploadEventPdf
} from '../../services/storageService.js';
import {
  subscribeToActiveEventLocationDefaults,
  subscribeToActiveEventTimeDefaults
} from '../../services/configurationService.js';
import { formatTimeRange } from '../../utils/eventFormat.js';
import { formatPhoneNumber } from '../../utils/profileFormat.js';

const eventTypeTimePresetMap = {
  'Class (Half Day)': 'half-day',
  'Class (Full Day)': 'full-day',
  Workshop: 'workshop'
};

function isInvalidTimeRange(startTime, endTime) {
  return Boolean(startTime && endTime && endTime <= startTime);
}

function EventForm({ editingEvent, onCancelEdit, onSaved, userProfile }) {
  const documentInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [form, setForm] = useState(DEFAULT_EVENT_FORM);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [previewFile, setPreviewFile] = useState(null);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadingField, setUploadingField] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingAction, setSavingAction] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [configuredLocations, setConfiguredLocations] = useState([]);
  const [configuredTimeOptions, setConfiguredTimeOptions] = useState([]);
  const isEditing = Boolean(editingEvent);

  useEffect(() => {
    setForm(getInitialForm(editingEvent));
  }, [editingEvent]);

  useEffect(() => {
    const unsubscribeLocations = subscribeToActiveEventLocationDefaults(
      setConfiguredLocations,
      () => setConfiguredLocations([])
    );
    const unsubscribeTimes = subscribeToActiveEventTimeDefaults(
      setConfiguredTimeOptions,
      () => setConfiguredTimeOptions([])
    );

    return () => {
      unsubscribeLocations();
      unsubscribeTimes();
    };
  }, []);

  const eventTypeSelected = Boolean(form.eventType);
  const eventLabel = form.eventType || 'Event';
  const eventLocations = mergeOptionLists(configuredLocations, EVENT_LOCATIONS);
  const eventTimeOptions = mergeOptionLists(configuredTimeOptions, EVENT_TIME_OPTIONS);
  const isBusinessListing = form.eventType === 'Business Listing';
  const isForSale = form.eventType === 'For Sale';
  const isChallenge = form.eventType === 'Challenges';
  const isRetreat = form.eventType === 'Retreat';
  const isLecture = form.eventType === 'Lecture';
  const isListingOnly = isBusinessListing || isForSale;
  const showEventScheduleFields = eventTypeSelected && !isListingOnly && !isChallenge;
  const showTimePresetField = showEventScheduleFields && !isRetreat && !isLecture;
  const showDirectTimeFields = showEventScheduleFields && isRetreat;
  const showPresenterField = showEventScheduleFields && !isRetreat;
  const showCapacityField = showEventScheduleFields && !isLecture;
  const showImageUpload = eventTypeSelected && !isChallenge;
  const showDocumentUpload = isChallenge;
  const showSupplyListUpload = supportsSupplyList(form.eventType);
  const showRegistrationSection = eventTypeSelected && !isListingOnly;
  const showFeesSection = eventTypeSelected && !isListingOnly && !isChallenge && !isLecture;

  function updateField(name, value) {
    setSuccessMessage('');
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => {
      if (!current[name]) {
        return current;
      }

      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function handleTimePreset(value) {
    setSuccessMessage('');
    const option = eventTimeOptions.find((item) => item.value === value);
    setForm((current) => ({
      ...current,
      timePreset: value,
      startTime: option?.startTime || '',
      endTime: option?.endTime || ''
    }));
  }

  function handleEventType(value) {
    setSuccessMessage('');
    const nextTimePreset = eventTypeTimePresetMap[value];
    const nextTimeOption = eventTimeOptions.find(
      (item) => item.value === nextTimePreset
    );
    const isClassOrWorkshop = Boolean(nextTimeOption);
    const isLectureType = value === 'Lecture';
    const isRetreatType = value === 'Retreat';
    const doesNotUseFees = [
      'Business Listing',
      'For Sale',
      'Challenges',
      'Lecture'
    ].includes(value);
    const doesNotUseCapacity = [
      'Business Listing',
      'For Sale',
      'Challenges',
      'Lecture'
    ].includes(value);

    setForm((current) => ({
      ...current,
      eventType: value,
      location: isClassOrWorkshop ? getLocationSelectionValue(eventLocations[0]) : '',
      locationPreset: value
        ? isClassOrWorkshop
          ? eventLocations[0].value
          : 'other'
        : '',
      timePreset: value && !isLectureType ? nextTimeOption?.value || 'other' : '',
      startTime: nextTimeOption?.startTime || '',
      endTime: nextTimeOption?.endTime || '',
      capacityUnlimited: doesNotUseCapacity ? true : current.capacityUnlimited,
      presenter: isRetreatType ? '' : current.presenter,
      supplyListFileName: supportsSupplyList(value) || value === 'Challenges' ? current.supplyListFileName : '',
      supplyListTitle: supportsSupplyList(value) || value === 'Challenges' ? current.supplyListTitle : '',
      supplyListUrl: supportsSupplyList(value) || value === 'Challenges' ? current.supplyListUrl : '',
      documentFileName: value === 'Challenges' ? current.documentFileName : '',
      documentTitle: value === 'Challenges' ? current.documentTitle : '',
      documentUrl: value === 'Challenges' ? current.documentUrl : '',
      isPaid: doesNotUseFees ? false : current.isPaid,
      registrationMode: value === 'Business Listing' || value === 'For Sale' ? 'none' : current.registrationMode,
      registrationOpen: false,
      visibleUntil: value === 'For Sale' ? '' : current.visibleUntil
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.eventType;
      return next;
    });
  }

  function handleLocationPreset(value) {
    setSuccessMessage('');
    const location = eventLocations.find((item) => item.value === value);
    setForm((current) => ({
      ...current,
      location: value === 'other' ? '' : getLocationSelectionValue(location),
      locationPreset: value
    }));
  }

  function handleImageUrl(index, value) {
    setSuccessMessage('');
    setForm((current) => {
      const imageUrls = [...current.imageUrls];
      imageUrls[index] = value;
      return { ...current, imageUrls };
    });
  }

  function handleFeeSelection(value) {
    setSuccessMessage('');
    setForm((current) => ({
      ...current,
      isPaid: value,
      ...(value ? {} : { cost: '0', serviceFee: '0' })
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.isPaid;
      return next;
    });
  }

  function resetForm() {
    setForm(getInitialForm(editingEvent));
    setError('');
    setFieldErrors({});
    setUploadMessage('');
    setUploadingField('');
    setSavingAction('');
    setSuccessMessage('The form has been reset.');
  }

  async function handleFileUpload(fieldName, file, options = {}) {
    if (!file) {
      return;
    }

    setError('');
    setUploadMessage('');
    setSuccessMessage('');
    setUploadingField(fieldName);

    try {
      const previousImageUrl = options.imageIndex !== undefined
        ? form.imageUrls[options.imageIndex]
        : '';
      const previousFileUrl = options.imageIndex === undefined
        ? form[fieldName]
        : '';
      const fileUrl = options.imageIndex !== undefined
        ? await uploadEventImage(file, userProfile)
        : await uploadEventPdf(file, userProfile);

      if (options.imageIndex !== undefined) {
        handleImageUrl(options.imageIndex, fileUrl);
        if (previousImageUrl && previousImageUrl !== fileUrl) {
          await deleteEventFile(previousImageUrl).catch(() => {});
        }
      } else {
        const fileNameField = fieldName === 'documentUrl'
          ? 'documentFileName'
          : 'supplyListFileName';
        const titleField = fieldName === 'documentUrl'
          ? 'documentTitle'
          : 'supplyListTitle';

        setForm((current) => ({
          ...current,
          [fieldName]: fileUrl.url,
          [fileNameField]: fileUrl.fileName,
          [titleField]: ''
        }));
        if (previousFileUrl && previousFileUrl !== fileUrl.url) {
          await deleteEventFile(previousFileUrl).catch(() => {});
        }
      }
      setUploadMessage(options.imageIndex !== undefined ? 'Image uploaded.' : 'Document uploaded.');
    } catch (pickerError) {
      setError(pickerError.message);
    } finally {
      setUploadingField('');
    }
  }

  async function handleRemoveImage(index) {
    const imageUrl = form.imageUrls[index];

    if (!imageUrl) {
      return;
    }

    setError('');
    setUploadMessage('');
    setSuccessMessage('');
    setUploadingField(`remove-image-${index}`);

    try {
      await deleteEventFile(imageUrl);
      handleImageUrl(index, '');
      setUploadMessage('Image removed.');
    } catch (deleteError) {
      handleImageUrl(index, '');
      setError(`Image removed from the event, but the stored file could not be deleted. ${deleteError.message}`);
    } finally {
      setUploadingField('');
    }
  }

  async function handleRemoveDocument() {
    const documentUrl = form.supplyListUrl;

    if (!documentUrl) {
      return;
    }

    setError('');
    setUploadMessage('');
    setSuccessMessage('');
    setUploadingField('remove-supplyListUrl');

    try {
      await deleteEventFile(documentUrl);
      updateField('supplyListUrl', '');
      updateField('supplyListFileName', '');
      updateField('supplyListTitle', '');
      setPreviewFile(null);
      setUploadMessage('Document removed.');
    } catch (deleteError) {
      updateField('supplyListUrl', '');
      updateField('supplyListFileName', '');
      updateField('supplyListTitle', '');
      setPreviewFile(null);
      setError(`Document removed from the event, but the stored file could not be deleted. ${deleteError.message}`);
    } finally {
      setUploadingField('');
    }
  }

  async function handleRemoveChallengeDocument() {
    const documentUrl = form.documentUrl;

    if (!documentUrl) {
      return;
    }

    setError('');
    setUploadMessage('');
    setSuccessMessage('');
    setUploadingField('remove-documentUrl');

    try {
      await deleteEventFile(documentUrl);
      updateField('documentUrl', '');
      updateField('documentFileName', '');
      updateField('documentTitle', '');
      setPreviewFile(null);
      setUploadMessage('Document removed.');
    } catch (deleteError) {
      updateField('documentUrl', '');
      updateField('documentFileName', '');
      updateField('documentTitle', '');
      setPreviewFile(null);
      setError(`Document removed from the event, but the stored file could not be deleted. ${deleteError.message}`);
    } finally {
      setUploadingField('');
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await saveEvent({ asDraft: false });
  }

  async function handleSaveDraft() {
    await saveEvent({ asDraft: true });
  }

  async function saveEvent({ asDraft }) {
    setError('');
    setUploadMessage('');
    setSuccessMessage('');
    const validationErrors = asDraft
      ? validateDraftEventForm(form)
      : validateEventForm(form);

    if (Object.keys(validationErrors).length) {
      setFieldErrors(validationErrors);
      setError('Please fix the highlighted fields.');
      return;
    }

    setFieldErrors({});
    setSaving(true);
    setSavingAction(asDraft ? 'draft' : 'submit');

    const payload = buildEventPayload(form, showSupplyListUpload, asDraft);

    try {
      if (isEditing) {
        await updateEvent(editingEvent.id, payload, userProfile);
      } else {
        await createEvent({
          ...payload,
          createdBy: userProfile?.email || userProfile?.userId || 'admin'
        }, userProfile);
      }

      setForm(DEFAULT_EVENT_FORM);
      setSuccessMessage(
        asDraft
          ? 'Draft saved.'
          : isEditing
            ? 'Event changes saved.'
            : 'Event submitted and saved.'
      );
      onSaved();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
      setSavingAction('');
    }
  }

  return (
    <form className="admin-form" noValidate onSubmit={handleSubmit}>
      <div className="form-section-header">
        <h2>{isEditing ? 'Edit Event' : 'Event/Activity Details'}</h2>
        {isEditing ? (
          <button className="text-button" type="button" onClick={onCancelEdit}>
            Cancel Edit
          </button>
        ) : null}
      </div>

      <div className="form-grid stacked">
        <label>
          <span>Event Type *</span>
          <select
            className={fieldErrors.eventType ? 'field-invalid' : ''}
            value={form.eventType}
            onChange={(event) => handleEventType(event.target.value)}
          >
            <option value="">Select One</option>
            {EVENT_TYPES.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </select>
          <span className="form-help">
            Choose this first so the form can show the right fields.
          </span>
        </label>

        {!eventTypeSelected ? (
          <div className="event-form-placeholder form-span">
            <h3>Select an Event Type</h3>
            <p>The rest of the event card stays collapsed until you choose one.</p>
          </div>
        ) : null}

        {eventTypeSelected ? (
          <div className="event-type-card form-span">
            <h3>{getEventTypeCardTitle(form.eventType)}</h3>
            <div className="form-grid stacked">
        {!isBusinessListing ? (
          <label>
            <span>{eventLabel} Title *</span>
            <input
              className={fieldErrors.title ? 'field-invalid' : ''}
              value={form.title}
              onChange={(event) => updateField('title', event.target.value)}
              onBlur={(event) => updateField('title', toTitleCase(event.target.value))}
            />
          </label>
        ) : null}

        {isBusinessListing ? (
          <>
            <label>
              <span>Owner Name *</span>
              <input
                className={fieldErrors.ownerName ? 'field-invalid' : ''}
                value={form.ownerName}
                onChange={(event) => updateField('ownerName', event.target.value)}
                onBlur={(event) => updateField('ownerName', toTitleCase(event.target.value))}
              />
            </label>
            <label>
              <span>Business Name *</span>
              <input
                className={fieldErrors.businessName ? 'field-invalid' : ''}
                value={form.businessName}
                onChange={(event) => updateField('businessName', event.target.value)}
                onBlur={(event) => updateField('businessName', toTitleCase(event.target.value))}
              />
            </label>
            <label>
              <span>Specialty *</span>
              <input
                className={fieldErrors.specialty ? 'field-invalid' : ''}
                value={form.specialty}
                onChange={(event) => updateField('specialty', event.target.value)}
                onBlur={(event) => updateField('specialty', toTitleCase(event.target.value))}
              />
            </label>
            <label>
              <span>Email *</span>
              <input
                className={fieldErrors.contactEmail ? 'field-invalid' : ''}
                type="email"
                value={form.contactEmail}
                onChange={(event) => updateField('contactEmail', event.target.value)}
              />
            </label>
            <label>
              <span>Phone *</span>
              <input
                className={fieldErrors.contactPhone ? 'field-invalid' : ''}
                value={form.contactPhone}
                onChange={(event) => updateField('contactPhone', formatPhoneNumber(event.target.value))}
              />
            </label>
            <label className="form-span">
              <span>Address *</span>
              <input
                className={fieldErrors.address ? 'field-invalid' : ''}
                value={form.address}
                onChange={(event) => updateField('address', event.target.value)}
                onBlur={(event) => updateField('address', toTitleCase(event.target.value))}
              />
            </label>
          </>
        ) : null}

        {isForSale ? (
          <>
            <label>
              <span>Asking Price *</span>
              <input
                className={fieldErrors.askingPrice ? 'field-invalid' : ''}
                min="0"
                step="0.01"
                type="number"
                value={form.askingPrice}
                onChange={(event) => updateField('askingPrice', event.target.value)}
              />
            </label>
            <label>
              <span>Contact Name *</span>
              <input
                className={fieldErrors.contactName ? 'field-invalid' : ''}
                value={form.contactName}
                onChange={(event) => updateField('contactName', event.target.value)}
                onBlur={(event) => updateField('contactName', toTitleCase(event.target.value))}
              />
            </label>
            <label>
              <span>Contact Email</span>
              <input
                type="email"
                value={form.contactEmail}
                onChange={(event) => updateField('contactEmail', event.target.value)}
              />
            </label>
            <label>
              <span>Contact Phone *</span>
              <input
                className={fieldErrors.contactPhone ? 'field-invalid' : ''}
                value={form.contactPhone}
                onChange={(event) => updateField('contactPhone', formatPhoneNumber(event.target.value))}
              />
            </label>
          </>
        ) : null}

        {showEventScheduleFields ? (
          <>
            <label>
              <span>{eventLabel} Date *</span>
              <input
                className={fieldErrors.date ? 'field-invalid' : ''}
                type="date"
                value={form.date}
                onChange={(event) => updateField('date', event.target.value)}
              />
              {fieldErrors.date ? <small>{fieldErrors.date}</small> : null}
            </label>

            {showTimePresetField ? (
              <div className="form-stack-group">
                <label>
                  <span>{eventLabel} Time *</span>
                  <select
                    className={fieldErrors.timePreset ? 'field-invalid' : ''}
                    disabled={!eventTypeSelected}
                    value={form.timePreset}
                    onChange={(event) => handleTimePreset(event.target.value)}
                  >
                    <option value="">Select One</option>
                    {eventTimeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {getTimeOptionDisplay(option)}
                      </option>
                    ))}
                  </select>
                  <span className="form-help">
                    Chose Other to enter a specific time.
                  </span>
                </label>
                {form.timePreset === 'other' ? (
                  <div className="form-row-pair nested-fields">
                    <label>
                      <span>Start Time</span>
                      <input
                        className={fieldErrors.startTime ? 'field-invalid' : ''}
                        disabled={!eventTypeSelected}
                        type="time"
                        value={form.startTime}
                        onChange={(event) =>
                          updateField('startTime', event.target.value)
                        }
                      />
                    </label>
                    <label>
                      <span>End Time</span>
                      <input
                        className={fieldErrors.endTime ? 'field-invalid' : ''}
                        disabled={!eventTypeSelected}
                        type="time"
                        value={form.endTime}
                        onChange={(event) =>
                          updateField('endTime', event.target.value)
                        }
                      />
                      {fieldErrors.endTime ? <small>{fieldErrors.endTime}</small> : null}
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showDirectTimeFields ? (
              <div className="form-row-pair">
                <label>
                  <span>{eventLabel} Start Time *</span>
                  <input
                    className={fieldErrors.startTime ? 'field-invalid' : ''}
                    disabled={!eventTypeSelected}
                    type="time"
                    value={form.startTime}
                    onChange={(event) => updateField('startTime', event.target.value)}
                  />
                </label>
                <label>
                  <span>{eventLabel} End Time *</span>
                  <input
                    className={fieldErrors.endTime ? 'field-invalid' : ''}
                    disabled={!eventTypeSelected}
                    type="time"
                    value={form.endTime}
                    onChange={(event) => updateField('endTime', event.target.value)}
                  />
                  {fieldErrors.endTime ? <small>{fieldErrors.endTime}</small> : null}
                </label>
              </div>
            ) : null}

            <div className="form-stack-group">
              <label>
                <span>{eventLabel} Location *</span>
                <select
                  className={fieldErrors.locationPreset ? 'field-invalid' : ''}
                  disabled={!eventTypeSelected}
                  value={form.locationPreset}
                  onChange={(event) => handleLocationPreset(event.target.value)}
                >
                  <option value="">Select One</option>
                  {eventLocations.map((location) => (
                    <option key={location.value} value={location.value}>
                      {getLocationOptionDisplay(location)}
                    </option>
                  ))}
                </select>
                <span className="form-help">
                  Choose Other only if the event is somewhere else.
                </span>
              </label>

              {form.locationPreset === 'other' ? (
                <label className="nested-fields">
                  <span>{eventLabel} Other Location *</span>
                  <input
                    className={fieldErrors.location ? 'field-invalid' : ''}
                    disabled={!eventTypeSelected}
                    value={form.location}
                    onChange={(event) => updateField('location', event.target.value)}
                    onBlur={(event) =>
                      updateField('location', toTitleCase(event.target.value))
                    }
                  />
                </label>
              ) : null}
            </div>

            {showPresenterField ? (
              <label>
                <span>{eventLabel} Presenter/Instructor Name</span>
                <input
                  value={form.presenter}
                  onChange={(event) => updateField('presenter', event.target.value)}
                  onBlur={(event) =>
                    updateField('presenter', toTitleCase(event.target.value))
                  }
                />
              </label>
            ) : null}

            {showCapacityField ? (
              <div className="form-stack-group">
                <div className="capacity-row">
                  <div className="capacity-checkbox-field">
                    <span className="field-label-spacer" aria-hidden="true">
                      Capacity Option
                    </span>
                    <label className="checkbox-label">
                      <input
                        checked={form.capacityUnlimited}
                        disabled={!eventTypeSelected}
                        type="checkbox"
                        onChange={(event) =>
                          updateField('capacityUnlimited', event.target.checked)
                        }
                      />
                      <span>Unlimited Capacity</span>
                    </label>
                  </div>
                  <label>
                    <span>{eventLabel} Maximum Capacity</span>
                    <input
                      className={fieldErrors.capacity ? 'field-invalid' : ''}
                      disabled={!eventTypeSelected || form.capacityUnlimited}
                      min="0"
                      step="1"
                      type="number"
                      value={form.capacity}
                      onChange={(event) => updateField('capacity', event.target.value)}
                    />
                  </label>
                  <span className="form-help">
                    Check Unlimited Capacity if there is no registration limit.
                  </span>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        <label className="form-span">
          <span>{eventLabel} Description *</span>
          <textarea
            className={fieldErrors.description ? 'field-invalid' : ''}
            rows="5"
            value={form.description}
            onChange={(event) => updateField('description', event.target.value)}
          />
        </label>
            </div>
          </div>
        ) : null}
      </div>

      <div className="form-subsection">
        <h3>Images And Documents (Optional)</h3>
        <div className="form-grid">
          {showImageUpload ? [0].map((index) => (
            <div className="image-upload-field" key={index}>
              <span className="field-label">Photo/Image Upload</span>
              <input
                accept="image/*"
                className="visually-hidden-file"
                disabled={!eventTypeSelected || Boolean(uploadingField)}
                ref={imageInputRef}
                type="file"
                onChange={async (event) => {
                  await handleFileUpload(`image-${index}`, event.target.files?.[0], {
                    imageIndex: index
                  });
                  event.target.value = '';
                }}
              />
              <div className="upload-preview-layout">
                <div className="upload-control-panel">
                  <div className="file-action-row">
                    <button
                      className="button-link button-reset"
                      disabled={!eventTypeSelected || Boolean(uploadingField)}
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                    >
                      {form.imageUrls[index] ? 'Change Image' : 'Choose Image'}
                    </button>
                    {form.imageUrls[index] ? (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          setPreviewFile({
                            title: 'Uploaded Image',
                            type: 'image',
                            url: form.imageUrls[index]
                          })
                        }
                      >
                        View Full Size
                      </button>
                    ) : null}
                    {form.imageUrls[index] ? (
                      <button
                        className="danger-button"
                        disabled={!eventTypeSelected || Boolean(uploadingField)}
                        type="button"
                        onClick={() => handleRemoveImage(index)}
                      >
                        Remove Image
                      </button>
                    ) : null}
                  </div>
                  {uploadingField === `image-${index}` ? (
                    <span className="form-help">Uploading image...</span>
                  ) : null}
                  {uploadingField === `remove-image-${index}` ? (
                    <span className="form-help">Removing image...</span>
                  ) : null}
                  {uploadMessage.includes('Image') ? (
                    <span className="upload-inline-success">{uploadMessage}</span>
                  ) : null}
                </div>
                {form.imageUrls[index] ? (
                  <img
                    alt="Uploaded event preview"
                    className="uploaded-image-preview"
                    src={form.imageUrls[index]}
                  />
                ) : (
                  <div className="uploaded-image-placeholder">
                    No Image Selected
                  </div>
                )}
              </div>
              <span className="form-help upload-wide-help">
                Choose an image from your device. The app resizes it before saving.
              </span>
            </div>
          )) : null}
          {showDocumentUpload ? (
            <div className="document-upload-field form-span">
              <span className="field-label">Challenge PDF Upload</span>
              <input
                accept="application/pdf"
                className="visually-hidden-file"
                disabled={!eventTypeSelected || Boolean(uploadingField)}
                ref={documentInputRef}
                type="file"
                onChange={async (event) => {
                  await handleFileUpload('documentUrl', event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <div className="upload-preview-layout">
                <div className="upload-control-panel">
                  <div className="file-action-row">
                    <button
                      className="button-link button-reset"
                      disabled={!eventTypeSelected || Boolean(uploadingField)}
                      type="button"
                      onClick={() => documentInputRef.current?.click()}
                    >
                      {form.documentUrl ? 'Change PDF' : 'Choose PDF'}
                    </button>
                    {form.documentUrl ? (
                      <>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
                            setPreviewFile({
                              title: form.documentTitle || 'Challenge PDF',
                              type: 'pdf',
                              url: form.documentUrl
                            })
                          }
                        >
                          View PDF
                        </button>
                        <button
                          className="danger-button"
                          disabled={!eventTypeSelected || Boolean(uploadingField)}
                          type="button"
                          onClick={handleRemoveChallengeDocument}
                        >
                          Remove PDF
                        </button>
                      </>
                    ) : null}
                  </div>
                  {form.documentUrl ? (
                    <label>
                      <span>PDF Display Title *</span>
                      <input
                        className={fieldErrors.documentTitle ? 'field-invalid' : ''}
                        disabled={!eventTypeSelected}
                        placeholder="Challenge Details"
                        value={form.documentTitle}
                        onChange={(event) =>
                          updateField('documentTitle', event.target.value)
                        }
                        onBlur={(event) =>
                          updateField('documentTitle', toTitleCase(event.target.value))
                        }
                      />
                      {fieldErrors.documentTitle ? (
                        <small>{fieldErrors.documentTitle}</small>
                      ) : null}
                    </label>
                  ) : null}
                  {uploadingField === 'documentUrl' ? (
                    <span className="form-help">Uploading PDF...</span>
                  ) : null}
                  {uploadingField === 'remove-documentUrl' ? (
                    <span className="form-help">Removing PDF...</span>
                  ) : null}
                  {uploadMessage.includes('Document') ? (
                    <span className="upload-inline-success">{uploadMessage}</span>
                  ) : null}
                </div>
                <div className="upload-preview-panel">
                  {form.documentUrl ? (
                    <div className="uploaded-document-card">
                      <span className="document-file-icon">PDF</span>
                      <span>
                        <strong>{form.documentTitle || 'PDF Title Required'}</strong>
                        <small>{form.documentFileName || getFileNameFromUrl(form.documentUrl)}</small>
                      </span>
                    </div>
                  ) : (
                    <div className="uploaded-document-placeholder">
                      No PDF Selected
                    </div>
                  )}
                </div>
              </div>
              <span className="form-help upload-wide-help">
                Choose one PDF file for the challenge details.
              </span>
            </div>
          ) : null}
          {showSupplyListUpload || isChallenge ? (
            <div className="document-upload-field form-span">
              <span className="field-label">
                Supply List Upload
              </span>
              <input
                accept="application/pdf"
                className="visually-hidden-file"
                disabled={!eventTypeSelected || Boolean(uploadingField)}
                ref={pdfInputRef}
                type="file"
                onChange={async (event) => {
                  await handleFileUpload('supplyListUrl', event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <div className="upload-preview-layout">
                <div className="upload-control-panel">
                  <div className="file-action-row">
                    <button
                      className="button-link button-reset"
                      disabled={!eventTypeSelected || Boolean(uploadingField)}
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                    >
                      {form.supplyListUrl ? 'Change Document' : 'Choose Document'}
                    </button>
                    {form.supplyListUrl ? (
                      <>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
                            setPreviewFile({
                              title: form.supplyListTitle || 'Supporting Document',
                              type: 'pdf',
                              url: form.supplyListUrl
                            })
                          }
                        >
                          View PDF
                        </button>
                        <button
                          className="danger-button"
                          disabled={!eventTypeSelected || Boolean(uploadingField)}
                          type="button"
                          onClick={handleRemoveDocument}
                        >
                          Remove Document
                        </button>
                      </>
                    ) : null}
                  </div>
                  {form.supplyListUrl ? (
                    <label>
                      <span>Document Display Title *</span>
                      <input
                        className={fieldErrors.supplyListTitle ? 'field-invalid' : ''}
                        disabled={!eventTypeSelected}
                        placeholder="Supply List"
                        value={form.supplyListTitle}
                        onChange={(event) =>
                          updateField('supplyListTitle', event.target.value)
                        }
                        onBlur={(event) =>
                          updateField('supplyListTitle', toTitleCase(event.target.value))
                        }
                      />
                      {fieldErrors.supplyListTitle ? (
                        <small>{fieldErrors.supplyListTitle}</small>
                      ) : null}
                    </label>
                  ) : null}
                  {uploadingField === 'supplyListUrl' ? (
                    <span className="form-help">Uploading PDF...</span>
                  ) : null}
                  {uploadingField === 'remove-supplyListUrl' ? (
                    <span className="form-help">Removing PDF...</span>
                  ) : null}
                  {uploadMessage.includes('Document') ? (
                    <span className="upload-inline-success">{uploadMessage}</span>
                  ) : null}
                </div>
                <div className="upload-preview-panel">
                  {form.supplyListUrl ? (
                    <div className="uploaded-document-card">
                      <span className="document-file-icon">PDF</span>
                      <span>
                        <strong>{form.supplyListTitle || 'Document Title Required'}</strong>
                        <small>{form.supplyListFileName || getFileNameFromUrl(form.supplyListUrl)}</small>
                      </span>
                    </div>
                  ) : (
                    <div className="uploaded-document-placeholder">
                      No Document Selected
                    </div>
                  )}
                </div>
              </div>
              <span className="form-help upload-wide-help">
                Choose one PDF file. The app saves the member link.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {previewFile ? (
        <div className="file-preview-panel">
          <div className="file-preview-header">
            <h3>{previewFile.title}</h3>
            <button
              className="text-button"
              type="button"
              onClick={() => setPreviewFile(null)}
            >
              Close Preview
            </button>
          </div>
          {previewFile.type === 'image' ? (
            <img
              alt="Full size uploaded preview"
              className="file-preview-image"
              src={previewFile.url}
            />
          ) : (
            <iframe
              className="file-preview-frame"
              src={previewFile.url}
              title={previewFile.title}
            />
          )}
        </div>
      ) : null}

      {showFeesSection ? (
        <div className="form-subsection">
        <h3>Event/Activity Fees</h3>
        <div className="form-grid compact">
          <div className={`radio-field ${fieldErrors.isPaid ? 'field-invalid' : ''}`}>
            <span>Is There a Fee For This Event or Activity? *</span>
            <span className="form-help">
              Choose No for free events.
            </span>
            <div className="radio-options">
              <label className="checkbox-label">
                <input
                  checked={form.isPaid === true}
                  disabled={!eventTypeSelected}
                  name="isPaid"
                  type="radio"
                  onChange={() => handleFeeSelection(true)}
                />
                <span>Yes</span>
              </label>
              <label className="checkbox-label">
                <input
                  checked={form.isPaid === false}
                  disabled={!eventTypeSelected}
                  name="isPaid"
                  type="radio"
                  onChange={() => handleFeeSelection(false)}
                />
                <span>No</span>
              </label>
            </div>
          </div>
          {form.isPaid === true ? (
            <>
              <label>
                <span>Cost</span>
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.cost}
                  onChange={(event) => updateField('cost', event.target.value)}
                />
                <span className="form-help">
                  Enter the event price before any service fee.
                </span>
              </label>
              <label>
                <span>Service Fee</span>
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.serviceFee}
                  onChange={(event) =>
                    updateField('serviceFee', event.target.value)
                  }
                />
                <span className="form-help">
                  Leave the default unless the fee changes.
                </span>
              </label>
            </>
          ) : null}
        </div>
      </div>
      ) : null}

      <div className="form-subsection">
        <h3>Website Listing and Event Registration</h3>
        <div className="form-grid stacked">
          <div className="form-stack-group">
            <label>
              <span>List On Website</span>
              <select
                className={fieldErrors.listingMode ? 'field-invalid' : ''}
                disabled={!eventTypeSelected}
                value={form.listingMode}
                onChange={(event) => updateField('listingMode', event.target.value)}
              >
                <option value="">Select One</option>
                <option value="now">Now</option>
                <option value="future">In The Future</option>
              </select>
              <span className="form-help">
                Choose Now to show the listing as soon as it is saved.
              </span>
            </label>
            {form.listingMode === 'future' || isChallenge ? (
              <div className="form-row-pair nested-fields">
                {form.listingMode === 'future' ? (
                  <label>
                    <span>Post Listing</span>
                    <input
                      className={fieldErrors.visibleFrom ? 'field-invalid' : ''}
                      disabled={!eventTypeSelected}
                      type="datetime-local"
                      value={form.visibleFrom}
                      onChange={(event) =>
                        updateField('visibleFrom', event.target.value)
                      }
                    />
                  </label>
                ) : null}
                {!isForSale ? (
                  <label>
                    <span>Remove Listing *</span>
                    <input
                      className={fieldErrors.visibleUntil ? 'field-invalid' : ''}
                      disabled={!eventTypeSelected}
                      type="datetime-local"
                      value={form.visibleUntil}
                      onChange={(event) =>
                        updateField('visibleUntil', event.target.value)
                      }
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
          {showRegistrationSection ? (
            <div className="form-stack-group">
            <label>
              <span>Enable Event Registration</span>
              <select
                className={fieldErrors.registrationMode ? 'field-invalid' : ''}
                disabled={!eventTypeSelected}
                value={form.registrationMode}
                onChange={(event) =>
                  updateField('registrationMode', event.target.value)
                }
              >
                <option value="">Select One</option>
                <option value="now">Now</option>
                <option value="future">In The Future</option>
              </select>
              <span className="form-help">
                Choose Now to let members register as soon as it is saved.
              </span>
            </label>
            {form.registrationMode === 'future' ? (
              <div className="form-row-pair nested-fields">
                <label>
                  <span>Enable Registration</span>
                  <input
                    className={
                      fieldErrors.registrationOpenAt ? 'field-invalid' : ''
                    }
                    disabled={!eventTypeSelected}
                    type="datetime-local"
                    value={form.registrationOpenAt}
                    onChange={(event) =>
                      updateField('registrationOpenAt', event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>Disable Registration</span>
                  <input
                    className={
                      fieldErrors.registrationCloseAt ? 'field-invalid' : ''
                    }
                    disabled={!eventTypeSelected}
                    type="datetime-local"
                    value={form.registrationCloseAt}
                    onChange={(event) =>
                      updateField('registrationCloseAt', event.target.value)
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
          ) : null}
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      <div className="form-actions">
        <button
          className="button-link button-reset"
          disabled={saving || Boolean(uploadingField)}
          type="submit"
        >
          {saving && savingAction === 'submit' ? 'Saving...' : 'Submit/Save'}
        </button>
        <button
          className="button-link button-reset secondary-action"
          disabled={saving || Boolean(uploadingField)}
          type="button"
          onClick={handleSaveDraft}
        >
          {saving && savingAction === 'draft' ? 'Saving Draft...' : 'Save As Draft'}
        </button>
        <button className="text-button" disabled={saving} type="button" onClick={resetForm}>
          Reset Form
        </button>
      </div>
    </form>
  );
}

function validateEventForm(form) {
  const errors = {};
  const isBusinessListing = form.eventType === 'Business Listing';
  const isForSale = form.eventType === 'For Sale';
  const isChallenge = form.eventType === 'Challenges';
  const isRetreat = form.eventType === 'Retreat';
  const isLecture = form.eventType === 'Lecture';
  const requiresSchedule = form.eventType && !isBusinessListing && !isForSale && !isChallenge;
  const requiresTime = requiresSchedule && !isLecture;
  const requiresTimePreset = requiresTime && !isRetreat;
  const requiresDirectTime = requiresTime && isRetreat;
  const requiresCapacity = requiresSchedule && !isLecture;
  const requiresRegistration = form.eventType && !isBusinessListing && !isForSale;
  const requiresFees = requiresSchedule && !isLecture;

  if (!form.eventType) {
    errors.eventType = 'Event type is required.';
  }

  if (requiresSchedule && !form.date) {
    errors.date = 'Event date is required.';
  }

  if (requiresTimePreset && !form.timePreset) {
    errors.timePreset = 'Event time is required.';
  }

  if (
    ((requiresTimePreset && form.timePreset === 'other') || requiresDirectTime)
    && !form.startTime
  ) {
    errors.startTime = 'Start time is required.';
  }

  if (
    ((requiresTimePreset && form.timePreset === 'other') || requiresDirectTime)
    && !form.endTime
  ) {
    errors.endTime = 'End time is required.';
  }

  if (
    (((requiresTimePreset && form.timePreset === 'other') || requiresDirectTime)
      && form.startTime
      && form.endTime
      && isInvalidTimeRange(form.startTime, form.endTime))
  ) {
    errors.endTime = 'End time must be after the start time.';
  }

  if (requiresSchedule && !form.locationPreset) {
    errors.locationPreset = 'Location is required.';
  }

  if (requiresSchedule && !form.location.trim()) {
    errors.location = 'Location is required.';
  }

  if (!isBusinessListing && !form.title.trim()) {
    errors.title = 'Event title is required.';
  }

  if (!form.description.trim()) {
    errors.description = 'Event description is required.';
  }

  if (isBusinessListing) {
    if (!form.ownerName.trim()) {
      errors.ownerName = 'Owner name is required.';
    }

    if (!form.businessName.trim()) {
      errors.businessName = 'Business name is required.';
    }

    if (!form.specialty.trim()) {
      errors.specialty = 'Specialty is required.';
    }

    if (!form.contactEmail.trim()) {
      errors.contactEmail = 'Email is required.';
    }

    if (!form.contactPhone.trim()) {
      errors.contactPhone = 'Phone is required.';
    }

    if (!form.address.trim()) {
      errors.address = 'Address is required.';
    }
  }

  if (isForSale) {
    if (Number(form.askingPrice) < 0 || form.askingPrice === '') {
      errors.askingPrice = 'Asking price is required.';
    }

    if (!form.contactName.trim()) {
      errors.contactName = 'Contact name is required.';
    }

    if (!form.contactPhone.trim()) {
      errors.contactPhone = 'Contact phone is required.';
    }
  }

  if (form.documentUrl && !form.documentTitle.trim()) {
    errors.documentTitle = 'PDF display title is required.';
  }

  if (form.supplyListUrl && !form.supplyListTitle.trim()) {
    errors.supplyListTitle = 'Document display title is required.';
  }

  if (requiresFees && form.isPaid === null) {
    errors.isPaid = 'Select whether this event has a fee.';
  }

  if (requiresCapacity && !form.capacityUnlimited && Number(form.capacity) < 0) {
    errors.capacity = 'Maximum capacity cannot be negative.';
  }

  if (!form.listingMode) {
    errors.listingMode = 'Select when to list this event.';
  }

  if (form.listingMode === 'future') {
    if (!form.visibleFrom) {
      errors.visibleFrom = 'Post listing date/time is required.';
    }

    if (!isForSale && !form.visibleUntil) {
      errors.visibleUntil = 'Remove listing date/time is required.';
    }
  }

  if (isChallenge && !form.visibleUntil) {
    errors.visibleUntil = 'Remove listing date/time is required.';
  }

  if (requiresRegistration && !form.registrationMode) {
    errors.registrationMode = 'Select when to enable registration.';
  }

  if (requiresRegistration && form.registrationMode === 'future') {
    if (!form.registrationOpenAt) {
      errors.registrationOpenAt = 'Registration enable date/time is required.';
    }

    if (!form.registrationCloseAt) {
      errors.registrationCloseAt = 'Registration disable date/time is required.';
    }
  }

  return errors;
}

function validateDraftEventForm(form) {
  const errors = {};

  if (!form.eventType) {
    errors.eventType = 'Event type is required for a draft.';
  }

  if (form.eventType === 'Business Listing' && !form.businessName.trim()) {
    errors.businessName = 'Business name is required for a draft.';
  } else if (!form.title.trim()) {
    errors.title = 'Event title is required for a draft.';
  }

  return errors;
}

function buildEventPayload(form, showSupplyListUpload, asDraft) {
  const isBusinessListing = form.eventType === 'Business Listing';
  const isForSale = form.eventType === 'For Sale';
  const isChallenge = form.eventType === 'Challenges';
  const isRetreat = form.eventType === 'Retreat';
  const isLecture = form.eventType === 'Lecture';
  const isListingOnly = isBusinessListing || isForSale;
  const hasSchedule = !isListingOnly && !isChallenge;
  const hasTime = hasSchedule && !isLecture;
  const hasCapacity = hasSchedule && !isLecture;
  const hasFees = hasSchedule && !isLecture;
  const title = isBusinessListing ? form.businessName : form.title;
  const visibleFrom = form.visibleFrom;
  const visibleUntil = isForSale
    ? getDefaultForSaleExpiration(visibleFrom)
    : form.visibleUntil;

  return {
    additionalNotes: form.additionalNotes.trim(),
    address: toTitleCase(form.address.trim()),
    askingPrice: isForSale ? Number(form.askingPrice || 0) : 0,
    businessName: toTitleCase(form.businessName.trim()),
    capacity: !hasCapacity || form.capacityUnlimited ? 0 : Number(form.capacity || 0),
    capacityUnlimited: hasCapacity ? Boolean(form.capacityUnlimited) : true,
    contactEmail: form.contactEmail.trim(),
    contactName: toTitleCase(form.contactName.trim()),
    contactPhone: form.contactPhone.trim(),
    cost: form.isPaid && hasFees ? Number(form.cost || 0) : 0,
    date: hasSchedule ? form.date : '',
    description: form.description.trim(),
    documentFileName: isChallenge ? form.documentFileName.trim() : '',
    documentTitle: isChallenge ? form.documentTitle.trim() : '',
    documentUrl: isChallenge ? form.documentUrl.trim() : '',
    endTime: hasTime ? form.endTime : '',
    eventType: form.eventType,
    imageUrls: form.imageUrls.map((url) => url.trim()).filter(Boolean).slice(0, 1),
    isPaid: form.isPaid === true && hasFees,
    listingMode: form.listingMode,
    location: hasSchedule ? toTitleCase(form.location.trim()) : '',
    locationPreset: hasSchedule ? form.locationPreset : '',
    ownerName: toTitleCase(form.ownerName.trim()),
    presenter: hasSchedule && !isRetreat ? toTitleCase(form.presenter.trim()) : '',
    registrationCloseAt: isListingOnly ? '' : form.registrationCloseAt,
    registrationMode: isListingOnly ? 'none' : form.registrationMode,
    registrationOpen: !isListingOnly && form.registrationMode === 'now',
    registrationOpenAt: isListingOnly ? '' : form.registrationOpenAt,
    serviceFee: form.isPaid && hasFees ? Number(form.serviceFee || 0) : 0,
    specialty: toTitleCase(form.specialty.trim()),
    startTime: hasTime ? form.startTime : '',
    status: asDraft ? 'Draft' : 'Published',
    supplyListFileName: showSupplyListUpload || isChallenge ? form.supplyListFileName.trim() : '',
    supplyListTitle: showSupplyListUpload || isChallenge ? form.supplyListTitle.trim() : '',
    supplyListUrl: showSupplyListUpload || isChallenge ? form.supplyListUrl.trim() : '',
    timePreset: hasTime ? (isRetreat ? 'other' : form.timePreset) : '',
    title: toTitleCase(title.trim()),
    type: form.eventType,
    visibleFrom,
    visibleUntil
  };
}

function supportsSupplyList(eventType) {
  return eventType.startsWith('Class') || eventType === 'Workshop';
}

function getEventTypeCardTitle(eventType) {
  if (eventType?.startsWith('Class') || eventType === 'Workshop') {
    return 'Class/Workshop Details';
  }

  if (eventType === 'Challenges') {
    return 'Challenge Details';
  }

  if (eventType === 'Retreat') {
    return 'Retreat Details';
  }

  if (eventType === 'Lecture') {
    return 'Lecture Details';
  }

  if (eventType === 'Business Listing') {
    return 'Business Listing Details';
  }

  if (eventType === 'For Sale') {
    return 'For Sale Listing Details';
  }

  return 'General Event/Activity Details';
}

function mergeOptionLists(configuredOptions, fallbackOptions) {
  const options = configuredOptions.length ? configuredOptions : [];
  const configuredValues = new Set(options.map((option) => option.value));

  return [
    ...options,
    ...fallbackOptions.filter((option) => !configuredValues.has(option.value))
  ];
}

function getLocationOptionDisplay(location) {
  if (!location) {
    return '';
  }

  return [location.label, location.address].filter(Boolean).join(' - ');
}

function getLocationSelectionValue(location) {
  return getLocationOptionDisplay(location);
}

function getTimeOptionDisplay(option) {
  if (!option) {
    return '';
  }

  const timeRange = option.startTime && option.endTime
    ? formatTimeRange(option.startTime, option.endTime)
    : '';

  return timeRange ? `${option.label} (${timeRange})` : option.label;
}

function getInitialForm(editingEvent) {
  if (!editingEvent) {
    return {
      ...DEFAULT_EVENT_FORM,
      imageUrls: [...DEFAULT_EVENT_FORM.imageUrls]
    };
  }

  return {
    ...DEFAULT_EVENT_FORM,
    ...editingEvent,
    capacity: String(editingEvent.capacity ?? 0),
    capacityUnlimited: Boolean(editingEvent.capacityUnlimited),
    cost: String(editingEvent.cost ?? 0),
    contactPhone: formatPhoneNumber(editingEvent.contactPhone || ''),
    imageUrls: [
      editingEvent.imageUrls?.[0] || ''
    ],
    serviceFee: String(editingEvent.serviceFee ?? '1.00')
  };
}

function toTitleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\bTn\b/g, 'TN')
    .replace(/\bP\.m\./g, 'P.M.')
    .replace(/\bA\.m\./g, 'A.M.');
}

function getFileNameFromUrl(fileUrl) {
  try {
    const decodedPath = decodeURIComponent(new URL(fileUrl).pathname);
    return decodedPath.split('/').pop() || 'Uploaded PDF';
  } catch {
    return 'Uploaded PDF';
  }
}

function getDefaultForSaleExpiration(visibleFrom) {
  const startDate = visibleFrom ? new Date(visibleFrom) : new Date();

  if (Number.isNaN(startDate.getTime())) {
    return '';
  }

  startDate.setMonth(startDate.getMonth() + 6);

  return toDateTimeLocalValue(startDate);
}

function toDateTimeLocalValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default EventForm;
