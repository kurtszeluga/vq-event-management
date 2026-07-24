import PageHeader from '../components/PageHeader.jsx';

function PrivacyPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Legal"
        title="Privacy Policy"
        description="How The Village Quilters Network handles member and registrant information."
      />

      <article className="terms-page-panel privacy-page-panel">
        <p>
          The Village Quilters, Inc. (&quot;the Guild&quot;) operates the Village Quilters Network
          event management application to support Guild programs, workshops, challenges,
          membership, registrations, and related communications.
        </p>

        <h3>Information We Collect</h3>
        <ul>
          <li>Profile details such as name, email address, phone number, and billing address</li>
          <li>Membership status and related review or payment notes needed for Guild operations</li>
          <li>Event registration details, waitlist status, and attendance-related records</li>
          <li>Payment status and Square transaction identifiers for online card payments and refunds</li>
          <li>Technical account information needed for login and security</li>
        </ul>

        <h3>How We Use Information</h3>
        <ul>
          <li>Operate registration, membership, directory, and admin workflows</li>
          <li>Send transactional emails such as verification codes, confirmations, and refund notices</li>
          <li>Process online payments and refunds through Square</li>
          <li>Maintain operational records for Guild administrators and coordinators</li>
        </ul>

        <h3>Payments</h3>
        <p>
          The Guild does not store card numbers, security codes, or wallet payment details.
          Square processes online card and wallet payments on the Guild&apos;s behalf.
        </p>

        <h3>Member Directory</h3>
        <p>
          When the member directory is enabled, eligible Active members may see directory-safe
          contact fields that the Guild chooses to display. Full membership, permission, and
          payment records are not shared through the directory.
        </p>

        <h3>Sharing</h3>
        <p>
          Information is shared with service providers required to run the application,
          including Firebase (authentication, database, and file storage), Vercel (hosting),
          Resend (email delivery), and Square (payments). We do not sell personal information.
        </p>

        <h3>Access And Questions</h3>
        <p>
          Members may review and update their profile information while signed in.
          For privacy questions, corrections, or support, contact the Guild using the details
          on the Support page.
        </p>

        <p className="muted-copy">
          The Village Quilters, Inc.<br />
          145 Awohili Drive, Loudon TN 37774
        </p>
      </article>
    </section>
  );
}

export default PrivacyPage;
