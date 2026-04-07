'use client';

import { create } from 'zustand';

interface SuperadminState {
  selectedOrgId: string | null;
  selectedOrgName: string | null;
  setOrg: (id: string, name: string) => void;
  clearOrg: () => void;
  hydrate: () => void;
}

export const useSuperadminStore = create<SuperadminState>((set) => ({
  selectedOrgId: null,
  selectedOrgName: null,

  setOrg: (id: string, name: string) => {
    localStorage.setItem('superadmin_orgId', id);
    localStorage.setItem('superadmin_orgName', name);
    set({ selectedOrgId: id, selectedOrgName: name });
  },

  clearOrg: () => {
    localStorage.removeItem('superadmin_orgId');
    localStorage.removeItem('superadmin_orgName');
    set({ selectedOrgId: null, selectedOrgName: null });
  },

  hydrate: () => {
    if (typeof window === 'undefined') return;
    const orgId = localStorage.getItem('superadmin_orgId');
    const orgName = localStorage.getItem('superadmin_orgName');
    if (orgId && orgName) {
      set({ selectedOrgId: orgId, selectedOrgName: orgName });
    }
  },
}));
