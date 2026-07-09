import PageHeader from '../components/PageHeader.jsx';

function HomePage() {
  return (
    <section>
      <PageHeader
        eyebrow="Phase 1 foundation"
        title="Village Quilters event registration"
        description="A mobile-friendly PWA for browsing programs, registering for events, and supporting future Square Checkout payments."
      />
      <div className="feature-grid">
        <article>
          <h2>Browse Events</h2>
          <p>Members will be able to discover classes, workshops, meetings, retreats, and special events.</p>
        </article>
        <article>
          <h2>Register Quickly</h2>
          <p>Registration will collect the member details needed for rosters, attendance, and payment tracking.</p>
        </article>
        <article>
          <h2>Manage Securely</h2>
          <p>Administrators will manage event publishing, capacity, attendance, and reporting from one dashboard.</p>
        </article>
      </div>
    </section>
  );
}

export default HomePage;
