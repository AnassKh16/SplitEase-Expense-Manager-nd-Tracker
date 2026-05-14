import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { fetchProfile, logoutUser as supabaseLogout, supabase, upsertProfile } from '../lib/supabase';

export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  profile_picture: string | null;
  contribution_score?: number | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: ProfileRow | null;
  loading: boolean;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(
    async (uid: string, metadata?: Record<string, unknown> | null, email?: string | null) => {
      try {
        const row = await fetchProfile(uid);
        setProfile(row as ProfileRow);
        return row as ProfileRow;
      } catch {
        const displayName =
          String(metadata?.['full_name'] ?? metadata?.['name'] ?? email ?? '') || null;
        try {
          const row = await upsertProfile(uid, displayName);
          setProfile(row as ProfileRow);
          return row as ProfileRow;
        } catch {
          console.warn('profiles: could not fetch or bootstrap row');
          // Never wipe a good cached profile on slow network / transient RLS errors.
          setProfile((prev) => (prev?.user_id === uid ? prev : null));
          return null;
        }
      }
    },
    []
  );

  const refreshProfile = useCallback(async () => {
    if (!user?.id) {
      setProfile(null);
      return;
    }
    await loadProfile(user.id);
  }, [user?.id, loadProfile]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        // FIX: Let Supabase read the session from the URL hash FIRST.
        // Previously the hash was wiped before getSession() ran, so the
        // Google OAuth token was lost and the session always came back null.
        const { data: { session: s } } = await supabase.auth.getSession();

        // Only AFTER Supabase has consumed the hash, clean up the URL.
        if (window.location.hash?.includes('access_token')) {
          window.history.replaceState(null, '', window.location.pathname);
        }

        if (!mounted) return;

        setSession(s);
        setUser(s?.user ?? null);

        if (s?.user?.id) {
          // Do not await — a stuck/slow `profiles` query would leave the app on "Loading..." forever.
          void loadProfile(s.user.id, s.user.user_metadata, s.user.email);
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error('AuthContext init error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void init();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      try {
        if (newSession?.user?.id) {
          void loadProfile(
            newSession.user.id,
            newSession.user.user_metadata,
            newSession.user.email
          );
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error('AuthContext onAuthStateChange error:', err);
        // Keep existing profile so avatars do not flash back to initials on transient errors.
      } finally {
        if (mounted) setLoading(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const logout = useCallback(async () => {
    await supabaseLogout();
    setSession(null);
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({ user, session, profile, loading, logout, refreshProfile }),
    [user, session, profile, loading, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
