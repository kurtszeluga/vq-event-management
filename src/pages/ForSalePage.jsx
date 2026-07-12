import PublicListingPage from '../components/PublicListingPage.jsx';

function ForSalePage() {
  return (
    <PublicListingPage
      description="Browse member items currently listed for sale."
      emptyDescription="Published for sale listings will appear here when they are ready."
      emptyTitle="No for sale listings yet"
      eventType="For Sale"
      eyebrow="For Sale"
      title="For Sale"
    />
  );
}

export default ForSalePage;
