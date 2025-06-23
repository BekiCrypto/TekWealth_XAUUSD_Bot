import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Database } from '../types/database';

type Profile = Database['public']['Tables']['profiles']['Row'];

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthState(prev => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setAuthState(prev => ({ ...prev, loading: false }));
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setAuthState(prev => ({ ...prev, session, user: session?.user ?? null }));
        
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setAuthState(prev => ({ ...prev, profile: null, loading: false }));
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116: Row not found, expected for new users
        console.error(`Error fetching profile for user ${userId}:`, error.message, error);
      }

      setAuthState(prev => ({ ...prev, profile, loading: false }));
    } catch (error: any) {
      console.error(`Critical error fetching profile for user ${userId}:`, error.message, error);
      setAuthState(prev => ({ ...prev, loading: false }));
    }
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    return { data, error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName
        }
      }
    });

    if (data.user && !error) {
      // Create profile for the new user
      // IMPORTANT: Ensure RLS policies on 'profiles' table are secure,
      // especially preventing users from setting their own 'role'.
      // The 'role' column should default to a non-privileged role or be set by a trusted process.
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        email,
        full_name: fullName,
        // role: 'user', // Example: explicitly set a default role if not handled by DB default
      });

      if (profileError) {
        console.error(`Error creating profile for new user ${data.user.id}:`, profileError.message, profileError);
        // This is a critical issue: user authenticated but profile creation failed.
        // Consider how to handle this:
        // - Inform the user? (e.g., toast.error('Profile setup failed, please contact support.'))
        // - Attempt retry?
        // - Log to a dedicated monitoring service.
        // For now, we log the error. The main signUp error will still be null if auth itself succeeded.
        // This could lead to a situation where the user is logged in but parts of the app depending on profile might fail.
      }
    }

    return { data, error }; // Returns the auth signUp data/error
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!authState.user) return { error: new Error('No user logged in') };

    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', authState.user.id)
      .select()
      .single();

    if (!error && data) {
      setAuthState(prev => ({ ...prev, profile: data }));
    }

    return { data, error };
  };

  return {
    ...authState,
    signIn,
    signUp,
    signOut,
    updateProfile,
    isAdmin: authState.profile?.role === 'admin',
    isSubscriber: authState.profile?.role === 'subscriber'
  };
}