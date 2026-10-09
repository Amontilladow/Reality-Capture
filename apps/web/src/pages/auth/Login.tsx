import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { login } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';
import { Input } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';

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
        <Input
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          error={errors.email?.message}
          {...register('email', { required: 'Email is required' })}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          error={errors.password?.message}
          labelAddon={
            <Link to="/forgot-password" className="text-xs text-blueprint hover:text-blueprint-hover">
              Forgot password?
            </Link>
          }
          {...register('password', { required: 'Password is required' })}
        />

        {serverError && <Alert tone="danger">{serverError}</Alert>}

        <Button type="submit" className="w-full" loading={isSubmitting || mutation.isPending}>
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="text-xs text-ink-500 mt-6 text-center">
        Have an invitation? Follow the link in your invitation email to accept it.
      </p>
      <p className="text-xs text-ink-500 mt-2 text-center">
        Don't have an account? <Link to="/signup" className="text-blueprint hover:text-blueprint-hover">Sign up</Link> with your company's signup code.
      </p>
    </AuthLayout>
  );
}
