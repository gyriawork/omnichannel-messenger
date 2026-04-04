'use client';

import { redirect } from 'next/navigation';

// Self-registration is disabled — users are added via admin invite only.
// Redirect anyone who navigates to /register back to /login.
export default function RegisterPage() {
  redirect('/login');
}
