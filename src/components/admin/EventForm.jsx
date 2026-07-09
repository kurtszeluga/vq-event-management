import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EVENT_FORM,
  EVENT_LOCATIONS,
  EVENT_TIME_OPTIONS,
  EVENT_TYPES
} from '../../data/eventOptions.js';
import { createEvent, updateEvent } from '../../services/eventService.js';

const eventTypeTimePresetMap = {
  'Class (Half Day)': 'half-day',
  'Class (Full Day)': 'full-day',
  Workshop: 'workshop'
};

function EventForm({ editingEvent, onCancelEdit, onSaved, userProfile }) {
  const [form, setForm] = useState(DEFAULT_EVENT_FORM);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(editingEvent);

  useEffect(() => {
    if (editingEvent) {
      setForm({
        ...DEFAULT_EVENT_FORM,
        ...editingEvent,
        capacity: String(editingEvent.capacity ?? 0),
        cost: String(editingEvent.cost ?? 0),
        imageUrls: [
          editingEvent.imageUrls?.[0] || '',
          editingEvent.imageUrls?.[1] || ''
        ],
        serviceFee: String(editingEvent.serviceFee ?? '1.00')
      });
    } else {
      setForm(DEFAULT_EVENT_FORM);
    }
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
      locationPreset: isClassOrWorkshop ? EVENT_LOCATIONS[0].value : 'other',
      timePreset: nextTimeOption?.value || 'other',
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
      capacity: Number(form.capacity || 0),
      cost: Number(form.cost || 0),
      date: form.date,
      description: form.description.trim(),
      endTime: form.endTime,
      eventType: form.eventType,
      imageUrls: form.imageUrls.map((url) => url.trim()).filter(Boolean).slice(0, 2),
      isPaid: Boolean(form.isPaid),
      listingMode: form.listingMode,
      location: toTitleCase(form.location.trim()),
      locationPreset: form.locationPreset,
      presenter: toTitleCase(form.presenter.trim()),
      registrationCloseAt: form.registrationCloseAt,
      registrationMode: form.registrationMode,
      registrationOpen: Boolean(form.registrationOpen),
      registrationOpenAt: form.registrationOpenAt,
      serviceFee: Number(form.serviceFee || 0),
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
        <h2>{isEditing ? 'Edit Event' : 'Create Event'}</h2>
        {isEditing ? (
          <button className="text-button" type="button" onClick={onCancelEdit}>
            Cancel Edit
          </button>
        ) : null}
      </div>

      <div className="form-grid">
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
          <span>Event Type *</span>
          <select
            className={fieldErrors.eventType ? 'field-invalid' : ''}
            value={form.eventType}
            onChange={(event) => handleEventType(event.target.value)}
          >
            {EVENT_TYPES.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </select>
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

        <label>
          <span>Event Time *</span>
          <select
            className={fieldErrors.timePreset ? 'field-invalid' : ''}
            value={form.timePreset}
            onChange={(event) => handleTimePreset(event.target.value)}
          >
            {EVENT_TIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="form-row-pair">
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

        <label>
          <span>Event Location *</span>
          <select
            className={fieldErrors.locationPreset ? 'field-invalid' : ''}
            value={form.locationPreset}
            onChange={(event) => handleLocationPreset(event.target.value)}
          >
            {EVENT_LOCATIONS.map((location) => (
              <option key={location.value} value={location.value}>
                {location.label}
              </option>
            ))}
          </select>
        </label>

        {form.locationPreset === 'other' ? (
          <label>
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

        <label>
          <span>Maximum Capacity</span>
          <input
            className={fieldErrors.capacity ? 'field-invalid' : ''}
            min="0"
            step="1"
            type="number"
            value={form.capacity}
            onChange={(event) => updateField('capacity', event.target.value)}
          />
        </label>

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
        <h3>Images And Documents</h3>
        <div className="form-grid">
          {[0, 1].map((index) => (
            <label key={index}>
              <span>Event Photo/Image {index + 1}</span>
              <input
                placeholder="Image URL"
                type="url"
                value={form.imageUrls[index]}
                onChange={(event) => handleImageUrl(index, event.target.value)}
              />
            </label>
          ))}
          {showSupplyListUpload ? (
            <label className="form-span">
              <span>Supply List Upload</span>
              <input
                placeholder="PDF link"
                type="url"
                value={form.supplyListUrl}
                onChange={(event) =>
                  updateField('supplyListUrl', event.target.value)
                }
              />
            </label>
          ) : null}
        </div>
      </div>

      <div className="form-subsection">
        <h3>Payment</h3>
        <div className="form-grid compact">
          <label className="checkbox-label">
            <input
              checked={form.isPaid}
              type="checkbox"
              onChange={(event) => updateField('isPaid', event.target.checked)}
            />
            <span>Paid Event</span>
          </label>
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
              onChange={(event) => updateField('serviceFee', event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="form-subsection">
        <h3>Listing And Registration</h3>
        <div className="form-grid">
          <label>
            <span>List On Website</span>
            <select
              value={form.listingMode}
              onChange={(event) => updateField('listingMode', event.target.value)}
            >
              <option value="now">Now</option>
              <option value="future">In The Future</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={form.status}
              onChange={(event) => updateField('status', event.target.value)}
            >
              <option value="Draft">Draft</option>
              <option value="Published">Published</option>
              <option value="Closed">Closed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </label>
          {form.listingMode === 'future' ? (
            <>
              <label>
                <span>Post Listing</span>
                <input
                  className={fieldErrors.visibleFrom ? 'field-invalid' : ''}
                  type="datetime-local"
                  value={form.visibleFrom}
                  onChange={(event) => updateField('visibleFrom', event.target.value)}
                />
              </label>
              <label>
                <span>Remove Listing</span>
                <input
                  className={fieldErrors.visibleUntil ? 'field-invalid' : ''}
                  type="datetime-local"
                  value={form.visibleUntil}
                  onChange={(event) => updateField('visibleUntil', event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label>
            <span>Enable Event Registration</span>
            <select
              value={form.registrationMode}
              onChange={(event) =>
                updateField('registrationMode', event.target.value)
              }
            >
              <option value="now">Now</option>
              <option value="future">In The Future</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              checked={form.registrationOpen}
              type="checkbox"
              onChange={(event) =>
                updateField('registrationOpen', event.target.checked)
              }
            />
            <span>Registration Open</span>
          </label>
          {form.registrationMode === 'future' ? (
            <>
              <label>
                <span>Enable Registration</span>
                <input
                  className={fieldErrors.registrationOpenAt ? 'field-invalid' : ''}
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
                  className={fieldErrors.registrationCloseAt ? 'field-invalid' : ''}
                  type="datetime-local"
                  value={form.registrationCloseAt}
                  onChange={(event) =>
                    updateField('registrationCloseAt', event.target.value)
                  }
                />
              </label>
            </>
          ) : null}
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      <button className="button-link button-reset" disabled={saving} type="submit">
        {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Event'}
      </button>
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

  if (Number(form.capacity) < 0) {
    errors.capacity = 'Maximum capacity cannot be negative.';
  }

  if (form.listingMode === 'future') {
    if (!form.visibleFrom) {
      errors.visibleFrom = 'Post listing date/time is required.';
    }

    if (!form.visibleUntil) {
      errors.visibleUntil = 'Remove listing date/time is required.';
    }
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
