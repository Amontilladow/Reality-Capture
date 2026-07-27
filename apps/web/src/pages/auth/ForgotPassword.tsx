import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { forgotPassword } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';

interface FormValues {
  email: string;
}

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>();

  const mutation = useMutation({
    mutationFn: (values: FormValues) => forgotPassword(values.email),
    onSuccess: () => setSent(true),
  });

  if (sent) {
    return (
      <AuthLayout title="Check your inbox" subtitle="If that email is registered, a reset link is on its way.">
        <p className="text-sm text-ink-300 leading-relaxed">
          Follow the link in the email to set a new password. The link expires after a short window
          for security — request a new one if it lapses.
        </p>
        <Link to="/login" className="btn-secondary w-full mt-6">Back to sign in</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your work email and we'll send you a reset link.">
      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
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

        {mutation.isError && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {apiErrorMessage(mutation.error)}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Send reset link'}
        </button>
        <Link to="/login" className="btn-ghost w-full">Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}
