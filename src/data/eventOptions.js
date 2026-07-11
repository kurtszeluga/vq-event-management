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
  imageUrls: [''],
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
