import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile, getProfile } from '../lib/api';

type AuthValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  signInWithMicrosoft: () => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  const refreshProfile = useCallback(async () => {
    if (!userId) return setProfile(null);
    try {
      let p = await getProfile(userId);
      if (!p) {
        // ผู้ใช้เก่าที่ยังไม่มีแถวโปรไฟล์ → สร้างให้จากชื่อ Microsoft 365
        const meta = session?.user.user_metadata ?? {};
        const name = (meta.full_name as string) || (meta.name as string) || session?.user.email?.split('@')[0] || '';
        const { error } = await supabase.from('profiles').insert({ id: userId, display_name: name });
        if (error) console.error('สร้างโปรไฟล์ไม่สำเร็จ:', error.message);
        p = await getProfile(userId);
      }
      setProfile(p);
    } catch (err) {
      console.error('โหลดโปรไฟล์ไม่สำเร็จ:', err);
      setProfile(null);
    }
  }, [userId]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const signInWithMicrosoft = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email', // Supabase ต้องการ email จาก Azure
        redirectTo: window.location.origin + import.meta.env.BASE_URL,
        queryParams: { prompt: 'select_account' }, // ให้เลือกบัญชีหรือกรอกเมลใหม่ได้ทุกครั้งที่กดล็อกอิน
      },
    });
    return error ? error.message : null; // สำเร็จ = เบราว์เซอร์ถูกพาไปหน้า Microsoft
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ loading, session, user: session?.user ?? null, profile, signInWithMicrosoft, signOut, refreshProfile }),
    [loading, session, profile, signInWithMicrosoft, signOut, refreshProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน AuthProvider');
  return ctx;
}
