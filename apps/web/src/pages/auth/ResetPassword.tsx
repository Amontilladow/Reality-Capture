import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { resetPassword } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { Input } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';

interface FormValues {
  newPassword: string;
  confirmPassword: string;
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>();

  const mutation = useMutation({
    mutationFn: (values: FormValues) => resetPassword({ token, newPassword: values.newPassword }),
    onSuccess: () => navigate('/login', { replace: true }),
  });

  if (!token) {
    return (
      <AuthLayout title="Invalid link" subtitle="This password reset link is missing its token.">
        <Link to="/forgot-password" className="btn-primary w-full">Request a new link</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password for your account.">
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
        <Input
          label="New password"
          type="password"
          placeholder="At least 8 characters"
          error={errors.newPassword?.message}
          {...register('newPassword', { required: 'Password is required', minLength: { value: 8, message: 'At least 8 characters' } })}
        />

        <Input
          label="Confirm password"
          type="password"
          placeholder="Re-enter password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword', {
            required: 'Please confirm your password',
            validate: (v) => v === watch('newPassword') || 'Passwords do not match',
          })}
        />

        {mutation.isError && <Alert tone="danger">{apiErrorMessage(mutation.error)}</Alert>}

        <Button type="submit" className="w-full" loading={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
