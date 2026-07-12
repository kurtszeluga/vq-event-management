import PublicListingPage from '../components/PublicListingPage.jsx';

function BusinessListingsPage() {
  return (
    <PublicListingPage
      description="Browse member business listings."
      emptyDescription="Published business listings will appear here when they are ready."
      emptyTitle="No business listings yet"
      eventType="Business Listing"
      eyebrow="Business Listings"
      title="Business Listings"
    />
  );
}

export default BusinessListingsPage;
