import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));

const { default: PageHeader } = await import('../../src/components/PageHeader.jsx');

afterEach(cleanup);

describe('PageHeader breadcrumb', () => {
  it('renders nothing when no breadcrumb is supplied', () => {
    render(<PageHeader eyebrow="Event details" title="Quilt Basics" />);

    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });

  it('links every entry except the last, which renders as plain text', () => {
    render(
      <PageHeader
        breadcrumb={[
          { label: 'Programs & Activities', to: '/events' },
          { label: 'Quilt Basics' }
        ]}
        eyebrow="Class (Full Day)"
        title="Quilt Basics"
      />
    );

    const link = screen.getByRole('link', { name: 'Programs & Activities' });
    expect(link.getAttribute('href')).toBe('/events');
    // "Quilt Basics" appears twice (breadcrumb + <h1> title) - scope to the
    // breadcrumb's own current-page span rather than an ambiguous text query.
    expect(document.querySelector('.breadcrumb-current').textContent).toBe('Quilt Basics');
    expect(screen.queryByRole('link', { name: 'Quilt Basics' })).toBeNull();
  });

  it('supports three levels, e.g. the register flow', () => {
    render(
      <PageHeader
        breadcrumb={[
          { label: 'Programs & Activities', to: '/events' },
          { label: 'Quilt Basics', to: '/events/evt-1' },
          { label: 'Register' }
        ]}
        eyebrow="Registration"
        title="Register For Quilt Basics"
      />
    );

    expect(screen.getByRole('link', { name: 'Programs & Activities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quilt Basics' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Register' })).toBeNull();
    expect(screen.getByText('Register')).toBeInTheDocument();
  });

  it('treats an entry with no `to` as plain text even in the middle of the trail', () => {
    render(
      <PageHeader
        breadcrumb={[
          { label: 'Programs & Activities', to: '/events' },
          { label: 'Untitled Event' },
          { label: 'Register' }
        ]}
        eyebrow="Registration"
        title="Register"
      />
    );

    expect(screen.queryByRole('link', { name: 'Untitled Event' })).toBeNull();
    expect(screen.getByText('Untitled Event')).toBeInTheDocument();
  });
});
