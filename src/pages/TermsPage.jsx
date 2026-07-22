import { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import {
  DEFAULT_MEMBERSHIP_SETTINGS,
  subscribeToMembershipSettings
} from '../services/configurationService.js';

function TermsPage() {
  const [settings, setSettings] = useState(DEFAULT_MEMBERSHIP_SETTINGS);

  useEffect(() => {
    const unsubscribe = subscribeToMembershipSettings(
      setSettings,
      () => setSettings(DEFAULT_MEMBERSHIP_SETTINGS)
    );

    return unsubscribe;
  }, []);

  return (
    <section>
      <PageHeader
        eyebrow="Membership"
        title="Terms And Conditions"
        description="Review the current Guild membership terms and conditions."
      />

      <article className="terms-page-panel">
        <div className="terms-version-row">
          <span>Terms Version</span>
          <strong>{settings.termsVersion || 'Current Membership Terms'}</strong>
        </div>

        {settings.termsText ? (
          <div className="terms-text">{settings.termsText}</div>
        ) : (
          <p className="muted-copy">
            Terms and conditions have not been entered yet. Please contact a Guild administrator for the current membership terms.
          </p>
        )}
      </article>
    </section>
  );
}

export default TermsPage;
