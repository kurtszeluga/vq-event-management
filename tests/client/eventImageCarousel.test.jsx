import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventImageCarousel from '../../src/components/EventImageCarousel.jsx';

const AUTO_ROTATE_INTERVAL_MS = 4000;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EventImageCarousel', () => {
  it('renders the existing blank placeholder when there are no images and no known type', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" imageUrls={[]} />);

    expect(screen.getByLabelText('No image uploaded')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the default quilt-block image for a type that has one', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" eventType="Workshop" imageUrls={[]} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/assets/event-placeholders/workshop.svg');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the existing blank placeholder for types with no default image', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" eventType="For Sale" imageUrls={[]} />);

    expect(screen.getByLabelText('No image uploaded')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('prefers a real uploaded photo over the default image', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" eventType="Workshop" imageUrls={['photo-1.jpg']} />);

    expect(screen.getByAltText('Guild Retreat thumbnail')).toHaveAttribute('src', 'photo-1.jpg');
  });

  it('renders the image with no controls but a singular "1 Photo" caption when there is exactly one', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" imageUrls={['photo-1.jpg']} />);

    expect(screen.getByAltText('Guild Retreat thumbnail')).toHaveAttribute('src', 'photo-1.jpg');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('1 Photo')).toBeInTheDocument();
  });

  it('ignores blank slots mixed in with real images', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" imageUrls={['', 'photo-1.jpg', '']} />);

    expect(screen.getByAltText('Guild Retreat thumbnail')).toHaveAttribute('src', 'photo-1.jpg');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows prev/next controls and dots once there are 2+ images, starting on the first', () => {
    render(
      <EventImageCarousel
        altText="Guild Retreat thumbnail"
        imageUrls={['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']}
      />
    );

    expect(screen.getByAltText(/photo 1 of 3/)).toHaveAttribute('src', 'photo-1.jpg');
    expect(screen.getByText('3 Photos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeInTheDocument();
    expect(document.querySelectorAll('.carousel-dot')).toHaveLength(3);
  });

  it('advances to the next image and wraps around after the last', async () => {
    const user = userEvent.setup();
    render(
      <EventImageCarousel
        altText="Guild Retreat thumbnail"
        imageUrls={['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']}
      />
    );

    const nextButton = screen.getByRole('button', { name: 'Next photo' });
    await user.click(nextButton);
    expect(screen.getByAltText(/photo 2 of 3/)).toHaveAttribute('src', 'photo-2.jpg');

    await user.click(nextButton);
    expect(screen.getByAltText(/photo 3 of 3/)).toHaveAttribute('src', 'photo-3.jpg');

    await user.click(nextButton);
    expect(screen.getByAltText(/photo 1 of 3/)).toHaveAttribute('src', 'photo-1.jpg');
  });

  it('goes backward and wraps around before the first', async () => {
    const user = userEvent.setup();
    render(
      <EventImageCarousel
        altText="Guild Retreat thumbnail"
        imageUrls={['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByAltText(/photo 3 of 3/)).toHaveAttribute('src', 'photo-3.jpg');
  });

  it('marks the current dot active', async () => {
    const user = userEvent.setup();
    render(
      <EventImageCarousel
        altText="Guild Retreat thumbnail"
        imageUrls={['photo-1.jpg', 'photo-2.jpg']}
      />
    );

    const dots = () => document.querySelectorAll('.carousel-dot');
    expect(dots()[0].className).toContain('active');
    expect(dots()[1].className).not.toContain('active');

    await user.click(screen.getByRole('button', { name: 'Next photo' }));

    expect(dots()[0].className).not.toContain('active');
    expect(dots()[1].className).toContain('active');
  });

  it('does not show a pause toggle for 0 or 1 images', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" imageUrls={['photo-1.jpg']} />);

    expect(screen.queryByRole('button', { name: /automatic photo rotation/ })).toBeNull();
  });

  it('rotates to the next image automatically, and wraps around', () => {
    vi.useFakeTimers();
    render(
      <EventImageCarousel
        altText="Guild Retreat thumbnail"
        imageUrls={['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']}
      />
    );

    expect(screen.getByAltText(/photo 1 of 3/)).toHaveAttribute('src', 'photo-1.jpg');

    act(() => {
      vi.advanceTimersByTime(AUTO_ROTATE_INTERVAL_MS);
    });
    expect(screen.getByAltText(/photo 2 of 3/)).toHaveAttribute('src', 'photo-2.jpg');

    act(() => {
      vi.advanceTimersByTime(AUTO_ROTATE_INTERVAL_MS * 2);
    });
    expect(screen.getByAltText(/photo 1 of 3/)).toHaveAttribute('src', 'photo-1.jpg');
  });

  it('stops rotating once paused, and resumes when unpaused', () => {
    vi.useFakeTimers();
    render(
      <EventImageCarousel
        altText="Guild Retreat thumbnail"
        imageUrls={['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']}
      />
    );

    act(() => {
      screen.getByRole('button', { name: 'Pause automatic photo rotation' }).click();
    });

    act(() => {
      vi.advanceTimersByTime(AUTO_ROTATE_INTERVAL_MS * 3);
    });
    // Still on the first image - the timer never restarted while paused.
    expect(screen.getByAltText(/photo 1 of 3/)).toHaveAttribute('src', 'photo-1.jpg');

    act(() => {
      screen.getByRole('button', { name: 'Resume automatic photo rotation' }).click();
    });

    act(() => {
      vi.advanceTimersByTime(AUTO_ROTATE_INTERVAL_MS);
    });
    expect(screen.getByAltText(/photo 2 of 3/)).toHaveAttribute('src', 'photo-2.jpg');
  });

  it('gives a manual click a fresh full interval before the next auto-advance', () => {
    vi.useFakeTimers();
    render(
      <EventImageCarousel
        altText="Guild Retreat thumbnail"
        imageUrls={['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']}
      />
    );

    act(() => {
      vi.advanceTimersByTime(AUTO_ROTATE_INTERVAL_MS - 500);
    });
    expect(screen.getByAltText(/photo 1 of 3/)).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'Next photo' }).click();
    });
    expect(screen.getByAltText(/photo 2 of 3/)).toBeInTheDocument();

    // If the old timer had survived, this would already be past photo 2.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByAltText(/photo 2 of 3/)).toBeInTheDocument();
  });
});
