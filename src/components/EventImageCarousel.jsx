import { useState } from 'react';

// Drop-in replacement for the old single-`<img>`-or-placeholder ternary every
// listing card used. Renders identically to that (a bare `<img>`, or the same
// `.image-placeholder`) when there are 0 or 1 images, so nothing changes
// visually for the common case; prev/next controls only appear once there
// are 2+ photos to flip between - never a side-by-side strip.
function EventImageCarousel({ altText, imageUrls = [], placeholderLabel = 'No image uploaded' }) {
  const images = imageUrls.filter(Boolean);
  const [index, setIndex] = useState(0);

  if (!images.length) {
    return <div className="image-placeholder" aria-label={placeholderLabel} />;
  }

  if (images.length === 1) {
    return <img alt={altText} src={images[0]} />;
  }

  const currentIndex = ((index % images.length) + images.length) % images.length;

  return (
    <div className="event-image-carousel">
      <img alt={`${altText} - photo ${currentIndex + 1} of ${images.length}`} src={images[currentIndex]} />
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
      <div aria-hidden="true" className="carousel-dots">
        {images.map((url, dotIndex) => (
          <span
            className={`carousel-dot${dotIndex === currentIndex ? ' active' : ''}`}
            key={`${url}-${dotIndex}`}
          />
        ))}
      </div>
    </div>
  );
}

export default EventImageCarousel;
