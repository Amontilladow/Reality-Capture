import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { forgotPassword } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { Input } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';

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
        <Input
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          error={errors.email?.message}
          {...register('email', { required: 'Email is required' })}
        />

        {mutation.isError && <Alert tone="danger">{apiErrorMessage(mutation.error)}</Alert>}

        <Button type="submit" className="w-full" loading={mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Send reset link'}
        </Button>
        <Link to="/login" className="btn-ghost w-full">Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}
