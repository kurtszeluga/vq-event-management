import PageHeader from '../components/PageHeader.jsx';

function EventsPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Events"
        title="Upcoming programs"
        description="Event browsing will appear here in Phase 2 once administrative event management is in place."
      />
      <div className="empty-state">
        <h2>No published events yet</h2>
        <p>Published classes, workshops, speakers, retreats, meetings, and fundraisers will be listed here.</p>
      </div>
    </section>
  );
}

export default EventsPage;
