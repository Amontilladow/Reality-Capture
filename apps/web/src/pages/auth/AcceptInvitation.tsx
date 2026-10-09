import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { SELF_REQUESTABLE_COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';
import { AuthLayout } from './AuthLayout';
import { acceptInvitation } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';
import { COMPANY_ROLE_LABELS } from '../../lib/issue-constants';
import { Input, Select } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';

interface FormValues {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
  requestedRole: CompanyRole;
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
  } = useForm<FormValues>({ defaultValues: { requestedRole: 'consultant' } });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      acceptInvitation({
        token,
        firstName: values.firstName,
        lastName: values.lastName,
        password: values.password,
        requestedRole: values.requestedRole,
      }),
    onSuccess: (result) => {
      setSession(result.tokens, result.user);
      // Every self-registration lands pending -- ProtectedRoute would send
      // them here anyway once it checks pendingApproval, but routing there
      // directly avoids a pointless bounce through /projects first.
      navigate('/pending-approval', { replace: true });
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
          <Input
            label="First name"
            error={errors.firstName?.message}
            {...register('firstName', { required: 'Required', minLength: { value: 2, message: 'Too short' } })}
          />
          <Input
            label="Last name"
            error={errors.lastName?.message}
            {...register('lastName', { required: 'Required', minLength: { value: 2, message: 'Too short' } })}
          />
        </div>

        <Select
          label="Your position"
          hint="An administrator will review and approve this before you get access"
          {...register('requestedRole', { required: true })}
        >
          {SELF_REQUESTABLE_COMPANY_ROLES.map((r) => (
            <option key={r} value={r}>{COMPANY_ROLE_LABELS[r]}</option>
          ))}
        </Select>

        <Input
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          error={errors.password?.message}
          {...register('password', { required: 'Password is required', minLength: { value: 8, message: 'At least 8 characters' } })}
        />

        <Input
          label="Confirm password"
          type="password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword', {
            required: 'Please confirm your password',
            validate: (v) => v === watch('password') || 'Passwords do not match',
          })}
        />

        {mutation.isError && <Alert tone="danger">{apiErrorMessage(mutation.error)}</Alert>}

        <Button type="submit" className="w-full" loading={mutation.isPending}>
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
