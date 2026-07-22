import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
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
import ProfilePage from './pages/ProfilePage.jsx';
import MyRegistrationsPage from './pages/MyRegistrationsPage.jsx';
import MemberDirectoryPage from './pages/MemberDirectoryPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import RequireAdmin from './components/RequireAdmin.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'my-registrations', element: <MyRegistrationsPage /> },
      { path: 'member-directory', element: <MemberDirectoryPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'business-listings', element: <BusinessListingsPage /> },
      { path: 'for-sale', element: <ForSalePage /> },
      { path: 'events/:eventId', element: <EventDetailsPage /> },
      { path: 'events/:eventId/print', element: <EventListingPrintPage /> },
      { path: 'events/:eventId/supply-list', element: <SupplyListViewerPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'register/:eventId', element: <RegisterPage /> },
      { path: 'events/:eventId/register', element: <RegisterPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
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
