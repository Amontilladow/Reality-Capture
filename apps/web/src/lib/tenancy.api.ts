import { apiGet, apiPost } from './api';

export interface SignupCodeResult {
  signupCode: string | null;
}

export function getSignupCode() {
  return apiGet<SignupCodeResult>('/company/signup-code');
}

// Overwrites any existing code -- the old one stops working immediately.
export function regenerateSignupCode() {
  return apiPost<SignupCodeResult>('/company/signup-code/regenerate', {});
}
