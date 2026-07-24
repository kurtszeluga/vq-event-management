# VQ Event Management Project Spec

## Overview

VQ Event Management is a Progressive Web App for The Village Quilters Network. It manages Guild programs, workshops, challenges, retreats, registrations, member profiles, membership status, payments, confirmations, and selected member-only features.

The app is intended for two audiences:

- Members and registrants who need a simple way to view programs, register, pay, and review their registrations.
- Admins and coordinators who need compact operational tools with minimal training.

The public-facing listing feed can be embedded on the GoDaddy website, while registration, payment, profile, and admin workflows run through the Vercel-hosted app.

## Current Stack

- React, Vite, JavaScript, React Router
- Progressive Web App support
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Firebase Admin SDK inside Vercel API routes
- Vercel deployment from GitHub
- Resend for transactional email
- Square Web Payments SDK and Square APIs for online card payment and app-initiated refunds

## Core Navigation

- Home/Admin Dashboard
- Programs & Activities
- My Registrations
- My Profile
- Member Directory
- Admin Dashboard modules for authorized users
- Login/Sign out

For admins, the dashboard is the primary home surface. It keeps the admin navigation row visible so users can jump between registrations, events/activities, workshops, challenges, business listings, for-sale listings, user controls, payment review, and system configuration.

## Roles And Permissions

### Super User

- Full administrative access.
- Can manage users, roles, permissions, membership status, configuration, events, registrations, payments, refunds, and coordinator assignments.
- Super User profiles are excluded from membership checks and directory results.

### Admin

- Must have an active profile.
- Permission flags control access:
  - `manageEvents`
  - `viewRegistrations`
  - `managePayments`
  - `addUsers`
  - `manageMembershipStatus`
- Admin profile permissions are cleared when membership becomes inactive because inactive members cannot hold Guild positions.

### General User

- Can manage their own profile and login.
- Can register for eligible events.
- Can view their own registrations and payment history.
- Can view the member directory only when both profile status and membership status are Active and the directory is enabled.

## Profiles And Membership

The `users` collection is the source of truth for people, contact details, login identity, profile status, and Guild membership status.

Important behavior:

- A profile can exist without an activated login account.
- Firebase Authentication is attached when a person activates/signs into an account.
- Membership CSV upload updates profiles directly.
- CSV matching is email-first. Phone-only matches are treated cautiously and routed to exceptions/review rather than automatically applied.
- Annual refresh assumes the CSV contains active paid Guild members.
- Annual refresh sets uploaded/new/reactivated profiles to Active membership and can set missing non-archived profiles to Inactive membership.
- Profiles created by CSV upload or by an admin assume terms were accepted manually/offline.
- Online membership signup/reactivation requires acceptance of terms and conditions.
- New online membership requests use `Pending` membership status until admin review.
- Membership payment tracking is stored on the profile and in `payments` history records.

Profile data includes:

- First name, last name, full name
- Email and phone
- Billing address
- Role and permission flags
- Profile status: Active, Inactive, Archived
- Membership status: Pending, Active, Inactive, Archived, Unknown
- Membership review/payment fields
- Terms acceptance fields

## Member Directory

The member directory is a member-only feature controlled by System Config.

Directory behavior:

- Only active profiles with Active membership can open the directory.
- Super User records are excluded.
- Directory settings control whether email, phone, city/state, and full address are shown.
- Directory has search and letter filters.
- Directory queries must include both `status == Active` and `membershipStatus == Active` to satisfy Firestore rules.

Future improvement: create a directory-safe public/member directory collection so full `users` profile documents are not exposed to directory readers.

## Event And Listing Types

Supported event/listing types:

- Class (Half Day)
- Class (Full Day)
- Workshop
- Lecture
- Retreat
- Challenges
- Business Listing
- For Sale
- Other

Programs grouping:

- Class (Half Day)
- Class (Full Day)
- Lecture
- Retreat

