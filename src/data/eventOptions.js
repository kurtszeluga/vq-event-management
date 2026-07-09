export const EVENT_TYPES = [
  'Class (Half Day)',
  'Class (Full Day)',
  'Workshop',
  'Retreat',
  'Lecture',
  'Challenges',
  'Business Listing',
  'For Sale'
];

export const EVENT_TIME_OPTIONS = [
  {
    value: 'half-day',
    label: 'Half day classes are from 1:30 p.m. to 4:30 p.m.',
    startTime: '13:30',
    endTime: '16:30'
  },
  {
    value: 'full-day',
    label: 'Full day classes are from 9:30 a.m. to 4:30 p.m.',
    startTime: '09:30',
    endTime: '16:30'
  },
  {
    value: 'workshop',
    label: 'Workshops are from 9:30 a.m. to 4:30 p.m.',
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
      'Chota Rec Center Room "A", located at 145 Awohili Drive, Loudon, TN'
  },
  {
    value: 'other',
    label: 'Other'
  }
];

export const DEFAULT_EVENT_FORM = {
  additionalNotes: '',
  capacity: '20',
  cost: '0',
  date: '',
  description: '',
  endTime: '16:30',
  eventType: 'Class (Half Day)',
  imageUrls: ['', ''],
  isPaid: false,
  listingMode: 'now',
  location: EVENT_LOCATIONS[0].label,
  locationPreset: EVENT_LOCATIONS[0].value,
  presenter: '',
  registrationCloseAt: '',
  registrationMode: 'now',
  registrationOpen: true,
  registrationOpenAt: '',
  serviceFee: '1.00',
  startTime: '13:30',
  status: 'Published',
  supplyListUrl: '',
  timePreset: 'half-day',
  title: '',
  visibleFrom: '',
  visibleUntil: ''
};
