# VQ Event Management App Overview

## Purpose

VQ Event Management is the web application used by The Village Quilters Network to manage programs, activities, member profiles, registrations, payments, and selected member-only information. It is built as a Progressive Web App so it can be used from desktop browsers, tablets, and phones.

The app supports both public-facing event signup and internal Guild administration. Public listings can be embedded on the existing GoDaddy website, while registration, payment, account, and admin workflows run through the secure Vercel-hosted app.

## What The App Manages

The app currently supports these main areas:

- Programs and activities, including classes, lectures, retreats, workshops, and challenges
- Business listings and items for sale
- Event images, supply lists, and supporting documents
- Event registration, waitlists, capacity, and seat holds
- Member/user profiles and Guild membership status
- Online and manual payment tracking
- Square payment webhooks and payment review
- Confirmation and notification emails through Resend
- Coordinator assignments and public contact information
- Member-only directory access
- System configuration used by Super Users

## Public And Member Experience

Members and registrants can browse available programs and activities, review event details, and register for eligible events. The registration process checks identity and membership requirements before accepting a registration.

For paid events, the app can collect online card payments through embedded Square payment fields. The app does not store card numbers, security codes, or wallet payment details. Square handles the payment information.

Signed-in members can also:

- View their own registrations
- Open registration details inline
- Review payment history for their registrations
- Print registration details
- Edit their own profile information
- Access the member directory when the directory is enabled and their membership is active

## Admin Experience

Admins use the Admin Dashboard as the main work area. The dashboard keeps the key admin controls visible so users can move between tasks without hunting through navigation.

Depending on permissions, admins can:

- Create and manage programs, workshops, challenges, business listings, and for-sale listings
- Publish, close, archive, and reactivate records
- Review registrations by event, year, quarter, and activity type
- View registration counts, capacity, waitlist counts, and payment status
- Edit registration payment status where allowed
- Record cash, check, waived, no-charge, and refund information
- Review Square webhook/payment reconciliation items
- Create and update General User profiles
- Review pending membership requests
- Update membership status when granted permission

Super Users have full access and can also manage system configuration, admin permissions, coordinator assignments, member directory settings, membership import, terms and conditions, payment settings, and email instructions.

## Membership And Profiles

The app uses profile records as the source of truth for people and membership. A person can have a profile even if they have not activated a login account. This supports members who register or appear in membership imports without needing to use the app directly.

Membership information is stored on the profile, including:

- Membership status
- Membership payment status
- Review notes
- Terms acceptance information
- Contact and billing address information

Membership CSV imports update profile records directly. Matching is email-first. Phone-only matches are intentionally treated cautiously because they can identify the wrong person.

## Registration And Capacity Protection

Registration creation is handled by server-side API logic rather than direct browser writes to Firestore. This protects business rules such as membership eligibility, duplicate-registration checks, capacity limits, waitlists, payment status, and identity verification.

For online paid registrations, the app creates a temporary seat hold before the user enters payment information. Active holds count against capacity, preventing a second person from taking the last seat while the first person is paying. If the hold expires, the registration process returns the user to the listing and the seat becomes available again.

## Payments And Refunds

The app supports:

- Free events
- Online Square payments
- Admin-recorded cash/check payments
- Cash/check later when enabled per event
- Waived or comped payments
- Refund tracking

Admins can record manual refund outcomes. If enabled in System Config, authorized admins can also initiate Square refunds from the app. When a refund is started, the registration is cancelled and the seat is returned. If Square reports a pending refund, the app creates a Payment Review item so the issue is visible to admins.

Square webhooks are signed and recorded. Completed payment and refund events are reconciled automatically when possible, and unmatched items are routed to Payment Review.

## Email And Communication

The app uses Resend for transactional email. Current email flows include:

- Registration verification code
- Registration confirmation
- Membership signup or reactivation confirmation
- Refund/cancellation notification
- Test emails from System Config

Super Users can configure area-specific email instructions for Programs, Workshops, Challenges, and Membership. Coordinator assignments provide the "For questions contact" name and email shown on listings and used as Reply-To where appropriate.

## Security Model

Security is handled through several layers:

- Firebase Authentication for signed-in users
- Firestore security rules for role, profile, membership, and permission checks
- Server-side Firebase Admin routes for registration creation and sensitive payment/refund operations
- Hashed, expiring email verification codes
- One-use registration verification tokens
- Private seat reservation and registration attempt collections
- Signed Square webhook verification
- Environment variables for Firebase, Square, and Resend secrets
- Read-only audit log design for important actions

The current system already protects direct browser registration creation. Future hardening priorities include broader rate limiting, production security headers, a directory-safe member collection, and more automated rules/workflow tests.

## Current Direction

The app is moving from event registration toward a broader member portal. The long-term direction includes richer membership management, member-only information, better directory print/export tools, attendance and roster workflows, reminders, reporting, and improved admin automation.
