'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { User, Lock, Eye, EyeOff } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setIsSubmitting(true);
    try {
      await login(data.email, data.password);
      toast.success('Welcome back!');
      router.push('/messenger');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Invalid credentials';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[380px] px-6">
      {/* Logo — visible on mobile where the left panel is hidden */}
      <div className="mb-6 flex items-center justify-center lg:hidden">
        <img src="/logo-dark.svg" alt="messengly" className="mx-auto h-8" />
      </div>

      <h2 className="mb-8 text-center text-2xl font-semibold tracking-wide text-accent uppercase">
        User Login
      </h2>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Email field */}
        <div>
          <div
            className={cn(
              'flex items-center gap-3 rounded-full bg-[#eef0fb] px-5 py-3 transition-all focus-within:ring-2 focus-within:ring-accent/30',
              errors.email && 'ring-2 ring-red-300',
            )}
          >
            <User className="h-5 w-5 flex-shrink-0 text-accent/50" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="Email address"
              className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
              {...register('email')}
            />
          </div>
          {errors.email && (
            <p className="mt-1.5 pl-5 text-xs text-red-500">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password field */}
        <div>
          <div
            className={cn(
              'flex items-center gap-3 rounded-full bg-[#eef0fb] px-5 py-3 transition-all focus-within:ring-2 focus-within:ring-accent/30',
              errors.password && 'ring-2 ring-red-300',
            )}
          >
            <Lock className="h-5 w-5 flex-shrink-0 text-accent/50" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Password"
              className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
              {...register('password')}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword(!showPassword)}
              className="flex-shrink-0 text-slate-400 transition-colors hover:text-slate-600"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {errors.password && (
            <p className="mt-1.5 pl-5 text-xs text-red-500">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Remember me + Forgot password */}
        <div className="flex items-center justify-between px-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500">
            <div
              onClick={() => setRememberMe(!rememberMe)}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded transition-colors',
                rememberMe
                  ? 'bg-accent text-white'
                  : 'border border-slate-300 bg-white',
              )}
            >
              {rememberMe && (
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  className="h-3 w-3"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </div>
            Remember
          </label>
          <button
            type="button"
            className="text-sm text-slate-400 transition-colors hover:text-accent"
          >
            Forgot password?
          </button>
        </div>

        {/* Login button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="mx-auto flex w-48 items-center justify-center rounded-full bg-gradient-to-r from-accent to-[#a855f7] px-8 py-3 text-sm font-semibold tracking-wide text-white uppercase shadow-lg shadow-accent/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-accent/30 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {isSubmitting ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              'Login'
            )}
          </button>
        </div>
      </form>

      <p className="mt-8 text-center text-sm text-slate-400">
        Need an account? Ask your workspace admin for an invite.
      </p>
    </div>
  );
}
