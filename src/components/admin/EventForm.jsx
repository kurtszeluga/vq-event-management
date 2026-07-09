import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EVENT_FORM,
  EVENT_LOCATIONS,
  EVENT_TIME_OPTIONS,
  EVENT_TYPES
} from '../../data/eventOptions.js';
import { createEvent, updateEvent } from '../../services/eventService.js';

const datePattern = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;

function EventForm({ editingEvent, onCancelEdit, onSaved, userProfile }) {
  const [form, setForm] = useState(DEFAULT_EVENT_FORM);
  const [error, setError] = useState('');
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

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
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

    if (!datePattern.test(form.date)) {
      setError('Event Date must use MM/DD/YYYY format.');
      return;
    }

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
      location: form.location.trim(),
      locationPreset: form.locationPreset,
      presenter: form.presenter.trim(),
      registrationCloseAt: form.registrationCloseAt,
      registrationMode: form.registrationMode,
      registrationOpen: Boolean(form.registrationOpen),
      registrationOpenAt: form.registrationOpenAt,
      serviceFee: Number(form.serviceFee || 0),
      startTime: form.startTime,
      status: form.status,
      supplyListUrl: form.supplyListUrl.trim(),
      timePreset: form.timePreset,
      title: form.title.trim(),
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
    <form className="admin-form" onSubmit={handleSubmit}>
      <div className="form-section-header">
        <h2>{isEditing ? 'Edit event' : 'Create event'}</h2>
        {isEditing ? (
          <button className="text-button" type="button" onClick={onCancelEdit}>
            Cancel edit
          </button>
        ) : null}
      </div>

      <div className="form-grid">
        <label>
          <span>Event type *</span>
          <select
            required
            value={form.eventType}
            onChange={(event) => updateField('eventType', event.target.value)}
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
            placeholder="MM/DD/YYYY"
            required
            value={form.date}
            onChange={(event) => updateField('date', event.target.value)}
          />
        </label>

        <label>
          <span>Event Time *</span>
          <select
            required
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
              disabled={selectedTimeOption?.value !== 'other'}
              type="time"
              value={form.startTime}
              onChange={(event) => updateField('startTime', event.target.value)}
            />
          </label>
          <label>
            <span>End</span>
            <input
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
            required
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
            <span>Other location *</span>
            <input
              required
              value={form.location}
              onChange={(event) => updateField('location', event.target.value)}
            />
          </label>
        ) : null}

        <label>
          <span>Event Name *</span>
          <input
            required
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
          />
        </label>

        <label>
          <span>Presenter/Instructor Name</span>
          <input
            value={form.presenter}
            onChange={(event) => updateField('presenter', event.target.value)}
          />
        </label>

        <label>
          <span>Maximum capacity</span>
          <input
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
            required
            rows="5"
            value={form.description}
            onChange={(event) => updateField('description', event.target.value)}
          />
        </label>
      </div>

      <div className="form-subsection">
        <h3>Images and documents</h3>
        <div className="form-grid">
          {[0, 1].map((index) => (
            <label key={index}>
              <span>Event photo/image {index + 1}</span>
              <input
                placeholder="Image URL"
                type="url"
                value={form.imageUrls[index]}
                onChange={(event) => handleImageUrl(index, event.target.value)}
              />
            </label>
          ))}
          <label className="form-span">
            <span>Supply List Upload</span>
            <input
              placeholder="PDF link"
              type="url"
              value={form.supplyListUrl}
              onChange={(event) => updateField('supplyListUrl', event.target.value)}
            />
          </label>
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
            <span>Paid event</span>
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
            <span>Service fee</span>
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
        <h3>Listing and registration</h3>
        <div className="form-grid">
          <label>
            <span>List on website</span>
            <select
              value={form.listingMode}
              onChange={(event) => updateField('listingMode', event.target.value)}
            >
              <option value="now">Now</option>
              <option value="future">In the future</option>
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
                <span>Post listing</span>
                <input
                  type="datetime-local"
                  value={form.visibleFrom}
                  onChange={(event) => updateField('visibleFrom', event.target.value)}
                />
              </label>
              <label>
                <span>Remove listing</span>
                <input
                  type="datetime-local"
                  value={form.visibleUntil}
                  onChange={(event) => updateField('visibleUntil', event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label>
            <span>Enable event registration</span>
            <select
              value={form.registrationMode}
              onChange={(event) =>
                updateField('registrationMode', event.target.value)
              }
            >
              <option value="now">Now</option>
              <option value="future">In the future</option>
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
            <span>Registration open</span>
          </label>
          {form.registrationMode === 'future' ? (
            <>
              <label>
                <span>Enable registration</span>
                <input
                  type="datetime-local"
                  value={form.registrationOpenAt}
                  onChange={(event) =>
                    updateField('registrationOpenAt', event.target.value)
                  }
                />
              </label>
              <label>
                <span>Disable registration</span>
                <input
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
        {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Create event'}
      </button>
    </form>
  );
}

export default EventForm;
