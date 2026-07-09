import { Link, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';

function EventDetailsPage() {
  const { eventId } = useParams();

  return (
    <section>
      <PageHeader
        eyebrow="Event details"
        title="Event information"
        description={`Details for event ${eventId} will be loaded from Firestore in a later phase.`}
      />
      <Link className="button-link" to="/register">
        Continue to registration
      </Link>
    </section>
  );
}

export default EventDetailsPage;
