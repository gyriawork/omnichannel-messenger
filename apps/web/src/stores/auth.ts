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
  logout: () => void;
  refreshToken: () => Promise<boolean>;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const data = await api.post<{
      accessToken: string;
      user: User;
    }>('/api/auth/login', { email, password });

    setAccessToken(data.accessToken);
    localStorage.setItem('user', JSON.stringify(data.user));

    set({
      user: data.user,
      accessToken: data.accessToken,
      isAuthenticated: true,
    });
  },

  register: async (email: string, password: string, name: string) => {
    const data = await api.post<{
      accessToken: string;
      user: User;
    }>('/api/auth/register', { email, password, name });

    setAccessToken(data.accessToken);
    localStorage.setItem('user', JSON.stringify(data.user));

    set({
      user: data.user,
      accessToken: data.accessToken,
      isAuthenticated: true,
    });
  },

  logout: () => {
    clearTokens();
    localStorage.removeItem('user');
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
    window.location.href = '/login';
  },

  refreshToken: async () => {
    try {
      const data = await api.post<{
        accessToken: string;
        user: User;
      }>('/api/auth/refresh');

      setAccessToken(data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));

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
