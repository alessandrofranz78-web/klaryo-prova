import { createContext, useContext } from 'react';
import type { SessionUser } from './types';

export interface AuthValue {
  user: SessionUser | null;
  setUser: (user: SessionUser | null) => void;
}

export const AuthContext = createContext<AuthValue>({ user: null, setUser: () => undefined });

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
