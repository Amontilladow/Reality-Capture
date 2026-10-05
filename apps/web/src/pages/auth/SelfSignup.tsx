import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { SELF_REQUESTABLE_COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';
import { AuthLayout } from './AuthLayout';
import { selfSignup } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';
import { COMPANY_ROLE_LABELS } from '../../lib/issue-constants';

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
        <div>
          <label className="field-label" htmlFor="signupCode">Company signup code</label>
          <input
            id="signupCode"
            className="field-input font-mono"
            placeholder="e.g. 7K2M9XQP"
            {...register('signupCode', { required: 'Ask your company administrator for this code' })}
          />
          {errors.signupCode && <p className="field-error">{errors.signupCode.message}</p>}
        </div>

        <div>
          <label className="field-label" htmlFor="organizationName">Organization name &amp; role</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              id="organizationName"
              className="field-input"
              placeholder="e.g. AECOM"
              {...register('organizationName', { required: 'Required', minLength: { value: 2, message: 'Too short' } })}
            />
            <select id="requestedRole" className="field-input" {...register('requestedRole', { required: true })}>
              {SELF_REQUESTABLE_COMPANY_ROLES.map((r) => (
                <option key={r} value={r}>{COMPANY_ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          {errors.organizationName && <p className="field-error">{errors.organizationName.message}</p>}
          <p className="text-xs text-ink-500 mt-1">
            An administrator will review and approve your role before you get access.
          </p>
        </div>

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
          <label className="field-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="field-input"
            placeholder="you@yourcompany.com"
            {...register('email', { required: 'Email is required' })}
          />
          {errors.email && <p className="field-error">{errors.email.message}</p>}
        </div>

        <div>
          <label className="field-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
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
            autoComplete="new-password"
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

      <p className="text-xs text-ink-500 mt-6 text-center">
        Already have an account? <Link to="/login" className="text-blueprint hover:text-blueprint-hover">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
