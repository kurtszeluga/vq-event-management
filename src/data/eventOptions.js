import { MAX_EVENT_IMAGES } from '../../shared/eventImages.js';

export { getEventPlaceholderImage } from '../../shared/eventImages.js';

// Types that can legitimately run without any registration - a Workshop is
// often just an open session members turn up to. These are the only types
// offered a None option in EventForm, and the list is read twice there: once
// to render the option, once to clear a stale 'none' when the type changes to
// one that does not offer it.
export const NO_REGISTRATION_EVENT_TYPES = ['Other', 'Workshop'];

export const EVENT_TYPES = [
  'Class (Half Day)',
  'Class (Full Day)',
  'Workshop',
  'Retreat',
  'Lecture',
  'Challenges',
  'Business Listing',
  'For Sale',
  'Other'
];

export const EVENT_TIME_OPTIONS = [
  {
    value: 'half-day',
    label: 'Half Day Classes Are From 1:30 P.M. To 4:30 P.M.',
    startTime: '13:30',
    endTime: '16:30'
  },
  {
    value: 'full-day',
    label: 'Full Day Classes Are From 9:30 A.M. To 4:30 P.M.',
    startTime: '09:30',
    endTime: '16:30'
  },
  {
    value: 'workshop',
    label: 'Workshops Are From 9:30 A.M. To 4:30 P.M.',
    startTime: '09:30',
    endTime: '16:30'
  },
  {
    value: 'other',
    label: 'Other',
    startTime: '',
    endTime: ''
  }
];

// Built-in fallbacks for the Business Listing type dropdown. Super Users
// extend or replace this list from Configuration; these are what the dropdown
// offers before anything has been configured, and they stay available as
// built-in defaults afterwards.
export const BUSINESS_TYPES = [
  { label: 'Longarm Quilters', value: 'longarm-quilters' },
  { label: 'Quilt Patterns', value: 'quilt-patterns' },
  { label: 'Retreat Facilities', value: 'retreat-facilities' }
];

export const EVENT_LOCATIONS = [
  {
    value: 'chota-rec-center-room-a',
    label:
      'Chota Rec Center Room "A", Located At 145 Awohili Drive, Loudon, TN'
  },
  {
    value: 'other',
    label: 'Other'
  }
];

export const DEFAULT_EVENT_FORM = {
  additionalNotes: '',
  allowCashCheckPayment: false,
  allowNonMemberRegistration: false,
  address: '',
  askingPrice: '',
  businessName: '',
  // Business Listing only - which group the business belongs to, from the
  // configurable list in BUSINESS_TYPES / businessTypeDefaults.
  businessType: '',
  // The label is stored with the value because businessTypeDefaults is
  // admin-read-only - public surfaces cannot resolve one into the other.
  businessTypeLabel: '',
  capacity: '20',
  cashCheckOnly: false,
  contactEmail: '',
  contactName: '',
  contactPhone: '',
  cost: '0',
  date: '',
  description: '',
  documentFileName: '',
  documentTitle: '',
  documentUrl: '',
  // A retreat runs across days, so it pairs an end date with `date`. Every
  // other type leaves this empty and reads as a single-day event.
  endDate: '',
  endTime: '',
  eventType: '',
  // Go-live transition: when set, the Register button links here instead of
  // registering in this app. Remove with the EventForm field.
  externalRegistrationUrl: '',
  capacityUnlimited: false,
  imageUrls: Array(MAX_EVENT_IMAGES).fill(''),
  isPaid: null,
  listingMode: '',
  location: '',
  locationPreset: '',
  ownerName: '',
  presenter: '',
  registrationCloseAt: '',
  registrationMode: '',
  registrationOpen: false,
  registrationOpenAt: '',
  serviceFee: '1.00',
  specialty: '',
  startTime: '',
  status: 'Published',
  supplyListFileName: '',
  supplyListTitle: '',
  supplyListUrl: '',
  timePreset: '',
  title: '',
  visibleFrom: '',
  visibleUntil: '',
  // Business Listing only, and optional - stored exactly as typed, with the
  // scheme added at render time by normalizeWebsiteUrl.
  website: ''
};
