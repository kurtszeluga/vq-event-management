import { useEffect, useState } from 'react';
import { getEventPlaceholderImage } from '../data/eventOptions.js';

const AUTO_ROTATE_INTERVAL_MS = 4000;

// Drop-in replacement for the old single-`<img>`-or-placeholder ternary every
// listing card used, plus a small "N Photos" caption under the image. Prev/
// next controls, the pause toggle, and auto-rotation only appear once there
// are 2+ photos to flip between - never a side-by-side strip - but the photo
// count caption shows for any single image too. The pause toggle is a WCAG
// 2.2.2 requirement for any auto-updating content, not just a nicety.
function EventImageCarousel({ altText, eventType, imageUrls = [], placeholderLabel = 'No image uploaded' }) {
  const images = imageUrls.filter(Boolean);
  const hasMultiple = images.length > 1;
  const [index, setIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Re-created whenever `index` changes, whether from this timer or a manual
  // arrow click - so a manual click always gets a full fresh interval before
  // the next auto-advance, rather than one that could land moments later.
  useEffect(() => {
    if (!hasMultiple || isPaused) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setIndex((current) => current + 1);
    }, AUTO_ROTATE_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [hasMultiple, isPaused, index]);

  if (!images.length) {
    const defaultImage = getEventPlaceholderImage(eventType);

    if (defaultImage) {
      return <img alt={placeholderLabel} src={defaultImage} />;
    }

    return <div className="image-placeholder" aria-label={placeholderLabel} />;
  }

  const currentIndex = ((index % images.length) + images.length) % images.length;

  return (
    <div className="event-image-carousel">
      <img
        alt={hasMultiple ? `${altText} - photo ${currentIndex + 1} of ${images.length}` : altText}
        src={images[currentIndex]}
      />
      {hasMultiple ? (
        <>
          <button
            aria-label="Previous photo"
            className="carousel-arrow carousel-arrow-prev"
            type="button"
            onClick={() => setIndex((current) => current - 1)}
          >
            <span aria-hidden="true" className="carousel-chevron carousel-chevron-prev" />
          </button>
          <button
            aria-label="Next photo"
            className="carousel-arrow carousel-arrow-next"
            type="button"
            onClick={() => setIndex((current) => current + 1)}
          >
            <span aria-hidden="true" className="carousel-chevron carousel-chevron-next" />
          </button>
          <button
            aria-label={isPaused ? 'Resume automatic photo rotation' : 'Pause automatic photo rotation'}
            aria-pressed={isPaused}
            className="carousel-toggle"
            type="button"
            onClick={() => setIsPaused((current) => !current)}
          >
            {isPaused ? (
              <span aria-hidden="true" className="carousel-play-icon" />
            ) : (
              <span aria-hidden="true" className="carousel-pause-icon">
                <span className="carousel-pause-bar" />
                <span className="carousel-pause-bar" />
              </span>
            )}
          </button>
          <div aria-hidden="true" className="carousel-dots">
            {images.map((url, dotIndex) => (
              <span
                className={`carousel-dot${dotIndex === currentIndex ? ' active' : ''}`}
                key={`${url}-${dotIndex}`}
              />
            ))}
          </div>
        </>
      ) : null}
      <p className="carousel-photo-count">{formatPhotoCount(images.length)}</p>
    </div>
  );
}

export function formatPhotoCount(count) {
  return count === 1 ? '1 Photo' : `${count} Photos`;
}

export default EventImageCarousel;
