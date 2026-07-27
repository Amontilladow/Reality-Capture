import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { resetPassword } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';

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
        <div>
          <label className="field-label" htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            className="field-input"
            placeholder="At least 8 characters"
            {...register('newPassword', { required: 'Password is required', minLength: { value: 8, message: 'At least 8 characters' } })}
          />
          {errors.newPassword && <p className="field-error">{errors.newPassword.message}</p>}
        </div>

        <div>
          <label className="field-label" htmlFor="confirmPassword">Confirm password</label>
          <input
            id="confirmPassword"
            type="password"
            className="field-input"
            placeholder="Re-enter password"
            {...register('confirmPassword', {
              required: 'Please confirm your password',
              validate: (v) => v === watch('newPassword') || 'Passwords do not match',
            })}
          />
          {errors.confirmPassword && <p className="field-error">{errors.confirmPassword.message}</p>}
        </div>

        {mutation.isError && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {apiErrorMessage(mutation.error)}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthLayout>
  );
}
