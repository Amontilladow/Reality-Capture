import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { SELF_REQUESTABLE_COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';
import { AuthLayout } from './AuthLayout';
import { selfSignup } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';
import { COMPANY_ROLE_LABELS } from '../../lib/issue-constants';
import { Input, Select } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';

interface FormValues {
  signupCode: string;
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  requestedRole: CompanyRole;
}

// Distinct from AcceptInvitation: there's no pre-created placeholder row or
// per-email token here -- the company-wide signup code (shared by an admin,
// e.g. via a link containing ?code=...) is the only credential, and this
// creates a brand new account directly in one step rather than "claiming" a
// row an admin already set up. Same end state either way: the account lands
// on /pending-approval until a company_admin/super_admin approves it.
export default function SelfSignup() {
  const [searchParams] = useSearchParams();
  const codeFromUrl = searchParams.get('code') ?? '';
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { signupCode: codeFromUrl, requestedRole: 'consultant' } });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      selfSignup({
        signupCode: values.signupCode.trim(),
        organizationName: values.organizationName,
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
        requestedRole: values.requestedRole,
      }),
    onSuccess: (result) => {
      setSession(result.tokens, result.user);
      navigate('/pending-approval', { replace: true });
    },
  });

  return (
    <AuthLayout title="Create your account" subtitle="Join your company's reality capture workspace.">
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
        <Input
          label="Company signup code"
          className="font-mono"
          placeholder="e.g. 7K2M9XQP"
          error={errors.signupCode?.message}
          {...register('signupCode', { required: 'Ask your company administrator for this code' })}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Organization name"
            placeholder="e.g. AECOM"
            hint="Your employer, not EngineeringOS's company"
            error={errors.organizationName?.message}
            {...register('organizationName', { required: 'Required', minLength: { value: 2, message: 'Too short' } })}
          />
          <Select
            label="Requested role"
            hint="An admin reviews this before you get access"
            {...register('requestedRole', { required: true })}
          >
            {SELF_REQUESTABLE_COMPANY_ROLES.map((r) => (
              <option key={r} value={r}>{COMPANY_ROLE_LABELS[r]}</option>
            ))}
          </Select>
        </div>

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

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@yourcompany.com"
          error={errors.email?.message}
          {...register('email', { required: 'Email is required' })}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          error={errors.password?.message}
          {...register('password', { required: 'Password is required', minLength: { value: 8, message: 'At least 8 characters' } })}
        />

        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
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

      <p className="text-xs text-ink-500 mt-6 text-center">
        Already have an account? <Link to="/login" className="text-blueprint hover:text-blueprint-hover">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
