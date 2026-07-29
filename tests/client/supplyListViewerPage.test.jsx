import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SupplyListViewerPage from '../../src/pages/SupplyListViewerPage.jsx';
import { getEvent } from '../../src/services/eventService.js';

vi.mock('../../src/services/eventService.js', () => ({
  getEvent: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderViewer() {
  return render(
    <MemoryRouter initialEntries={['/events/event-1/supply-list']}>
      <Routes>
        <Route path="/events/:eventId/supply-list" element={<SupplyListViewerPage />} />
        <Route path="/events" element={<div>Events list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SupplyListViewerPage', () => {
  it('moves focus to the document heading once it loads', async () => {
    getEvent.mockResolvedValue({
      id: 'event-1',
      status: 'Published',
      supplyListTitle: 'Packing List',
      supplyListUrl: 'https://example.com/packing-list.pdf'
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    renderViewer();

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Packing List' }));
    });
  });

  it('closes on Escape', async () => {
    getEvent.mockResolvedValue({
      id: 'event-1',
      status: 'Published',
      supplyListTitle: 'Packing List',
      supplyListUrl: 'https://example.com/packing-list.pdf'
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const user = userEvent.setup();
    renderViewer();

    await screen.findByRole('heading', { name: 'Packing List' });
    await user.keyboard('{Escape}');

    expect(await screen.findByText('Events list')).toBeInTheDocument();
  });

  it('falls back to the in-app events list when there is no browser history to return to (e.g. a direct/bookmarked visit)', async () => {
    getEvent.mockResolvedValue({
      id: 'event-1',
      status: 'Published',
      supplyListTitle: 'Packing List',
      supplyListUrl: 'https://example.com/packing-list.pdf'
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);

    const user = userEvent.setup();
    renderViewer();

    await screen.findByRole('heading', { name: 'Packing List' });
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(await screen.findByText('Events list')).toBeInTheDocument();
  });

  it('returns to the referring page (e.g. GoDaddy) via browser history instead of the in-app events list', async () => {
    getEvent.mockResolvedValue({
      id: 'event-1',
      status: 'Published',
      supplyListTitle: 'Packing List',
      supplyListUrl: 'https://example.com/packing-list.pdf'
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/referring-page', '/events/event-1/supply-list']} initialIndex={1}>
        <Routes>
          <Route path="/events/:eventId/supply-list" element={<SupplyListViewerPage />} />
          <Route path="/events" element={<div>Events list</div>} />
          <Route path="/referring-page" element={<div>Referring page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'Packing List' });
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(await screen.findByText('Referring page')).toBeInTheDocument();
  });
});
