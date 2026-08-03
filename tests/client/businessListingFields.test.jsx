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

const { DEFAULT_EVENT_FORM } = await import('../../src/data/eventOptions.js');
const { buildListingDetails, formatWebsiteLabel, normalizeWebsiteUrl } = await import(
  '../../shared/eventListing.js'
);
const { buildEventPayload, isPlausibleWebsite, validateEventForm } = await import(
  '../../src/components/admin/EventForm.jsx'
);

const businessEvent = (overrides) => ({
  eventType: 'Business Listing',
  ownerName: 'Judy Egan',
  businessName: 'Judy Egan Custom Quilting',
  contactEmail: 'judy@example.org',
  contactPhone: '(555) 660-1120',
  address: '84 Mill Street',
  ...overrides
});

const labelsOf = (event) => buildListingDetails(event).map((detail) => detail.label);

describe('normalizeWebsiteUrl', () => {
  it('adds a scheme to a bare host, so the href is not read as a relative path', () => {
    expect(normalizeWebsiteUrl('villagequilters.com')).toBe('https://villagequilters.com');
  });

  it('leaves an existing scheme alone, including http', () => {
    expect(normalizeWebsiteUrl('https://example.org')).toBe('https://example.org');
    expect(normalizeWebsiteUrl('http://example.org')).toBe('http://example.org');
  });

  it('returns empty for nothing', () => {
    expect(normalizeWebsiteUrl('')).toBe('');
    expect(normalizeWebsiteUrl(undefined)).toBe('');
  });
});

describe('formatWebsiteLabel', () => {
  it('strips the scheme and any trailing slash', () => {
    expect(formatWebsiteLabel('https://villagequilters.com/')).toBe('villagequilters.com');
    expect(formatWebsiteLabel('http://example.org')).toBe('example.org');
  });

  it('leaves a bare host untouched', () => {
    expect(formatWebsiteLabel('example.org')).toBe('example.org');
  });
});

describe('buildListingDetails for a Business Listing', () => {
  it('drops the Specialty row entirely when there is none', () => {
    expect(labelsOf(businessEvent())).not.toContain('Specialty');
  });

  it('includes Specialty when set', () => {
    expect(labelsOf(businessEvent({ specialty: 'Custom Quilting' }))).toContain('Specialty');
  });

  it('drops the Website row when there is none', () => {
    expect(labelsOf(businessEvent())).not.toContain('Website');
  });

  it('renders Website as a link with the scheme added and the host as the label', () => {
    const details = buildListingDetails(businessEvent({ website: 'villagequilters.com' }));
    const website = details.find((detail) => detail.label === 'Website');

    expect(website).toEqual({
      href: 'https://villagequilters.com',
      label: 'Website',
      link: 'website',
      value: 'villagequilters.com'
    });
  });

  it('still fills required fields with TBD text when they are missing', () => {
    const details = buildListingDetails({ eventType: 'Business Listing' });
    const byLabel = Object.fromEntries(details.map((d) => [d.label, d.value]));

    expect(byLabel.Owner).toBe('Owner TBD');
    expect(byLabel.Address).toBe('Address TBD');
  });
});

describe('Business Listing validation', () => {
  const form = (overrides) => ({
    ...DEFAULT_EVENT_FORM,
    eventType: 'Business Listing',
    ownerName: 'Judy Egan',
    businessName: 'Judy Egan Custom Quilting',
    contactEmail: 'judy@example.org',
    contactPhone: '(555) 660-1120',
    address: '84 Mill Street',
    ...overrides
  });

  it('no longer requires a description', () => {
    expect(validateEventForm(form({ description: '' })).description).toBeUndefined();
  });

  it('no longer requires a specialty', () => {
    expect(validateEventForm(form({ specialty: '' })).specialty).toBeUndefined();
  });

  it('still requires a description on every other type', () => {
    const workshop = { ...form(), eventType: 'Workshop', description: '' };

    expect(validateEventForm(workshop).description).toBe('Event description is required.');
  });

  it('accepts an empty website', () => {
    expect(validateEventForm(form({ website: '' })).website).toBeUndefined();
  });

  it('accepts a bare host and a full URL', () => {
    expect(validateEventForm(form({ website: 'villagequilters.com' })).website).toBeUndefined();
    expect(validateEventForm(form({ website: 'https://example.org/shop' })).website).toBeUndefined();
  });

  it('rejects something that could not be an address', () => {
    expect(validateEventForm(form({ website: 'not a website' })).website)
      .toBe('Enter a website like villagequilters.com');
  });
});

describe('isPlausibleWebsite', () => {
  it('accepts hosts, subdomains, schemes and paths', () => {
    ['example.org', 'www.example.org', 'https://example.org', 'example.co.uk/shop']
      .forEach((value) => expect(isPlausibleWebsite(value)).toBe(true));
  });

  it('rejects values with no dot or with spaces', () => {
    ['example', 'not a website', 'a b.com', ''].forEach((value) =>
      expect(isPlausibleWebsite(value)).toBe(false)
    );
  });
});

describe('buildEventPayload website field', () => {
  it('carries the website for a business listing', () => {
    const form = {
      ...DEFAULT_EVENT_FORM,
      eventType: 'Business Listing',
      website: '  villagequilters.com  '
    };

    expect(buildEventPayload(form, false, false).website).toBe('villagequilters.com');
  });

  it('strips it for any other type', () => {
    const form = {
      ...DEFAULT_EVENT_FORM,
      eventType: 'For Sale',
      website: 'villagequilters.com'
    };

    expect(buildEventPayload(form, false, false).website).toBe('');
  });
});
