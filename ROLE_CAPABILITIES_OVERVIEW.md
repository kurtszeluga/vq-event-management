# VQ Event Management Role Capabilities Overview

## Audience

This document summarizes what different people can do in the VQ Event Management app. It is intended as a plain-language orientation for Guild leaders, coordinators, admins, and members.

## Public Visitors

Public visitors can view public-facing listings, including programs, workshops, challenges, business listings, and items for sale. The GoDaddy website can embed the app's public event feed so visitors can browse current opportunities without first signing into the app.

Public visitors can begin registration for eligible events. During registration, the app checks whether the event requires active Guild membership, whether the person already has a profile, whether the person already has an active registration, and whether seats are available.

## Members And Registrants

Members and registrants can use the app to:

- Browse Programs & Activities
- Register for eligible events
- Pay online by card when required and enabled
- Select cash/check later only when an admin allows it for that event
- Receive confirmation emails
- View their own registrations after signing in
- See registration details, payment status, and payment history
- Print registration information
- Edit their own profile information
- View the member directory when active membership and directory settings allow it

The registration process is designed to prevent common problems:

- Duplicate active registrations are caught before submit.
- Membership eligibility is checked early.
- Online paid registrations hold a seat temporarily during payment.
- Full events can route users to a waitlist.
- Expired payment holds return the user to the listing so they can start again.

## Profile-Only Members

Some people may have a profile but no activated login account. This allows the Guild to manage membership and contact information for members who do not use the online account features.

Profile-only members can still be found during registration by email. If they need to prove identity without a password login, the app can use a one-time email verification code.

## Admins

Admins are Guild users with selected permissions. Admin access requires an active profile. If a user's membership becomes inactive, admin permissions are removed because inactive members cannot hold Guild positions.

Depending on permissions, admins may be able to:

- Manage events and activities
- View and manage registrations
- Record payment status changes
- Manage payments and refunds
- Add or update General User profiles
- Change membership status when allowed
- Review pending membership requests
- Use Payment Review for Square reconciliation issues

Admins do not all have the same access. Permissions are assigned based on responsibility.

## Super Users

Super Users have full administrative access and control the app configuration. This role should be limited to trusted system owners.

Super Users can:

- Manage all user profiles, roles, and permissions
- Manage admin access
- Manage membership status and membership payment tracking
- Run membership CSV imports
- Configure membership terms and conditions
- Configure registration membership checks
- Configure payment settings
- Configure email instructions and send test emails
- Configure member directory settings
- Configure default event locations and times
- Assign coordinator contacts by area
- Manage app-initiated Square refund settings

Super User profiles are excluded from membership counts, membership checks, and member directory results.

## Coordinators

Coordinator assignments connect Guild responsibility areas to a profile and contact email. These assignments are used on public listings and confirmation emails so members know who to contact with questions.

Coordinator areas include:

- Programs: classes, lectures, and retreats
- Workshops
- Challenges
- Business Listings
- For Sale
- Membership

The coordinator contact can use the assigned profile email or an override email when a shared Guild mailbox is preferred.

## Payment And Refund Responsibilities

The app supports both online Square payments and manual payment tracking.

Admins may record:

- Cash payments
- Check payments
- Waived/comped payments
- No-charge registrations
- Refund status

If app-initiated refunds are enabled, authorized admins can start Square refunds from the app. If the Guild wants the treasurer to handle refunds directly in Square, that setting can remain off and admins can record the refund result afterward.

Refunds cancel the registration and return the seat. If Square reports the refund as pending, the app creates a Payment Review item so it is visible for follow-up.

## Member Directory Access

The member directory is controlled by System Config. It is available only when enabled, and only to signed-in users with:

- Active profile status
- Active membership status

Directory fields are configurable. The Guild can decide whether to show email, phone, city/state, and full address.

## Security And Privacy Notes

The app uses several protections to keep registration, membership, and payment workflows controlled:

- Users must be signed in or verified before sensitive registration details are shown.
- Registration records are created by server-side logic, not direct browser writes.
- Payment card details are handled by Square and are not stored in the app.
- Square webhooks are signature-verified.
- Admin tools are shown only to authorized users.
- Firestore rules restrict who can read or write profiles, registrations, payments, settings, and audit records.
- Verification codes and seat holds expire automatically.

Future privacy improvements should include a directory-safe member collection, a privacy policy, production security headers, and expanded automated tests.

## Practical Use Cases

Typical member use:

1. Browse Programs & Activities.
2. Choose an event.
3. Verify identity or sign in.
4. Register and pay if needed.
5. Receive confirmation.
6. Review or print the registration later from My Registrations.

Typical admin use:

1. Open Admin Dashboard.
2. Create or update events and listings.
3. Review registrations by activity type, year, and quarter.
4. Manage payment or refund status.
5. Review pending memberships or payment review items.
6. Use System Config for membership, payment, email, directory, and coordinator settings.

Typical Super User setup work:

1. Maintain users, roles, and permissions.
2. Configure membership checks and terms.
3. Upload membership CSV refreshes.
4. Assign coordinators.
5. Configure email instructions and payment settings.
6. Monitor system review items.
