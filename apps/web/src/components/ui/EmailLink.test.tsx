import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailLink } from './EmailLink';

describe('EmailLink', () => {
  it('renders a mailto: link addressed to the given email, not the signed-in user', () => {
    render(<EmailLink email="jane.doe@m4contracting.ae" />);
    const link = screen.getByRole('link', { name: 'jane.doe@m4contracting.ae' });
    expect(link).toHaveAttribute('href', 'mailto:jane.doe@m4contracting.ae');
  });

  it('renders custom children as the visible label while still addressing the real email', () => {
    render(<EmailLink email="jane.doe@m4contracting.ae">Sara Khalil</EmailLink>);
    const link = screen.getByRole('link', { name: 'Sara Khalil' });
    expect(link).toHaveAttribute('href', 'mailto:jane.doe@m4contracting.ae');
  });

  it('encodes an optional subject and body as mailto: query parameters', () => {
    render(<EmailLink email="jane.doe@m4contracting.ae" subject="Re: RFI 12" body="See attached" />);
    const link = screen.getByRole('link');
    const href = link.getAttribute('href')!;
    expect(href.startsWith('mailto:jane.doe@m4contracting.ae?')).toBe(true);
    // Decode via URLSearchParams, not decodeURIComponent -- the query
    // string is application/x-www-form-urlencoded (spaces as '+'), which
    // only URLSearchParams decodes correctly.
    const query = new URLSearchParams(href.split('?')[1]);
    expect(query.get('subject')).toBe('Re: RFI 12');
    expect(query.get('body')).toBe('See attached');
  });

  it('does not render a link for an invalid email -- plain text instead, no unsafe href', () => {
    render(<EmailLink email="not-an-email">Suspicious Name</EmailLink>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Suspicious Name')).toBeInTheDocument();
  });

  it('does not render a link for an empty email', () => {
    render(<EmailLink email="" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('falls back to the raw address as the visible label when no children are given', () => {
    render(<EmailLink email="jane.doe@m4contracting.ae" />);
    expect(screen.getByText('jane.doe@m4contracting.ae')).toBeInTheDocument();
  });
});
