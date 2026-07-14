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
* Registration actions should live inside the event module, not as a standalone main navigation item.
* Admin navigation is only visible to signed-in admin users.
* Event listing cards should stay compact, omit service fees, show presenter details, include a thumbnail image, make the date prominent, and show a Register action when registration is open.
* Event listings should include event/activity type filter buttons and expandable descriptions for longer text.
* Business Listings and For Sale use separate public pages and do not include registration actions.
* Public navigation includes separate buttons for Events, Business Listings, and For Sale.
* Supply lists open in a popup-style window for printing and closing, and event details include a print action.
* The Create Event form should stay collapsed until an event type is selected, and time entry must reject an end time that is at or before the start time.
* The Existing Events card should include event type filter buttons.
* Supply list links should say they are for viewing and printing, and the supply list viewer should include a close button.
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
* Firebase Storage

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
* Event/Activity Details
* Register
* Login
* Admin Dashboard

No business logic should be implemented during Phase 1.

⸻

Phase 2 – Administrative Event Management

Administrator Features

* Secure administrator login
* Login page supports forgot password and username help. The username is the account email address, and password reset instructions are sent through Firebase Authentication.
* User control module for Super User role and permissions management
* Super Users can add user accounts for non-computer-savvy members
* Admins with Add New Users permission can add and edit General User profiles, but cannot edit Admin or Super User profiles
* Super Users can change user passwords from the user control edit card
* User Controls includes the Add User action inside the User Controls card.
* User profile list includes filters for profile status and membership status, a compact details action, and a streamlined table.
* User profile list includes an Admins filter that lists Admin and Super User profiles regardless of status or membership, excluding archived profiles.
* Super User profiles display as Active with membership N/A and are excluded from membership status counts.
* User profile details show the full profile context, including membership status and billing address.
* Public account creation for new General User profiles
* Signed-in users can edit their own profile name, phone number, billing address, and password
* All user profile types include billing address fields for future payment processing
* User profiles can be tagged for VQ Booking and VQ Hosting functions
* Phone numbers should be formatted consistently as users enter them
* User profiles are the master person records.
  * Membership status is stored and managed on the user profile.
  * A profile does not require a login account.
  * Firebase Authentication is optional and is attached only when a person activates login access.
  * Registration membership checks use the profile membership fields.
  * Super User profiles display as Active with membership N/A and are excluded from membership counts.
* Super Users can manage a Configuration module.
  * Enable or disable active Guild membership checks for registration.
  * Membership imports match automatically by email.
  * Phone-only matches are treated as review exceptions and are not applied automatically.
  * Configure whether admins may skip the membership check.
  * Upload a membership CSV file that creates or updates profiles directly.
  * CSV imports support Add/Update Only mode and Annual Refresh mode.
  * Membership CSV upload stays disabled until the Super User selects an import mode.
  * Annual Refresh mode marks uploaded profiles with Active membership and marks existing non-archived profiles missing from the CSV as Inactive membership.
  * CSV imports support common headers including Name, First Name, Last Name, Email, Phone, Status, and Notes.
  * Profile records store First Name and Last Name as separate fields.
  * Membership imports match existing profiles by email first and phone second.
  * User profiles store membership status fields for member-only registration eligibility.
  * Manually add or edit profile membership from the configuration area or user controls.
  * Membership profile filters include Active, Inactive, and Archived; Active is the default view.
  * Keep membership tools, default locations, and default start/end time sections collapsed until the Super User chooses to show them.
  * Open membership/profile edits inline at the selected profile row.
  * Manage default event/activity locations.
  * Manage default event/activity start/end time choices.
  * Default time choices display in standard time format.
  * Default location and time add/edit fields stay hidden until the Super User selects Add or Edit.
* Create events
* Save incomplete events as Drafts, requiring only Event Type and Event Title
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
  * Other
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
* Photo/Image Upload
  * Allow one event image.
  * Resize uploaded images to a maximum of 1600 x 1200 pixels and 1 MB.
