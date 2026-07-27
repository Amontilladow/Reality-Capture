import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { login } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface FormValues {
  email: string;
  password: string;
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (result) => {
      setSession(result.tokens, result.user);
      const from = (location.state as { from?: Location })?.from?.pathname ?? '/projects';
      navigate(from, { replace: true });
    },
    onError: (err) => setServerError(apiErrorMessage(err)),
  });

  return (
    <AuthLayout title="Sign in" subtitle="Access your company's reality capture workspace.">
      <form
        onSubmit={handleSubmit((values) => {
          setServerError(null);
          mutation.mutate(values);
        })}
        className="space-y-4"
      >
        <div>
          <label className="field-label" htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="field-input"
            placeholder="you@company.com"
            {...register('email', { required: 'Email is required' })}
          />
          {errors.email && <p className="field-error">{errors.email.message}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="field-label mb-0" htmlFor="password">Password</label>
            <Link to="/forgot-password" className="text-xs text-blueprint hover:text-blueprint-hover">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="field-input"
            placeholder="••••••••"
            {...register('password', { required: 'Password is required' })}
          />
          {errors.password && <p className="field-error">{errors.password.message}</p>}
        </div>

        {serverError && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {serverError}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={isSubmitting || mutation.isPending}>
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-xs text-ink-500 mt-6 text-center">
        Have an invitation? Follow the link in your invitation email to accept it.
      </p>
    </AuthLayout>
  );
}
