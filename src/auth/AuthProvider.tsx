import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile, getProfile, isAdmin as fetchIsAdmin } from '../lib/api';

export type { Profile };

export type AuthValue = {
  /** true until the initial session check finishes */
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** true while the signed-in user's profile/admin flag are being fetched for the first time */
  profileLoading: boolean;
  isAdmin: boolean;
  signInWithMicrosoft: () => Promise<string | null>;
  /** Email + 6-digit PIN (Supabase password). Returns an error message or null. */
  signInWithPin: (email: string, pin: string) => Promise<string | null>;
  /** Set or change the signed-in user's 6-digit PIN. Returns an error message or null. */
  setPin: (pin: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Re-fetch profile (and admin flag). Call after registration, group or avatar changes. */
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [admin, setAdmin] = useState(false);
  // Which user id the current profile/admin state belongs to (undefined = not loaded yet).
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setAdmin(false);
      setLoadedFor(null);
      return;
    }
    try {
      const [p0, a] = await Promise.all([getProfile(userId), fetchIsAdmin().catch(() => false)]);
      let p = p0;
      if (!p) {
        // Older users without a profile row: create one from the Microsoft 365 name.
        const meta = session?.user.user_metadata ?? {};
        const name = (meta.full_name as string) || (meta.name as string) || session?.user.email?.split('@')[0] || '';
        const { error } = await supabase.from('profiles').insert({ id: userId, display_name: name });
        if (error) console.error('Could not create profile:', error.message);
        p = await getProfile(userId);
      }
      setProfile(p);
      setAdmin(a);
    } catch (err) {
      console.error('Could not load profile:', err);
      setProfile(null);
      setAdmin(false);
    } finally {
      setLoadedFor(userId);
    }
  }, [userId]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const signInWithMicrosoft = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email', // Supabase needs the email claim from Azure
        redirectTo: window.location.origin + import.meta.env.BASE_URL,
        queryParams: { prompt: 'select_account' },
      },
    });
    return error ? error.message : null; // success = browser is redirected to Microsoft
  }, []);

  const signInWithPin = useCallback(async (email: string, pin: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pin });
    if (!error) return null;
    if (/invalid login credentials/i.test(error.message))
      return 'Email or PIN is incorrect. PIN sign-in only works after you set a PIN in your Profile.';
    return error.message;
  }, []);

  const setPin = useCallback(async (pin: string) => {
    if (!/^\d{6}$/.test(pin)) return 'PIN must be exactly 6 digits.';
    const { error } = await supabase.auth.updateUser({ password: pin });
    if (!error) return null;
    if (/same.*password|different from the old/i.test(error.message)) return 'That is already your PIN.';
    if (/reauthenticat|recent/i.test(error.message)) return 'For security, sign out and sign in with Microsoft again, then set your PIN.';
    return error.message;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const profileLoading = !!userId && loadedFor !== userId;

  const value = useMemo<AuthValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile: profileLoading ? null : profile,
      profileLoading,
      isAdmin: profileLoading ? false : admin,
      signInWithMicrosoft,
      signInWithPin,
      setPin,
      signOut,
      refreshProfile,
    }),
    [loading, session, profile, profileLoading, admin, signInWithMicrosoft, signInWithPin, setPin, signOut, refreshProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
