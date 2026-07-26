import { describe, expect, it, vi } from 'vitest';

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

const { MAX_EVENT_IMAGES } = await import('../../shared/eventImages.js');
const { DEFAULT_EVENT_FORM } = await import('../../src/data/eventOptions.js');
const { buildEventPayload, getInitialForm } = await import('../../src/components/admin/EventForm.jsx');

describe('event image slots (up to MAX_EVENT_IMAGES)', () => {
  it('MAX_EVENT_IMAGES is 4, and the default form starts with that many empty slots', () => {
    expect(MAX_EVENT_IMAGES).toBe(4);
    expect(DEFAULT_EVENT_FORM.imageUrls).toEqual(['', '', '', '']);
  });

  it('buildEventPayload trims, drops blanks, and caps at MAX_EVENT_IMAGES even if more were somehow supplied', () => {
    const form = {
      ...DEFAULT_EVENT_FORM,
      imageUrls: [' photo-1.jpg ', '', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg', 'photo-5.jpg']
    };

    const payload = buildEventPayload(form, false, false);

    expect(payload.imageUrls).toEqual(['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg']);
  });

  it('buildEventPayload keeps fewer than MAX_EVENT_IMAGES as-is', () => {
    const form = { ...DEFAULT_EVENT_FORM, imageUrls: ['photo-1.jpg', '', '', ''] };

    expect(buildEventPayload(form, false, false).imageUrls).toEqual(['photo-1.jpg']);
  });

  it('getInitialForm for a brand-new event starts with MAX_EVENT_IMAGES empty slots', () => {
    const form = getInitialForm(null, 'Workshop');

    expect(form.imageUrls).toEqual(['', '', '', '']);
  });

  it('getInitialForm pads a stored event with fewer images up to MAX_EVENT_IMAGES editable slots', () => {
    const form = getInitialForm({ eventType: 'Workshop', imageUrls: ['photo-1.jpg'] });

    expect(form.imageUrls).toEqual(['photo-1.jpg', '', '', '']);
  });

  it('getInitialForm loads all MAX_EVENT_IMAGES when a stored event has that many', () => {
    const form = getInitialForm({
      eventType: 'Workshop',
      imageUrls: ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg']
    });

    expect(form.imageUrls).toEqual(['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg']);
  });

  it('getInitialForm only loads the first MAX_EVENT_IMAGES from legacy data with more stored', () => {
    const form = getInitialForm({
      eventType: 'Workshop',
      imageUrls: ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg', 'photo-5.jpg']
    });

    expect(form.imageUrls).toEqual(['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg']);
  });
});
