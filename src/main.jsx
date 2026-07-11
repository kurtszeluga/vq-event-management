import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import HomePage from './pages/HomePage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import EventDetailsPage from './pages/EventDetailsPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
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
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:eventId', element: <EventDetailsPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
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
