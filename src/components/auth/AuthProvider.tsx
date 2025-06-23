import React, { createContext, useContext, ReactNode } from 'react';
import { User } from '@supabase/supabase-js'; // Import Supabase User type
import { useAuth } from '../../hooks/useAuth';
import { Database } from '../../types/database';

type Profile = Database['public']['Tables']['profiles']['Row'];
// type User = any; // Supabase User type - Replaced with import

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<any>;
  signUp: (email: string, password: string, fullName: string) => Promise<any>;
  signOut: () => Promise<any>;
  updateProfile: (updates: Partial<Profile>) => Promise<any>;
  isAdmin: boolean;
  isSubscriber: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}