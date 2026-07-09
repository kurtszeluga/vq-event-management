import PageHeader from '../components/PageHeader.jsx';

function RegisterPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Registration"
        title="Register for an event"
        description="The registration form will collect name, email, phone number, event, registration date, and payment status."
      />
      <div className="empty-state">
        <h2>Registration opens in Phase 3</h2>
        <p>This placeholder keeps the application route-ready without adding business logic ahead of the roadmap.</p>
      </div>
    </section>
  );
}

export default RegisterPage;
