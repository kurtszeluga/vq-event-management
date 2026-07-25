import { afterEach, describe, expect, it, vi } from 'vitest';
import { openManagedPopup } from '../../src/utils/popupWindow.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('openManagedPopup', () => {
  it('restores focus to the trigger element once the popup closes', () => {
    vi.useFakeTimers();

    const popup = { closed: false };
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const trigger = document.createElement('button');
    trigger.focus = vi.fn();

    openManagedPopup('/supply-list', 'vq-supply-list', 'popup', trigger);

    vi.advanceTimersByTime(300);
    expect(trigger.focus).not.toHaveBeenCalled();

    popup.closed = true;
    vi.advanceTimersByTime(300);
    expect(trigger.focus).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(600);
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the popup fails to open', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const trigger = document.createElement('button');
    trigger.focus = vi.fn();

    expect(() => openManagedPopup('/supply-list', 'vq-supply-list', 'popup', trigger)).not.toThrow();
    expect(trigger.focus).not.toHaveBeenCalled();
  });
});