* Challenges use title, description, challenge PDF upload, supply list PDF upload, posting start/end, and registration.
* Retreats use event date, direct start/end time entry, location, description, capacity, fees, listing, and registration. Retreats do not use presenter/instructor name.
* Lectures use event date, location, presenter/instructor name, description, listing, and registration. Lectures do not use time, capacity, or fees.
* Business Listings use image upload, owner name, business name, specialty, email, phone, address, and description. Registration is not enabled.
* For Sale listings use title, description, asking price, photo upload, contact info, and posting start/end. Registration is not enabled and listings auto-expire after six months.
* Other uses the general event/activity card for events that do not fit a canned type.
  * Show an uploaded image preview large enough for administrators to confirm the correct image.
  * Allow administrators to change or remove the uploaded image.
  * View full-size images inside the form with a close button.
  * If no image is supplied, that image slot remains blank.
* Supporting Document Upload (i.e. Supply List)
  * For classes and workshops.
  * PDF format only.
  * Display as a link in the event form.
  * Store uploaded files in Firebase Storage.
  * Show the uploaded PDF file name in the form.
  * Allow administrators to set a display title for the document link.
  * Allow administrators to view, change, or remove the uploaded document.
  * View PDFs inside the form with a close button.
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

Audit And Transaction History

* Keep a complete transaction history for important actions.
* Record who made the change, what changed, when it happened, and which record was affected.
* Event create, update, and delete actions must create audit log entries.
* Registration, payment, refund, and attendance actions should also create audit log entries as those features are added.
* Audit history should be read-only from the application after it is created.

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
userId	Profile ID; Firebase UID when login access has been activated
authUserId	Firebase Auth UID when login access exists; blank for profile-only people
firstName	First name
lastName	Last name
name	Full name
email	Email
phone	Phone
membershipStatus	Guild membership status: Active, Inactive, Archived, Unknown, or N/A for Super Users
membershipMatchedBy	How the profile was matched or updated: email, phone, csv, manual, or account
membershipUpdatedDate	Last membership update timestamp
billingAddress	Billing address for future payment processing
role	Super User, Admin, or General User
permissions	Admin permission flags: manageEvents, viewRegistrations, managePayments, addUsers
profileTags	Functional tags such as vqBooking and vqHosting
status	Profile status: Active, Inactive, or Archived

⸻

members (transition only)

Field	Description
memberId	Unique member record ID
firstName	Member first name
lastName	Member last name
email	Member email
phone	Member phone
status	Active, Inactive, or Archived

The members collection is a transitional structure from the earlier design. The target model is to remove membership as a separate collection and manage membership status directly on profiles in the users collection.

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

auditLogs

Field	Description
auditLogId	Unique ID
entityType	Event, Registration, Payment, User, or Attendance
entityId	Linked record ID
action	Create, Update, Delete, Register, Cancel, Pay, Refund, or Attendance Update
summary	Short readable description of the action
before	Snapshot of the record before the action
after	Snapshot of the record after the action
actorUserId	Firebase UID for the administrator or user
actorName	Name of the person who performed the action
actorEmail	Email of the person who performed the action
actorRole	Super User, Admin, or General User
createdDate	Timestamp

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

Profile And Membership Source Of Truth

The users collection is the source of truth for people, contact information, profile status, and guild membership status.

Target behavior:

* Every registrant/member/contact can have a profile record, even if they never log in.
* Login access is optional and is attached to an existing profile when the person activates an account.
* Membership CSV imports update profiles directly.
* Registration membership checks use the profile returned by email lookup.
* If a profile is found, phone or password verification can be used to confirm identity before registration continues.
* If no profile is found, the registration flow checks whether a profile should be created from the membership CSV import result before allowing registration.
* Annual membership refresh should update membershipStatus on profiles rather than maintaining a separate member record.

Transition plan:

1. Keep the current members collection in place until the profile-based flow is fully tested.
2. Change membership CSV import to create/update users profiles directly.
3. Change registration lookup and registration creation APIs to use users membership fields only.
4. Replace the Configuration member list UI with a profile membership management view.
5. Stop writing new records to members.
6. Archive or remove the members collection only after production registration and CSV import are verified.

⸻

Security Requirements

* Firebase credentials must never be committed to GitHub.
* Store configuration using environment variables.
* Firestore Security Rules must enforce authorization.
* Administrative functions require authenticated administrator access.
* Users may only modify their own registrations.
* Audit log entries may be created by authorized actions, but may not be edited or deleted from the application.

⸻

User Experience Goals

The application should be:

* Responsive
* Mobile-friendly
* Support pull-down refresh on mobile devices
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
