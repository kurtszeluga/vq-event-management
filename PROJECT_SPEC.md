VQ Event Management Module

Project Overview

The VQ Event Management Module is a Progressive Web App (PWA) for managing events, classes, workshops, meetings, retreats, and other activities.

The application will allow administrators to create and manage events while allowing users to browse events, register, and complete payments (when required).

The system should be designed so that a class is simply one type of event, making the application flexible for future expansion.

Event Types

* Classes
* Workshops
* Guest Speakers
* Retreats
* Meetings
* Community Events
* Fundraisers
* Special Events

⸻

Project Goals

* Simple for administrators to manage.
* Easy for members to register.
* Mobile-friendly.
* Fast and responsive.
* Secure.
* Automatically deployed through GitHub and Vercel.

⸻

Technology Stack

Frontend

* React
* Vite
* JavaScript
* React Router
* Progressive Web App (PWA)

Backend

* Firebase Authentication
* Firestore Database
* Firebase Storage (future)

Deployment

* GitHub
* Vercel

Payments

* Square Checkout

The preferred payment approach is Square-hosted Checkout, which simplifies PCI compliance and minimizes payment-processing complexity.

⸻

Development Philosophy

The project will be developed in small, well-tested phases.

Each phase should:

* Leave the application fully functional.
* Be committed to GitHub.
* Automatically deploy through Vercel.
* Build upon previous phases without major refactoring.

⸻

Development Roadmap

Phase 1 – Foundation

Objectives

* Create the React/Vite application.
* Configure React Router.
* Connect Firebase.
* Configure environment variables.
* Create reusable layout components.
* Build placeholder pages.
* Verify GitHub → Vercel automatic deployment.
* Configure the application as a Progressive Web App.

Initial Pages

* Home
* Events
* Event Details
* Register
* Login
* Admin Dashboard

No business logic should be implemented during Phase 1.

⸻

Phase 2 – Administrative Event Management

Administrator Features

* Secure administrator login
* Create events
* Edit events
* Delete events
* Publish/unpublish events
* View registrations
* Manage attendance
* Close registration

Event Fields

Required fields are marked with an asterisk.

* Event Type *
  * Class (Half Day)
  * Class (Full Day)
  * Workshop
  * Retreat
  * Lecture
  * Challenges
  * Business Listing
  * For Sale
* Event Date * in MM/DD/YYYY format
* Event Time *
  * Half day classes are from 1:30 p.m. to 4:30 p.m.
  * Full day classes are from 9:30 a.m. to 4:30 p.m.
  * Workshops are from 9:30 a.m. to 4:30 p.m.
  * Other
* Event Location *
  * Chota Rec Center Room "A", located at 145 Awohili Drive, Loudon, TN
  * Other
* Event Name *
* Presenter/Instructor Name
* Event Description *
* Event Photo/Image
  * Classes allow a maximum of two images.
  * If no image is supplied, that image slot remains blank.
* Supply List Upload
  * For classes and workshops.
  * PDF format only.
  * Display as a link in the event form.
* Payment
  * Cost of the event
  * Service fee, default $1.00
* Listing
  * List the event on the website now or in the future.
  * If listing in the future, store the date/time to post and remove the listing.
  * Enable event registration now or in the future.
  * If registration opens in the future, store the date/time to enable and disable registration.
* Maximum Capacity
* Additional Notes

⸻

Phase 3 – User Registration

User Features

Users can:

* Browse upcoming events
* View event details
* Register
* Receive confirmation
* View registration status (future)

Registration Information

* Name
* Email
* Phone Number
* Event
* Registration Date
* Payment Status

Future enhancements:

* Member accounts
* Registration history
* Waitlists
* Member discounts

⸻

Phase 4 – Payments and Reporting

Payment Features

* Square Checkout integration
* Payment tracking
* Payment confirmation
* Store Square transaction references

Reports

* Event roster
* Attendance report
* Payment report
* CSV export

⸻

Firebase Collections

events

Field	Description
eventId	Unique ID
title	Event title
description	Description
presenter	Presenter or instructor
date	Event date
startTime	Start time
endTime	End time
location	Event location
capacity	Maximum attendance
isPaid	Paid event flag
cost	Registration cost
status	Draft, Published, Closed, Cancelled
createdBy	Administrator
createdDate	Timestamp

⸻

registrations

Field	Description
registrationId	Unique ID
eventId	Linked event
userId	User ID (optional initially)
name	Registrant name
email	Email
phone	Phone
registrationDate	Timestamp
paymentStatus	Pending, Paid, Refunded
status	Registered, Cancelled, Waitlisted

⸻

users

Field	Description
userId	Firebase UID
name	Full name
email	Email
phone	Phone
role	Admin or User
status	Active or Inactive

⸻

payments

Field	Description
paymentId	Unique ID
registrationId	Registration reference
eventId	Event reference
amount	Payment amount
squareTransactionId	Square transaction ID
paymentStatus	Pending, Paid, Failed, Refunded
paymentDate	Timestamp

⸻

Recommended Project Structure

src/
│
├── assets/
├── components/
│   ├── common/
│   ├── layout/
│   ├── admin/
│   └── events/
│
├── hooks/
│
├── pages/
│   ├── Home.jsx
│   ├── Events.jsx
│   ├── EventDetails.jsx
│   ├── Register.jsx
│   ├── Login.jsx
│   └── AdminDashboard.jsx
│
├── services/
│   ├── firebase.js
│   ├── auth.js
│   ├── eventService.js
│   └── paymentService.js
│
├── utils/
│
├── App.jsx
├── main.jsx
└── routes.jsx

⸻

Security Requirements

* Firebase credentials must never be committed to GitHub.
* Store configuration using environment variables.
* Firestore Security Rules must enforce authorization.
* Administrative functions require authenticated administrator access.
* Users may only modify their own registrations.

⸻

User Experience Goals

The application should be:

* Responsive
* Mobile-friendly
* Easy to learn
* Fast
* Accessible
* Professional in appearance

⸻

Current Project Status

Completed

* Firebase project created: VQ Event Management
* Firestore database created
* Firebase Authentication enabled
* GitHub repository created: vq-event-management

Next Milestone

Build the Phase 1 Foundation, including:

1. React/Vite project
2. Routing
3. Firebase connection
4. Layout
5. Placeholder pages
6. GitHub integration
7. Automatic deployment through Vercel

⸻

Long-Term Vision

The VQ Event Management Module should become a reusable platform capable of managing virtually any type of event offered by the organization. Future enhancements may include:

* Calendar views
* QR code event check-in
* Email confirmations and reminders
* Waitlists
* Recurring events
* Member pricing
* Volunteer management
* Instructor management
* Analytics dashboard
* Printable attendance sheets
