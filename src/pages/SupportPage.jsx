import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';

function SupportPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Help"
        title="Support And Contact"
        description="Reach the Guild for membership, registration, payment, or account questions."
      />

      <article className="terms-page-panel support-page-panel">
        <h3>Guild Contact</h3>
        <p>
          <strong>The Village Quilters, Inc.</strong><br />
          145 Awohili Drive<br />
          Loudon TN 37774
        </p>

        <h3>What We Can Help With</h3>
        <ul>
          <li>Membership signup, renewal, and status questions</li>
          <li>Event registration, waitlist, cancellation, and refund follow-up</li>
          <li>Profile, login, and directory access issues</li>
          <li>Payment questions for online Square charges or cash/check later registrations</li>
        </ul>

        <h3>Before You Reach Out</h3>
        <ul>
          <li>
            Review the current <Link to="/terms">Terms And Conditions</Link>
          </li>
          <li>
            Review the <Link to="/privacy">Privacy Policy</Link>
          </li>
          <li>
            Signed-in members can update contact details on the <Link to="/profile">My Profile</Link> page
          </li>
          <li>
            Check <Link to="/my-registrations">My Registrations</Link> for current registration and payment status
          </li>
        </ul>

        <p className="muted-copy">
          Program, workshop, and challenge questions shown on listings use the assigned
          coordinator contact when one is configured in System Config.
        </p>
      </article>
    </section>
  );
}

export default SupportPage;
