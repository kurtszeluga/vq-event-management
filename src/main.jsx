import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import HomePage from './pages/HomePage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import BusinessListingsPage from './pages/BusinessListingsPage.jsx';
import ForSalePage from './pages/ForSalePage.jsx';
import EventDetailsPage from './pages/EventDetailsPage.jsx';
import SupplyListViewerPage from './pages/SupplyListViewerPage.jsx';
import EventListingPrintPage from './pages/EventListingPrintPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import TermsPage from './pages/TermsPage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';
import SupportPage from './pages/SupportPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import MyRegistrationsPage from './pages/MyRegistrationsPage.jsx';
import WaitlistClaimPage from './pages/WaitlistClaimPage.jsx';
import MemberDirectoryPage from './pages/MemberDirectoryPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import RegistrationListPrintPage from './pages/RegistrationListPrintPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import RequireAdmin from './components/RequireAdmin.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './styles.css';

// Safari held onto a stale app shell on July 26, 2026, mixing old client
// code with newer routes/data until website data was manually cleared. Keep
// the service worker on an aggressive update path so fresh deployments replace
// stale caches without needing that manual recovery.
const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateServiceWorker(true);
  },
  onOfflineReady() {}
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'my-registrations', element: <MyRegistrationsPage /> },
      { path: 'waitlist-claim', element: <WaitlistClaimPage /> },
      { path: 'member-directory', element: <MemberDirectoryPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'business-listings', element: <BusinessListingsPage /> },
      { path: 'for-sale', element: <ForSalePage /> },
      { path: 'events/:eventId', element: <EventDetailsPage /> },
      { path: 'events/:eventId/print', element: <EventListingPrintPage /> },
      { path: 'events/:eventId/supply-list', element: <SupplyListViewerPage documentKind="supply-list" /> },
      { path: 'events/:eventId/challenge-pdf', element: <SupplyListViewerPage documentKind="challenge-pdf" /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'register/:eventId', element: <RegisterPage /> },
      { path: 'events/:eventId/register', element: <RegisterPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'support', element: <SupportPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'profile/edit', element: <ProfilePage /> },
      { path: 'admin/profile/edit', element: <ProfilePage /> },
      {
        path: 'admin',
        element: (
          <RequireAdmin>
            <AdminDashboardPage />
          </RequireAdmin>
        )
      },
      {
        path: 'admin/events/:eventId/registrations/print',
        element: (
          <RequireAdmin>
            <RegistrationListPrintPage />
          </RequireAdmin>
        )
      }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
