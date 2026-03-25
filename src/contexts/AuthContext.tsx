import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { fetchApi } from '@/lib/api';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  createdAt: string;
  preferences?: {
    theme?: string;
    defaultView?: string;
    notifications?: boolean;
  };
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: any) => Promise<void>;
  signup: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) {
        setIsLoading(false);
        return;
      }
      
      const response = await fetchApi<{ user: User }>('/auth/me');
      setUser(response.user);
    } catch (error) {
      console.error('Auth verification failed', error);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (credentials: any) => {
    setIsLoading(true);
    try {
      const { user, accessToken, refreshToken } = await fetchApi<{
        user: User;
        accessToken: string;
        refreshToken: string;
      }>('/auth/login', {
        method: 'POST',
        body: credentials,
      });

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      setUser(user);
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (details: any) => {
    setIsLoading(true);
    try {
      const { user, accessToken, refreshToken } = await fetchApi<{
        user: User;
        accessToken: string;
        refreshToken: string;
      }>('/auth/signup', {
        method: 'POST',
        body: details,
      });

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      setUser(user);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        await fetchApi('/auth/logout', {
          method: 'POST',
          body: { refreshToken },
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      setUser(null);
    }
  };

  const updateUser = (updates: Partial<User>) => {
    if (user) {
      setUser({ ...user, ...updates });
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, signup, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
