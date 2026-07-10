import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EVENT_FORM,
  EVENT_LOCATIONS,
  EVENT_TIME_OPTIONS,
  EVENT_TYPES
} from '../../data/eventOptions.js';
import { createEvent, updateEvent } from '../../services/eventService.js';
import { pickGoogleDriveFile } from '../../services/googleDrivePicker.js';

const eventTypeTimePresetMap = {
  'Class (Half Day)': 'half-day',
  'Class (Full Day)': 'full-day',
  Workshop: 'workshop'
};

function EventForm({ editingEvent, onCancelEdit, onSaved, userProfile }) {
  const [form, setForm] = useState(DEFAULT_EVENT_FORM);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [pickingField, setPickingField] = useState('');
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(editingEvent);

  useEffect(() => {
    setForm(getInitialForm(editingEvent));
  }, [editingEvent]);

  const selectedTimeOption = useMemo(
    () => EVENT_TIME_OPTIONS.find((option) => option.value === form.timePreset),
    [form.timePreset]
  );
  const showSupplyListUpload = supportsSupplyList(form.eventType);

  function updateField(name, value) {
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
    const option = EVENT_TIME_OPTIONS.find((item) => item.value === value);
    setForm((current) => ({
      ...current,
      timePreset: value,
      startTime: option?.startTime || current.startTime,
      endTime: option?.endTime || current.endTime
    }));
  }

  function handleEventType(value) {
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
      supplyListUrl: supportsSupplyList(value) ? current.supplyListUrl : ''
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.eventType;
      return next;
    });
  }

  function handleLocationPreset(value) {
    const location = EVENT_LOCATIONS.find((item) => item.value === value);
    setForm((current) => ({
      ...current,
      location: value === 'other' ? '' : location?.label || '',
      locationPreset: value
    }));
  }

  function handleImageUrl(index, value) {
    setForm((current) => {
      const imageUrls = [...current.imageUrls];
      imageUrls[index] = value;
      return { ...current, imageUrls };
    });
  }

  function handleFeeSelection(value) {
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
    setPickingField('');
  }

  async function handleDriveSelection(fieldName, options = {}) {
    setError('');
    setPickingField(fieldName);

    try {
      const selectedFile = await pickGoogleDriveFile({
        mimeTypes: options.mimeTypes
      });

      if (!selectedFile) {
        return;
      }

      if (options.imageIndex !== undefined) {
        handleImageUrl(options.imageIndex, selectedFile.imageUrl);
      } else {
        updateField(fieldName, selectedFile.url);
      }
    } catch (pickerError) {
      setError(pickerError.message);
    } finally {
      setPickingField('');
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
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
      supplyListUrl: showSupplyListUpload ? form.supplyListUrl.trim() : '',
      timePreset: form.timePreset,
      title: toTitleCase(form.title.trim()),
      type: form.eventType,
      visibleFrom: form.visibleFrom,
      visibleUntil: form.visibleUntil
    };

    try {
      if (isEditing) {
        await updateEvent(editingEvent.id, payload);
      } else {
        await createEvent({
          ...payload,
          createdBy: userProfile?.email || userProfile?.userId || 'admin'
        });
      }

      setForm(DEFAULT_EVENT_FORM);
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
            <option aria-label="Select Event Type" value="" />
            {EVENT_TYPES.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Event Name *</span>
          <input
            className={fieldErrors.title ? 'field-invalid' : ''}
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            onBlur={(event) => updateField('title', toTitleCase(event.target.value))}
          />
        </label>

        <label>
          <span>Event Date *</span>
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
            <span>Event Time *</span>
            <select
              className={fieldErrors.timePreset ? 'field-invalid' : ''}
              value={form.timePreset}
              onChange={(event) => handleTimePreset(event.target.value)}
            >
              <option aria-label="Select Event Time" value="" />
              {EVENT_TIME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row-pair nested-fields">
            <label>
              <span>Start</span>
              <input
                className={fieldErrors.startTime ? 'field-invalid' : ''}
                disabled={selectedTimeOption?.value !== 'other'}
                type="time"
                value={form.startTime}
                onChange={(event) => updateField('startTime', event.target.value)}
              />
            </label>
            <label>
              <span>End</span>
              <input
                className={fieldErrors.endTime ? 'field-invalid' : ''}
                disabled={selectedTimeOption?.value !== 'other'}
                type="time"
                value={form.endTime}
                onChange={(event) => updateField('endTime', event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="form-stack-group">
          <label>
            <span>Event Location *</span>
            <select
              className={fieldErrors.locationPreset ? 'field-invalid' : ''}
              value={form.locationPreset}
              onChange={(event) => handleLocationPreset(event.target.value)}
            >
              <option aria-label="Select Event Location" value="" />
              {EVENT_LOCATIONS.map((location) => (
                <option key={location.value} value={location.value}>
                  {location.label}
                </option>
              ))}
            </select>
          </label>

          {form.locationPreset === 'other' ? (
            <label className="nested-fields">
              <span>Other Location *</span>
              <input
                className={fieldErrors.location ? 'field-invalid' : ''}
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
          <span>Presenter/Instructor Name</span>
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
                  type="checkbox"
                  onChange={(event) =>
                    updateField('capacityUnlimited', event.target.checked)
                  }
                />
                <span>Unlimited Capacity</span>
              </label>
            </div>
            <label>
              <span>Maximum Capacity</span>
              <input
                className={fieldErrors.capacity ? 'field-invalid' : ''}
                disabled={form.capacityUnlimited}
                min="0"
                step="1"
                type="number"
                value={form.capacity}
                onChange={(event) => updateField('capacity', event.target.value)}
              />
            </label>
          </div>
        </div>

        <label className="form-span">
          <span>Event Description *</span>
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
            <label key={index}>
              <span>Event Photo/Image</span>
              <input
                placeholder="Image URL"
                type="url"
                value={form.imageUrls[index]}
                onChange={(event) => handleImageUrl(index, event.target.value)}
              />
              <span className="form-help">
                Use JPG or WebP, 1600 x 1200 pixels max, 1 MB max.
              </span>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  handleDriveSelection(`image-${index}`, {
                    imageIndex: index,
                    mimeTypes: 'image/png,image/jpeg,image/gif,image/webp'
                  })
                }
              >
                {pickingField === `image-${index}`
                  ? 'Opening Google Drive...'
                  : 'Select From Google Drive'}
              </button>
            </label>
          ))}
          {showSupplyListUpload ? (
            <label className="form-span">
              <span>Supply List PDF Link (Optional)</span>
              <input
                placeholder="PDF Link"
                type="url"
                value={form.supplyListUrl}
                onChange={(event) =>
                  updateField('supplyListUrl', event.target.value)
                }
              />
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  handleDriveSelection('supplyListUrl', {
                    mimeTypes: 'application/pdf'
                  })
                }
              >
                {pickingField === 'supplyListUrl'
                  ? 'Opening Google Drive...'
                  : 'Select From Google Drive'}
              </button>
            </label>
          ) : null}
        </div>
      </div>

      <div className="form-subsection">
        <h3>Event Fees</h3>
        <div className="form-grid compact">
          <div className={`radio-field ${fieldErrors.isPaid ? 'field-invalid' : ''}`}>
            <span>Is There A Fee For This Event? *</span>
            <div className="radio-options">
              <label className="checkbox-label">
                <input
                  checked={form.isPaid === true}
                  name="isPaid"
                  type="radio"
                  onChange={() => handleFeeSelection(true)}
                />
                <span>Yes</span>
              </label>
              <label className="checkbox-label">
                <input
                  checked={form.isPaid === false}
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
                value={form.listingMode}
                onChange={(event) => updateField('listingMode', event.target.value)}
              >
                <option aria-label="Select Listing Timing" value="" />
                <option value="now">Now</option>
                <option value="future">In The Future</option>
              </select>
            </label>
            {form.listingMode === 'future' ? (
              <div className="form-row-pair nested-fields">
                <label>
                  <span>Post Listing</span>
                  <input
                    className={fieldErrors.visibleFrom ? 'field-invalid' : ''}
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
                value={form.registrationMode}
                onChange={(event) =>
                  updateField('registrationMode', event.target.value)
                }
              >
                <option aria-label="Select Registration Timing" value="" />
                <option value="now">Now</option>
                <option value="future">In The Future</option>
              </select>
            </label>
            {form.registrationMode === 'future' ? (
              <div className="form-row-pair nested-fields">
                <label>
                  <span>Enable Registration</span>
                  <input
                    className={
                      fieldErrors.registrationOpenAt ? 'field-invalid' : ''
                    }
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
      <div className="form-actions">
        <button
          className="button-link button-reset"
          disabled={saving || Boolean(pickingField)}
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

  if (!form.startTime) {
    errors.startTime = 'Start time is required.';
  }

  if (!form.endTime) {
    errors.endTime = 'End time is required.';
  }

  if (!form.locationPreset) {
    errors.locationPreset = 'Location is required.';
  }

  if (!form.location.trim()) {
    errors.location = 'Location is required.';
  }

  if (!form.title.trim()) {
    errors.title = 'Event name is required.';
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

export default EventForm;