Administrative cards are separated so business listings, for-sale listings, challenges, workshops, and programs can be managed without crowding one event screen.

## Event Configuration

Common event fields include:

- Title
- Event type
- Description
- Presenter/instructor where applicable
- Date
- Start and end time where applicable
- Location
- Capacity and unlimited-capacity option
- Paid/free flag
- Cost and service fee
- Registration open/close behavior
- Listing visibility dates
- Image uploads
- Supply/document uploads
- Coordinator/contact display
- Non-member registration allowed flag
- Cash/check later payment allowed flag

Type-specific behavior:

- Challenges do not use time. Start/end times default to `00:00` and time is hidden from challenge display cards.
- Challenges show challenge registration start/end dates in list views.
- Classes and workshops default registration close date/time to the class/workshop start when registration opens now.
- Lectures do not require registration configuration.
- Other supports a registration option of N/A for one-off events.
- Business Listings and For Sale do not use registration.

## Public And GoDaddy Listings

The app supports a GoDaddy embeddable listing feed.

Current listing behavior:

- Filters show Programs, Workshops, and Challenges.
- Program filter includes class, lecture, and retreat program types.
- Cards are compact and include dates, payment details, capacity/registered/waitlisted/open-seat pills, coordinator contact, images, supply list links, and registration buttons when applicable.
- Register opens the Vercel registration flow.
- Supply list viewing/printing uses the working browser-compatible Vercel route behavior.

## Registration Flow

Registration is server-controlled. Clients cannot directly create Firestore registration documents.

Identity and eligibility:

- Signed-in users skip email entry when their account/profile is known.
- Existing profile lookup starts with email.
- Activated account users authenticate with Firebase password.
- Non-login/profile-only users verify identity through a Resend one-time email code.
- Verification codes are hashed, short-lived, and rate-limited.
- Successful verification issues a short-lived one-use registration token.
- Membership is checked before registration unless the event allows non-member registration or membership checks are disabled in config.
- Duplicate active registrations are detected before submit.
- For paid online registrations, a temporary seat hold is created before Square payment entry.

Capacity behavior:

- Online payment seat holds last 5 minutes.
- Active holds count against available capacity.
- When a hold expires, the user is returned to the listing and the seat becomes available.
- Waitlist messaging appears when no seat is available.
- Refund/cancellation returns the seat immediately.

Registration records include:

- Event snapshot fields such as event title, type, date, cost, service fee, and amount due
- Registrant name, email, phone
- Profile/user linkage where available
- Membership/profile status at registration
- Payment preference, method, status, amount paid, Square transaction/refund IDs
- Registration status: Pending Payment, Registered, Cancelled, Waitlisted

## My Registrations

Signed-in users can view their registrations.

Current behavior:

- Default sort is event date, newest first.
- Details slide open inline.
- Details include event info, registration date/time, registration history for repeated test/cancel registrations, payment info, and payment history.
- Users can print their registration details.

## Payments

The app uses embedded Square payment through the Square Web Payments SDK.

Payment modes:

- Free event: `No Charge`
- Online card payment: Square
- Cash/check later: allowed only when the admin enables it on the event
- Manual cash/check payment: admin-recorded
- Waived/comped payment: admin-recorded with $0 paid

Payment settings in System Config:

- Default service fee
- Enable/disable card payments
- Enable Apple Pay toggle
- Enable Google Pay toggle
- Allow app-initiated Square refunds toggle

Card/wallet payment note:

- The Village Quilters Network does not store card numbers, security codes, or wallet payment details. Square handles payment information.

Refund behavior:

- Paid online registrations are locked except for refund.
- When app-initiated refunds are enabled, admins can process Square refunds from the registration edit card.
- If Square returns `COMPLETED`, registration becomes Cancelled and payment becomes Refunded.
- If Square returns `PENDING`, registration is still cancelled immediately, the seat is returned, and a Payment Review follow-up is created.
- Square webhook completion updates/refines payment/refund records and clears matching pending refund review items.
- If app-initiated refunds are disabled, the treasurer can process refunds in Square and admins can record the result manually.
- Refund initiation sends a cancellation/refund status email to the registrant when confirmation emails are enabled.

