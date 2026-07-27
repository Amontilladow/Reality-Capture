import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { acceptInvitation } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface FormValues {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>();

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      acceptInvitation({
        token,
        firstName: values.firstName,
        lastName: values.lastName,
        password: values.password,
      }),
    onSuccess: (result) => {
      setSession(result.tokens, result.user);
      navigate('/projects', { replace: true });
    },
  });

  if (!token) {
    return (
      <AuthLayout title="Invalid invitation" subtitle="This invitation link is missing its token.">
        <p className="text-sm text-ink-300">
          Ask your company administrator to resend your invitation.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Accept your invitation" subtitle="Set up your account to join your company's workspace.">
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="firstName">First name</label>
            <input
              id="firstName"
              className="field-input"
              {...register('firstName', { required: 'Required', minLength: { value: 2, message: 'Too short' } })}
            />
            {errors.firstName && <p className="field-error">{errors.firstName.message}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="lastName">Last name</label>
            <input
              id="lastName"
              className="field-input"
              {...register('lastName', { required: 'Required', minLength: { value: 2, message: 'Too short' } })}
            />
            {errors.lastName && <p className="field-error">{errors.lastName.message}</p>}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="field-input"
            placeholder="At least 8 characters"
            {...register('password', { required: 'Password is required', minLength: { value: 8, message: 'At least 8 characters' } })}
          />
          {errors.password && <p className="field-error">{errors.password.message}</p>}
        </div>

        <div>
          <label className="field-label" htmlFor="confirmPassword">Confirm password</label>
          <input
            id="confirmPassword"
            type="password"
            className="field-input"
            {...register('confirmPassword', {
              required: 'Please confirm your password',
              validate: (v) => v === watch('password') || 'Passwords do not match',
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
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
