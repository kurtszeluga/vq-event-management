import { MAX_EVENT_IMAGES } from '../../shared/eventImages.js';

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

// Shown on event cards in place of an uploaded photo. Business Listing and
// For Sale are intentionally excluded - those keep the plain empty state.
// Regenerate with scripts/generateEventPlaceholderImages.mjs.
const EVENT_TYPE_PLACEHOLDER_IMAGES = {
  'Class (Half Day)': '/assets/event-placeholders/class-half-day.svg',
  'Class (Full Day)': '/assets/event-placeholders/class-full-day.svg',
  Workshop: '/assets/event-placeholders/workshop.svg',
  Retreat: '/assets/event-placeholders/retreat.svg',
  Lecture: '/assets/event-placeholders/lecture.svg',
  Challenges: '/assets/event-placeholders/challenges.svg',
  Other: '/assets/event-placeholders/other.svg'
};

export function getEventPlaceholderImage(eventType) {
  return EVENT_TYPE_PLACEHOLDER_IMAGES[eventType] || null;
}

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
  capacity: '20',
  contactEmail: '',
  contactName: '',
  contactPhone: '',
  cost: '0',
  date: '',
  description: '',
  documentFileName: '',
  documentTitle: '',
  documentUrl: '',
  endTime: '',
  eventType: '',
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
  visibleUntil: ''
};