## Payment Review

Payment Review tracks Square webhook events that need attention.

Current behavior:

- Signed Square webhook endpoint records Square events.
- Completed payment and refund events are reconciled automatically when matched.
- Refund-related `payment.updated` webhooks are logged as No Action so they do not create false review items.
- Needs Review rows can be manually marked reviewed with notes.
- Dashboard displays a Payment Review count for items needing attention.

## Email

Resend is used for transactional email.

Current email features:

- Registration verification code
- Registration confirmation
- Waitlist/pending payment messaging through the registration confirmation template
- Membership signup/reactivation confirmation
- Refund/cancellation notification
- System Config test email by selected area

Email configuration:

- Global Send registration confirmations toggle
- Area-specific instruction text:
  - Programs
  - Workshops
  - Challenges
  - Membership
- Emails use the Guild logo and The Village Quilters display name.
- Reply-To uses the coordinator email for the selected area when available.

## Coordinator Assignments

System Config allows Super Users to assign area coordinators.

Coordinator areas:

- Programs: Class (Half Day), Class (Full Day), Lecture, Retreat
- Workshops
- Challenges
- Business Listings
- For Sale
- Membership

Each assignment stores:

- Assigned user/profile
- Assigned name/email from the profile
- Optional contact email override
- Active flag

Listings and emails use "For questions contact:" with the coordinator name/email.

## System Configuration

System Config currently includes:

- Membership checks, terms text, terms version, and CSV import
- Payment settings
- Directory settings
- Email instructions and test email
- Default event locations
- Default event times
- Coordinator assignments

## Data Collections

Primary collections:

- `users`: profiles, roles, membership, billing address, terms, membership payment tracking
- `events`: programs, workshops, challenges, business listings, for-sale listings, and other activities
- `registrations`: server-created registration records
- `payments`: payment and refund history for registrations and memberships
- `auditLogs`: read-only audit history
- `appSettings`: membership, payment, directory, email, and other configuration documents
- `coordinatorAssignments`: area coordinator records
- `eventLocationDefaults`: reusable location defaults
- `eventTimeDefaults`: reusable time defaults
- `registrationVerifications`: private hashed email-code verification records with TTL
- `registrationReservations`: private temporary online-payment seat holds with TTL
- `registrationAttempts`: private idempotency records
- `squareWebhookEvents`: Square webhook logs and payment review records

Legacy/transition:

- `members` is no longer the desired source of truth. Membership is now managed on `users`.

## Security Requirements

- Firestore rules enforce role, permission, profile, directory, and membership constraints.
- Registration creation is server-only.
- Sensitive payment/refund and membership actions are handled through authenticated server endpoints or guarded admin flows.
- Verification and reservation collections are not client-readable.
- Audit logs are create-only/read-only for authorized admins.
- Firebase, Square, and Resend secrets must remain in environment variables.
- Vercel Hobby function count should be watched; prefer extending existing API routes over adding new functions.

## Current Upgrade Priorities

1. Finish and test payment/refund reliability and webhook reconciliation.
2. Add payment/card-testing rate limits or bot protection.
3. Create a directory-safe member directory collection.
4. Add privacy/support pages and production security headers.
5. Improve operational reporting, attendance/rosters, waitlist promotion, and reminders.
6. Add CI and broader Firestore rules/workflow tests.
7. Split oversized React components and centralize event display/availability logic.

## Long-Term Vision

The app is expected to grow into the primary Village Quilters member portal, including:

- Membership management and renewal
- Member-only information
- Member directory print/export
- Event registration and payment
- Attendance and roster tools
- Coordinator workflows
- Operational and financial reports
- Reminders and calendar integration
- Better support for non-technical Guild administrators
