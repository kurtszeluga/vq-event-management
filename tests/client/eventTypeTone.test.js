import { describe, expect, it } from 'vitest';
import { EVENT_TYPES } from '../../src/data/eventOptions.js';
import { getEventTypeToneClass } from '../../src/utils/eventFormat.js';

// The tone class is what colours an event type pill. The colours themselves
// live in two stylesheets - .event-type-pill in src/styles.css for the app's
// own listings and .vq-feed-type in public/godaddy-event-feed.js for the
// website feed - so the class names here are the contract between the render
// sites and both of those. Silently producing the wrong slug would not break
// anything; the pill would just quietly fall back to the neutral tone, which
// is exactly the kind of regression nobody notices.

describe('the event type tone class', () => {
  it('slugs a type with punctuation in it', () => {
    expect(getEventTypeToneClass('Class (Half Day)')).toBe('is-class-half-day');
    expect(getEventTypeToneClass('Class (Full Day)')).toBe('is-class-full-day');
  });

  it('gives the two class types tones of their own', () => {
    // They share a colour, but each needs its own selector - a single
    // 'is-class' tone would mean the stylesheet could no longer tell them
    // apart if they are ever split.
    expect(getEventTypeToneClass('Class (Half Day)')).not.toBe(
      getEventTypeToneClass('Class (Full Day)')
    );
  });

  it('covers every type the event form offers', () => {
    // A type added to EVENT_TYPES without a tone renders the neutral pill. The
    // class still has to be well formed so adding the colour is a stylesheet
    // change on its own.
    EVENT_TYPES.forEach((eventType) => {
      expect(getEventTypeToneClass(eventType)).toMatch(/^is-[a-z0-9]+(-[a-z0-9]+)*$/);
    });
  });

  it('returns nothing for a missing type, rather than a dangling class', () => {
    expect(getEventTypeToneClass('')).toBe('');
    expect(getEventTypeToneClass(undefined)).toBe('');
    expect(getEventTypeToneClass(null)).toBe('');
    // Punctuation alone would otherwise slug to a bare hyphen.
    expect(getEventTypeToneClass('---')).toBe('');
  });
});
