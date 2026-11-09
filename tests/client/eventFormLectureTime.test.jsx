import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A Lecture collected no time at all until now: requiresTime, hasTime and the
// render gate all excluded it, so the field was absent, nothing was validated
// and startTime was blanked on save. It now behaves like the other scheduled
// types - the Time dropdown appears and opens on the Lecture entry from
// Configuration's Default Start/End Times.
//
// The Lecture entry is configured data, not a built-in: EVENT_TIME_OPTIONS
// ships half-day, full-day, workshop and other only. These tests supply it the
// way the real subscription does.

const LECTURE_DEFAULT = {
  value: 'lecture',
  label: 'Lectures Are From 1:00 P.M. To 3:00 P.M.',
  startTime: '13:00',
  endTime: '15:00'
};

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('../../src/services/eventService.js', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn()
}));
vi.mock('../../src/services/storageService.js', () => ({
  deleteEventFile: vi.fn(),
  uploadEventImage: vi.fn(),
  uploadEventPdf: vi.fn()
}));
vi.mock('../../src/services/configurationService.js', () => ({
  subscribeToActiveBusinessTypeDefaults: (onNext) => {
    onNext([]);
    return () => {};
  },
  subscribeToActiveEventLocationDefaults: (onNext) => {
    onNext([]);
    return () => {};
  },
  subscribeToActiveEventTimeDefaults: (onNext) => {
    onNext([LECTURE_DEFAULT]);
    return () => {};
  },
  subscribeToPaymentSettings: (onNext) => {
    onNext({ defaultServiceFee: 1 });
    return () => {};
  }
}));

const { DEFAULT_EVENT_FORM } = await import('../../src/data/eventOptions.js');
const { buildEventPayload, default: EventForm, validateEventForm } = await import('../../src/components/admin/EventForm.jsx');

afterEach(cleanup);

function renderForm(editingEvent) {
  const user = userEvent.setup();
  render(
    <EventForm
      editingEvent={editingEvent}
      onCancelEdit={vi.fn()}
      onSaved={vi.fn()}
      userProfile={{ id: 'admin-1' }}
    />
  );
  return user;
}

const lectureForm = {
  ...DEFAULT_EVENT_FORM,
  eventType: 'Lecture',
  title: 'Protecting Precious Quilts',
  description: 'How to store and handle an heirloom quilt.',
  date: '2026-11-13',
  locationPreset: 'other',
  location: 'Guild Hall',
  presenter: 'A Speaker',
  registrationMode: 'none'
};

describe('creating a Lecture', () => {
  it('shows the Time field, which it did not before', async () => {
    const user = renderForm();
    await user.selectOptions(screen.getByLabelText(/Event Type/), 'Lecture');

    expect(screen.getByLabelText(/Lecture Time/)).toBeTruthy();
  });

  it('opens on the configured Lecture default rather than Select One', async () => {
    const user = renderForm();
    await user.selectOptions(screen.getByLabelText(/Event Type/), 'Lecture');

    expect(screen.getByLabelText(/Lecture Time/).value).toBe('lecture');
  });

  it('still offers Other so a one-off lecture can set its own time', async () => {
    const user = renderForm();
    await user.selectOptions(screen.getByLabelText(/Event Type/), 'Lecture');
    await user.selectOptions(screen.getByLabelText(/Lecture Time/), 'other');

    expect(screen.getByLabelText(/Start Time/)).toBeTruthy();
    expect(screen.getByLabelText(/End Time/)).toBeTruthy();
  });
});

describe('editing a Lecture saved before it collected a time', () => {
  it('seeds the default instead of opening blank', async () => {
    // Every published Lecture is in this state - no timePreset, no startTime.
    // Without seeding, the admin would meet a newly required field with no
    // value and no indication of what it should be.
    renderForm({
      ...lectureForm,
      id: 'lecture-1',
      startTime: '',
      endTime: '',
      timePreset: ''
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Lecture Time/).value).toBe('lecture');
    });
  });

  it('leaves a lecture that already carries its own time alone', async () => {
    // Saved as Other with a specific time: seeding would overwrite a real
    // choice, so a truthy timePreset is left untouched.
    renderForm({
      ...lectureForm,
      id: 'lecture-2',
      startTime: '18:30',
      endTime: '20:00',
      timePreset: 'other'
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Lecture Time/).value).toBe('other');
    });
    expect(screen.getByLabelText(/Start Time/).value).toBe('18:30');
  });
});

describe('what a Lecture validates and saves', () => {
  it('requires a time, as the other scheduled types do', () => {
    const errors = validateEventForm({ ...lectureForm, timePreset: '' });

    expect(errors.timePreset).toBeTruthy();
  });

  it('passes with the default chosen', () => {
    const errors = validateEventForm({
      ...lectureForm,
      timePreset: 'lecture',
      startTime: '13:00',
      endTime: '15:00'
    });

    expect(errors.timePreset).toBeUndefined();
    expect(errors.startTime).toBeUndefined();
    expect(errors.endTime).toBeUndefined();
  });

  it('still rejects an end time at or before the start', () => {
    const errors = validateEventForm({
      ...lectureForm,
      timePreset: 'other',
      startTime: '15:00',
      endTime: '13:00'
    });

    expect(errors.endTime).toBeTruthy();
  });

  it('writes the times into the payload instead of blanking them', () => {
    // hasTime excluded Lecture, so startTime was dropped on save even when the
    // form held one. This is the assertion that would have caught that.
    const payload = buildEventPayload({
      ...lectureForm,
      timePreset: 'lecture',
      startTime: '13:00',
      endTime: '15:00'
    });

    expect(payload.startTime).toBe('13:00');
    expect(payload.endTime).toBe('15:00');
    expect(payload.timePreset).toBe('lecture');
  });
});

describe('the other types are unchanged', () => {
  it('a Challenge still collects no time', () => {
    const payload = buildEventPayload({
      ...DEFAULT_EVENT_FORM,
      eventType: 'Challenges',
      title: 'Row By Row',
      locationPreset: 'other',
      location: 'Guild Hall',
      registrationMode: 'none'
    });

    expect(payload.timePreset).toBe('other');
    expect(payload.startTime).toBe('00:00');
  });

  it('a Workshop still opens on its own default, not the Lecture one', async () => {
    const user = renderForm();
    await user.selectOptions(screen.getByLabelText(/Event Type/), 'Workshop');

    expect(screen.getByLabelText(/Workshop Time/).value).toBe('workshop');
  });
});
