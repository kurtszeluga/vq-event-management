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

const { BUSINESS_TYPES, DEFAULT_EVENT_FORM } = await import('../../src/data/eventOptions.js');
const { buildEventPayload } = await import('../../src/components/admin/EventForm.jsx');

describe('BUSINESS_TYPES built-ins', () => {
  it('ships the three groups the guild uses', () => {
    expect(BUSINESS_TYPES.map((type) => type.label)).toEqual([
      'Longarm Quilters',
      'Quilt Patterns',
      'Retreat Facilities'
    ]);
  });

  it('gives every built-in a slug value distinct from its label', () => {
    BUSINESS_TYPES.forEach((type) => {
      expect(type.value).toMatch(/^[a-z0-9-]+$/);
      expect(type.value).not.toBe(type.label);
    });
  });
});

describe('buildEventPayload business type fields', () => {
  const businessForm = (overrides) => ({
    ...DEFAULT_EVENT_FORM,
    eventType: 'Business Listing',
    businessName: 'Judy Egan Custom Quilting',
    ...overrides
  });

  it('carries both the value and the label', () => {
    const payload = buildEventPayload(
      businessForm({ businessType: 'longarm-quilters', businessTypeLabel: 'Longarm Quilters' }),
      false,
      false
    );

    expect(payload.businessType).toBe('longarm-quilters');
    expect(payload.businessTypeLabel).toBe('Longarm Quilters');
  });

  // The label is stored, not derived, because businessTypeDefaults is
  // admin-read-only - the public listing page and the GoDaddy feed have no way
  // to turn a value into a label.
  it('keeps the label so public surfaces need no lookup', () => {
    const payload = buildEventPayload(
      businessForm({ businessType: 'retreat-facilities', businessTypeLabel: 'Retreat Facilities' }),
      false,
      false
    );

    expect(payload.businessTypeLabel).toBe('Retreat Facilities');
  });

  it('leaves both empty when no type is chosen', () => {
    const payload = buildEventPayload(businessForm(), false, false);

    expect(payload.businessType).toBe('');
    expect(payload.businessTypeLabel).toBe('');
  });

  it('strips both for any other event type', () => {
    const payload = buildEventPayload(
      {
        ...DEFAULT_EVENT_FORM,
        eventType: 'For Sale',
        businessType: 'longarm-quilters',
        businessTypeLabel: 'Longarm Quilters'
      },
      false,
      false
    );

    expect(payload.businessType).toBe('');
    expect(payload.businessTypeLabel).toBe('');
  });
});
