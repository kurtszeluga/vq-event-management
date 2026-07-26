import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import EventImageCarousel from '../../src/components/EventImageCarousel.jsx';

afterEach(cleanup);

describe('EventImageCarousel', () => {
  it('renders the existing placeholder when there are no images', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" imageUrls={[]} />);

    expect(screen.getByLabelText('No image uploaded')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a bare image with no controls when there is exactly one', () => {
    render(<EventImageCarousel altText="Guild Retreat thumbnail" imageUrls={['photo-1.jpg']} />);

    expect(screen.getByAltText('Guild Retreat thumbnail')).toHaveAttribute('src', 'photo-1.jpg');
    expect(screen.queryByRole('button')).toBeNull();
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
});
