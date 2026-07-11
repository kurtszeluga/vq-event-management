import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { hasAdminAccess, hasPermission, isSuperUser } from '../data/userRoles.js';
import { auth, db, firebaseConfigured } from '../lib/firebase.js';
import { AuthContext } from './authContext.js';

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (!firebaseConfigured || !auth || !db) {
      setLoading(false);
      return undefined;
    }

    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setCurrentUser(firebaseUser);
      setUserProfile(null);
      setProfileError('');

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!firebaseUser) {
        setLoading(false);
        return;
      }

      try {
        const profileRef = doc(db, 'users', firebaseUser.uid);
        unsubscribeProfile = onSnapshot(
          profileRef,
          (profileSnap) => {
            if (profileSnap.exists()) {
              setUserProfile({ id: profileSnap.id, ...profileSnap.data() });
              setProfileError('');
            } else {
              setProfileError('No user profile exists for this account.');
            }
            setLoading(false);
          },
          (error) => {
            setProfileError(error.message);
            setLoading(false);
          }
        );
      } catch (error) {
        setProfileError(error.message);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  async function logOut() {
    if (auth) {
      await signOut(auth);
    }
  }

  const value = useMemo(
    () => ({
      currentUser,
      firebaseConfigured,
      hasPermission: (permissionKey) => hasPermission(userProfile, permissionKey),
      isAdmin: hasAdminAccess(userProfile),
      isSuperUser: isSuperUser(userProfile),
      loading,
      logOut,
      profileError,
      userProfile
    }),
    [currentUser, loading, profileError, userProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
