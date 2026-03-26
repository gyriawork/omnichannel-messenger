'use client';

import { create } from 'zustand';
import { api, setAccessToken, clearTokens } from '@/lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  hydrate: () => void;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const data = await api.post<{
      accessToken: string;
      refreshToken: string;
      user: User;
    }>('/api/auth/login', { email, password });

    setAccessToken(data.accessToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    if (data.refreshToken) {
      localStorage.setItem('refreshToken', data.refreshToken);
    }

    set({
      user: data.user,
      accessToken: data.accessToken,
      isAuthenticated: true,
    });
  },

  register: async (email: string, password: string, name: string) => {
    const data = await api.post<{
      accessToken: string;
      refreshToken: string;
      user: User;
    }>('/api/auth/register', { email, password, name });

    setAccessToken(data.accessToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    if (data.refreshToken) {
      localStorage.setItem('refreshToken', data.refreshToken);
    }

    set({
      user: data.user,
      accessToken: data.accessToken,
      isAuthenticated: true,
    });
  },

  logout: async () => {
    try {
      const storedRefreshToken = localStorage.getItem('refreshToken');
      if (storedRefreshToken) {
        await api.post('/api/auth/logout', { refreshToken: storedRefreshToken });
      }
    } catch {
      // Silently ignore errors — logout should always succeed client-side
    }

    clearTokens();
    localStorage.removeItem('user');
    localStorage.removeItem('refreshToken');
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
    window.location.href = '/login';
  },

  refreshToken: async () => {
    try {
      // Send localStorage token as body fallback; cookie takes priority on server
      const storedRefreshToken = localStorage.getItem('refreshToken');
      const body = storedRefreshToken ? { refreshToken: storedRefreshToken } : undefined;
      const data = await api.post<{
        accessToken: string;
        refreshToken: string;
        user: User;
      }>('/api/auth/refresh', body);

      setAccessToken(data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
      }

      set({
        user: data.user,
        accessToken: data.accessToken,
        isAuthenticated: true,
      });
      return true;
    } catch {
      get().logout();
      return false;
    }
  },

  fetchMe: async () => {
    try {
      const user = await api.get<User>('/api/users/me');
      localStorage.setItem('user', JSON.stringify(user));
      set({ user });
    } catch {
      // Silently ignore — stale user data is acceptable as fallback
    }
  },

  hydrate: () => {
    if (typeof window === 'undefined') {
      set({ isLoading: false });
      return;
    }

    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        set({
          user,
          accessToken: token,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        clearTokens();
        localStorage.removeItem('user');
        set({ isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  },
}));
