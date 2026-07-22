import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import {
  DEFAULT_DIRECTORY_SETTINGS,
  subscribeToActiveMemberDirectoryProfiles,
  subscribeToDirectorySettings
} from '../services/configurationService.js';
import { formatPhoneNumber } from '../utils/profileFormat.js';

const LETTER_FILTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function MemberDirectoryPage() {
  const { currentUser, loading, userProfile } = useAuth();
  const [directorySettings, setDirectorySettings] = useState(DEFAULT_DIRECTORY_SETTINGS);
  const [directoryError, setDirectoryError] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [members, setMembers] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [selectedLetter, setSelectedLetter] = useState('');
  const isActiveMember = userProfile?.status === 'Active' && userProfile?.membershipStatus === 'Active';

  useEffect(() => subscribeToDirectorySettings(
    (settings) => {
      setDirectorySettings(settings);
      setDirectoryError('');
    },
    (error) => setDirectoryError(error.message)
  ), []);

  useEffect(() => {
    if (!currentUser || !isActiveMember || !directorySettings.enableMemberDirectory) {
      setMembers([]);
      setLoadingMembers(false);
      return undefined;
    }

    setLoadingMembers(true);

    return subscribeToActiveMemberDirectoryProfiles(
      (snapshot) => {
        setMembers(snapshot.docs.map((profileDoc) => ({
          id: profileDoc.id,
          ...profileDoc.data()
        })));
        setDirectoryError('');
        setLoadingMembers(false);
      },
      (error) => {
        setDirectoryError(error.message);
        setLoadingMembers(false);
      }
    );
  }, [currentUser, directorySettings.enableMemberDirectory, isActiveMember]);

  const filteredMembers = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return members
      .filter((member) => {
        const lastName = getLastName(member);
        const matchesLetter = !selectedLetter || lastName.toUpperCase().startsWith(selectedLetter);
        const matchesSearch = !normalizedSearch || [
          getDisplayName(member),
          member.email,
          member.phone,
          getCityState(member),
          formatAddress(member.billingAddress)
        ].join(' ').toLowerCase().includes(normalizedSearch);

        return matchesLetter && matchesSearch;
      })
      .sort(compareMembers);
  }, [members, searchText, selectedLetter]);

  const letterCounts = useMemo(() => {
    const counts = {};
    members.forEach((member) => {
      const firstLetter = getLastName(member).charAt(0).toUpperCase();

      if (firstLetter) {
        counts[firstLetter] = (counts[firstLetter] || 0) + 1;
      }
    });
    return counts;
  }, [members]);

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Loading Directory</h2>
        <p>Checking your membership access.</p>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: { pathname: '/member-directory' } }} replace />;
  }

  if (!isActiveMember) {
    return (
      <section>
        <PageHeader
          eyebrow="Members"
          title="Member Directory"
          description="The member directory is available to active Guild members."
        />
        <div className="empty-state">
          <h2>Active Membership Required</h2>
          <p>Your profile must have an active membership status to view the directory.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Members"
        title="Member Directory"
        description="Find current Guild members and contact information."
      />
      <div className="member-directory-panel">
        {directoryError ? <p className="form-error">{directoryError}</p> : null}
        {!directorySettings.enableMemberDirectory ? (
          <div className="empty-state compact-empty-state">
            <h2>Directory Not Available</h2>
            <p>The member directory is currently turned off.</p>
          </div>
        ) : null}
        {directorySettings.enableMemberDirectory ? (
          <>
            {directorySettings.directoryNote ? (
              <p className="member-directory-note">{directorySettings.directoryNote}</p>
            ) : null}
            <div className="member-directory-controls">
              <label>
                <span>Search Directory</span>
                <input
                  placeholder="Search by name, email, phone, city, or state"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                />
              </label>
              <button
                className="button-link button-reset secondary-action compact-action"
                type="button"
                onClick={() => {
                  setSearchText('');
                  setSelectedLetter('');
                }}
              >
                Reset
              </button>
            </div>
            <div className="member-directory-letter-row" aria-label="Filter by last name">
              <button
                className={`status-filter-button${selectedLetter === '' ? ' active' : ''}`}
                type="button"
                onClick={() => setSelectedLetter('')}
              >
                All ({members.length})
              </button>
              {LETTER_FILTERS.map((letter) => (
                <button
                  className={`status-filter-button${selectedLetter === letter ? ' active' : ''}`}
                  disabled={!letterCounts[letter]}
                  key={letter}
                  type="button"
                  onClick={() => setSelectedLetter(letter)}
                >
                  {letter} ({letterCounts[letter] || 0})
                </button>
              ))}
            </div>
            <p className="member-directory-count">
              Showing {filteredMembers.length} of {members.length} active members.
            </p>
            {loadingMembers ? (
              <div className="empty-state compact-empty-state">
                <h2>Loading Members</h2>
                <p>Retrieving the active member directory.</p>
              </div>
            ) : null}
            {!loadingMembers && !filteredMembers.length ? (
              <div className="empty-state compact-empty-state">
                <h2>No Members Found</h2>
                <p>Try clearing the search or letter filter.</p>
              </div>
            ) : null}
            {filteredMembers.length ? (
              <div className="member-directory-list">
                {filteredMembers.map((member) => (
                  <article className="member-directory-card" key={member.id}>
                    <div>
                      <strong>{getDisplayName(member)}</strong>
                      {directorySettings.showCityState ? (
                        <span>{getCityState(member) || 'City/state not listed'}</span>
                      ) : null}
                    </div>
                    <dl>
                      {directorySettings.showEmail ? (
                        <DirectoryItem label="Email" value={member.email || 'Not listed'} />
                      ) : null}
                      {directorySettings.showPhone ? (
                        <DirectoryItem label="Phone" value={formatPhoneNumber(member.phone || '') || 'Not listed'} />
                      ) : null}
                      {directorySettings.showFullAddress ? (
                        <DirectoryItem label="Address" value={formatAddress(member.billingAddress)} />
                      ) : null}
                    </dl>
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function DirectoryItem({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function compareMembers(first, second) {
  return `${getLastName(first)} ${getFirstName(first)}`.localeCompare(
    `${getLastName(second)} ${getFirstName(second)}`
  );
}

function getDisplayName(member) {
  return [getFirstName(member), getLastName(member)].filter(Boolean).join(' ')
    || member.name
    || member.email
    || 'Member';
}

function getFirstName(member) {
  return member.firstName || String(member.name || '').trim().split(/\s+/)[0] || '';
}

function getLastName(member) {
  const parts = String(member.name || '').trim().split(/\s+/);
  return member.lastName || (parts.length > 1 ? parts.slice(1).join(' ') : '') || member.email || '';
}

function getCityState(member) {
  const address = member.billingAddress || {};
  return [address.city, address.state].filter(Boolean).join(', ');
}

function formatAddress(address = {}) {
  return [
    address.street,
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(' '),
    address.country
  ].filter(Boolean).join(', ') || 'Not listed';
}

export default MemberDirectoryPage;
