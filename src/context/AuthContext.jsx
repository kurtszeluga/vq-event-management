import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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

    return onAuthStateChanged(auth, async (firebaseUser) => {
      setCurrentUser(firebaseUser);
      setUserProfile(null);
      setProfileError('');

      if (!firebaseUser) {
        setLoading(false);
        return;
      }

      try {
        const profileRef = doc(db, 'users', firebaseUser.uid);
        const profileSnap = await getDoc(profileRef);

        if (profileSnap.exists()) {
          setUserProfile({ id: profileSnap.id, ...profileSnap.data() });
        } else {
          setProfileError('No user profile exists for this account.');
        }
      } catch (error) {
        setProfileError(error.message);
      } finally {
        setLoading(false);
      }
    });
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
      isAdmin: userProfile?.role === 'Admin' && userProfile?.status === 'Active',
      loading,
      logOut,
      profileError,
      userProfile
    }),
    [currentUser, loading, profileError, userProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
