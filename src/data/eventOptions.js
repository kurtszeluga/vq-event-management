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
  capacity: '20',
  cost: '0',
  date: '',
  description: '',
  endTime: '',
  eventType: '',
  capacityUnlimited: false,
  imageUrls: [''],
  isPaid: null,
  listingMode: 'now',
  location: '',
  locationPreset: 'other',
  presenter: '',
  registrationCloseAt: '',
  registrationMode: 'now',
  registrationOpen: true,
  registrationOpenAt: '',
  serviceFee: '1.00',
  startTime: '',
  status: 'Published',
  supplyListUrl: '',
  timePreset: 'other',
  title: '',
  visibleFrom: '',
  visibleUntil: ''
};
