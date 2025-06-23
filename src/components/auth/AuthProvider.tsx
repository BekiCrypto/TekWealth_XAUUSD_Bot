import React, { ReactNode } from 'react';
// User and Database types are used in AuthContext.ts, not directly here anymore
import { useAuth } from '../../hooks/useAuth';
import { AuthContext } from '../../contexts/AuthContext'; // Import the context

// AuthContextType, Profile, and useAuthContext are now in AuthContext.ts

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth(); // useAuth provides the full AuthContextType value

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
}

// useAuthContext is now imported from '../../contexts/AuthContext' by components that need it.
// If AuthProvider itself needed to use it, it would import it too, but it provides the value.