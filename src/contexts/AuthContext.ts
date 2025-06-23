import { createContext, useContext } from 'react';
import { User } from '@supabase/supabase-js';
import { Database } from '../types/database'; // Adjusted path

type Profile = Database['public']['Tables']['profiles']['Row'];

export interface AuthContextType { // Exported interface
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

export const AuthContext = createContext<AuthContextType | undefined>(undefined); // Exported context

export function useAuthContext() { // Exported hook
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
