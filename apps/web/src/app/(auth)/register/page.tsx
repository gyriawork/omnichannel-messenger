'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { UserPlus } from 'lucide-react';

const registerSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const registerUser = useAuthStore((s) => s.register);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterForm) => {
    setIsSubmitting(true);
    try {
      await registerUser(data.email, data.password, data.name);
      toast.success('Account created successfully!');
      router.push('/messenger');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Registration failed';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-hover">
          <UserPlus className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-2xl font-semibold text-slate-800">
          Create an account
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Get started with Omnichannel Messenger
        </p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-xs">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Full name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="John Doe"
              className={cn(
                'w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition-shadow focus:border-accent focus:shadow-focus-ring',
                errors.name && 'border-red-300 focus:border-red-400',
              )}
              {...register('name')}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-500">
                {errors.name.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              className={cn(
                'w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition-shadow focus:border-accent focus:shadow-focus-ring',
                errors.email && 'border-red-300 focus:border-red-400',
              )}
              {...register('email')}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-500">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className={cn(
                'w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition-shadow focus:border-accent focus:shadow-focus-ring',
                errors.password && 'border-red-300 focus:border-red-400',
              )}
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-500">
                {errors.password.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat your password"
              className={cn(
                'w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition-shadow focus:border-accent focus:shadow-focus-ring',
                errors.confirmPassword && 'border-red-300 focus:border-red-400',
              )}
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-red-500">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-accent-sm transition-all hover:bg-accent-hover hover:-translate-y-px active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-accent hover:text-accent-hover"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
