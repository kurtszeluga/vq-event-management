const CLOSE_POLL_INTERVAL_MS = 300;

export function openManagedPopup(url, name, features, triggerElement) {
  const popup = window.open(url, name, features);

  if (!popup || !triggerElement) {
    return popup;
  }

  const timer = setInterval(() => {
    if (popup.closed) {
      clearInterval(timer);
      triggerElement.focus();
    }
  }, CLOSE_POLL_INTERVAL_MS);

  return popup;
}
