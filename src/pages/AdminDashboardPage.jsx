import PageHeader from '../components/PageHeader.jsx';

function AdminDashboardPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Admin"
        title="Event management dashboard"
        description="Create, edit, publish, close, and report on events from here once Phase 2 business logic begins."
      />
      <div className="feature-grid">
        <article>
          <h2>Events</h2>
          <p>Create, edit, delete, publish, unpublish, and close registration.</p>
        </article>
        <article>
          <h2>Registrations</h2>
          <p>View registrants, manage attendance, and prepare event rosters.</p>
        </article>
        <article>
          <h2>Reports</h2>
          <p>Export rosters, attendance, payments, and CSV reports in later phases.</p>
        </article>
      </div>
    </section>
  );
}

export default AdminDashboardPage;
