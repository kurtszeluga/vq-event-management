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

const eventTypeTimePresetMap = {
  'Class (Half Day)': 'half-day',
  'Class (Full Day)': 'full-day',
  Workshop: 'workshop'
};

function EventForm({ editingEvent, onCancelEdit, onSaved, userProfile }) {
  const imageInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [form, setForm] = useState(DEFAULT_EVENT_FORM);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [previewFile, setPreviewFile] = useState(null);
  const [uploadingField, setUploadingField] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const isEditing = Boolean(editingEvent);

  useEffect(() => {
    setForm(getInitialForm(editingEvent));
  }, [editingEvent]);

  const eventTypeSelected = Boolean(form.eventType);
  const eventLabel = form.eventType || 'Event';
  const showSupplyListUpload = supportsSupplyList(form.eventType);

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
    const option = EVENT_TIME_OPTIONS.find((item) => item.value === value);
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
    const nextTimeOption = EVENT_TIME_OPTIONS.find(
      (item) => item.value === nextTimePreset
    );
    const isClassOrWorkshop = Boolean(nextTimeOption);

    setForm((current) => ({
      ...current,
      eventType: value,
      location: isClassOrWorkshop ? EVENT_LOCATIONS[0].label : '',
      locationPreset: value
        ? isClassOrWorkshop
          ? EVENT_LOCATIONS[0].value
          : 'other'
        : '',
      timePreset: value ? nextTimeOption?.value || 'other' : '',
      startTime: nextTimeOption?.startTime || '',
      endTime: nextTimeOption?.endTime || '',
      supplyListFileName: supportsSupplyList(value) ? current.supplyListFileName : '',
      supplyListTitle: supportsSupplyList(value) ? current.supplyListTitle : '',
      supplyListUrl: supportsSupplyList(value) ? current.supplyListUrl : ''
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.eventType;
      return next;
    });
  }

  function handleLocationPreset(value) {
    setSuccessMessage('');
    const location = EVENT_LOCATIONS.find((item) => item.value === value);
    setForm((current) => ({
      ...current,
      location: value === 'other' ? '' : location?.label || '',
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
    setUploadingField('');
    setSuccessMessage('The form has been reset.');
  }

  async function handleFileUpload(fieldName, file, options = {}) {
    if (!file) {
      return;
    }

    setError('');
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
        updateField(fieldName, fileUrl.url);
        updateField('supplyListFileName', fileUrl.fileName);
        if (!form.supplyListTitle.trim()) {
          updateField('supplyListTitle', toTitleCase(stripFileExtension(fileUrl.fileName)));
        }
        if (previousFileUrl && previousFileUrl !== fileUrl.url) {
          await deleteEventFile(previousFileUrl).catch(() => {});
        }
      }
      setSuccessMessage('File uploaded.');
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
    setSuccessMessage('');
    setUploadingField(`remove-image-${index}`);

    try {
      await deleteEventFile(imageUrl);
      handleImageUrl(index, '');
      setSuccessMessage('Image removed.');
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
    setSuccessMessage('');
    setUploadingField('remove-supplyListUrl');

    try {
      await deleteEventFile(documentUrl);
      updateField('supplyListUrl', '');
      updateField('supplyListFileName', '');
      updateField('supplyListTitle', '');
      setPreviewFile(null);
      setSuccessMessage('Document removed.');
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

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccessMessage('');
    const validationErrors = validateEventForm(form);

    if (Object.keys(validationErrors).length) {
      setFieldErrors(validationErrors);
      setError('Please fix the highlighted fields.');
      return;
    }

    setFieldErrors({});
    setSaving(true);

    const payload = {
      additionalNotes: form.additionalNotes.trim(),
      capacity: form.capacityUnlimited ? 0 : Number(form.capacity || 0),
      capacityUnlimited: Boolean(form.capacityUnlimited),
      cost: form.isPaid ? Number(form.cost || 0) : 0,
      date: form.date,
      description: form.description.trim(),
      endTime: form.endTime,
      eventType: form.eventType,
      imageUrls: form.imageUrls.map((url) => url.trim()).filter(Boolean).slice(0, 1),
      isPaid: form.isPaid === true,
      listingMode: form.listingMode,
      location: toTitleCase(form.location.trim()),
      locationPreset: form.locationPreset,
      presenter: toTitleCase(form.presenter.trim()),
      registrationCloseAt: form.registrationCloseAt,
      registrationMode: form.registrationMode,
      registrationOpen: form.registrationMode === 'now',
      registrationOpenAt: form.registrationOpenAt,
      serviceFee: form.isPaid ? Number(form.serviceFee || 0) : 0,
      startTime: form.startTime,
      status: form.status,
      supplyListFileName: showSupplyListUpload ? form.supplyListFileName.trim() : '',
      supplyListTitle: showSupplyListUpload ? form.supplyListTitle.trim() : '',
      supplyListUrl: showSupplyListUpload ? form.supplyListUrl.trim() : '',
      timePreset: form.timePreset,
      title: toTitleCase(form.title.trim()),
      type: form.eventType,
      visibleFrom: form.visibleFrom,
      visibleUntil: form.visibleUntil
    };

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
      setSuccessMessage(isEditing ? 'Event changes saved.' : 'Event created.');
      onSaved();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="admin-form" noValidate onSubmit={handleSubmit}>
      <div className="form-section-header">
        <h2>{isEditing ? 'Edit Event' : 'Event Details'}</h2>
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

        <label>
          <span>{eventLabel} Title *</span>
          <input
            className={fieldErrors.title ? 'field-invalid' : ''}
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            onBlur={(event) => updateField('title', toTitleCase(event.target.value))}
          />
        </label>

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
              {EVENT_TIME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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
                <span>Start</span>
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
                <span>End</span>
                <input
                  className={fieldErrors.endTime ? 'field-invalid' : ''}
                  disabled={!eventTypeSelected}
                  type="time"
                  value={form.endTime}
                  onChange={(event) => updateField('endTime', event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>

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
              {EVENT_LOCATIONS.map((location) => (
                <option key={location.value} value={location.value}>
                  {location.label}
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

      <div className="form-subsection">
        <h3>Images And Documents (Optional)</h3>
        <div className="form-grid">
          {[0].map((index) => (
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
                      className="text-button"
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
          ))}
          {showSupplyListUpload ? (
            <div className="document-upload-field form-span">
              <span className="field-label">
                Supporting Document Upload (i.e. Supply List)
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
              <label>
                <span>Document Display Title</span>
                <input
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
              </label>
              <div className="file-action-row">
                <button
                  className="text-button"
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
                <div className="uploaded-document-card">
                  <span className="document-file-icon">PDF</span>
                  <span>
                    <strong>{form.supplyListTitle || 'Supporting Document'}</strong>
                    <small>{form.supplyListFileName || getFileNameFromUrl(form.supplyListUrl)}</small>
                  </span>
                </div>
              ) : (
                <div className="uploaded-document-placeholder">
                  No Document Selected
                </div>
              )}
              <span className="form-help">
                Choose one PDF file. The app saves the member link.
              </span>
              {uploadingField === 'supplyListUrl' ? (
                <span className="form-help">Uploading PDF...</span>
              ) : null}
              {uploadingField === 'remove-supplyListUrl' ? (
                <span className="form-help">Removing PDF...</span>
              ) : null}
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

      <div className="form-subsection">
        <h3>Event Fees</h3>
        <div className="form-grid compact">
          <div className={`radio-field ${fieldErrors.isPaid ? 'field-invalid' : ''}`}>
            <span>Is There A Fee For This Event? *</span>
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
            {form.listingMode === 'future' ? (
              <div className="form-row-pair nested-fields">
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
                <label>
                  <span>Remove Listing</span>
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
              </div>
            ) : null}
          </div>
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
          {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Event'}
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

  if (!form.eventType) {
    errors.eventType = 'Event type is required.';
  }

  if (!form.date) {
    errors.date = 'Event date is required.';
  }

  if (!form.timePreset) {
    errors.timePreset = 'Event time is required.';
  }

  if (form.timePreset === 'other' && !form.startTime) {
    errors.startTime = 'Start time is required.';
  }

  if (form.timePreset === 'other' && !form.endTime) {
    errors.endTime = 'End time is required.';
  }

  if (!form.locationPreset) {
    errors.locationPreset = 'Location is required.';
  }

  if (!form.location.trim()) {
    errors.location = 'Location is required.';
  }

  if (!form.title.trim()) {
    errors.title = 'Event title is required.';
  }

  if (!form.description.trim()) {
    errors.description = 'Event description is required.';
  }

  if (form.isPaid === null) {
    errors.isPaid = 'Select whether this event has a fee.';
  }

  if (!form.capacityUnlimited && Number(form.capacity) < 0) {
    errors.capacity = 'Maximum capacity cannot be negative.';
  }

  if (!form.listingMode) {
    errors.listingMode = 'Select when to list this event.';
  }

  if (form.listingMode === 'future') {
    if (!form.visibleFrom) {
      errors.visibleFrom = 'Post listing date/time is required.';
    }

    if (!form.visibleUntil) {
      errors.visibleUntil = 'Remove listing date/time is required.';
    }
  }

  if (!form.registrationMode) {
    errors.registrationMode = 'Select when to enable registration.';
  }

  if (form.registrationMode === 'future') {
    if (!form.registrationOpenAt) {
      errors.registrationOpenAt = 'Registration enable date/time is required.';
    }

    if (!form.registrationCloseAt) {
      errors.registrationCloseAt = 'Registration disable date/time is required.';
    }
  }

  return errors;
}

function supportsSupplyList(eventType) {
  return eventType.startsWith('Class') || eventType === 'Workshop';
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

function stripFileExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

function getFileNameFromUrl(fileUrl) {
  try {
    const decodedPath = decodeURIComponent(new URL(fileUrl).pathname);
    return decodedPath.split('/').pop() || 'Uploaded PDF';
  } catch {
    return 'Uploaded PDF';
  }
}

export default EventForm;
