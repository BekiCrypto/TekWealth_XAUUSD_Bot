import React, { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './components/auth/AuthProvider';
import { Navigation } from './components/Navigation';
import { LandingPage } from './pages/LandingPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { UserDashboard } from './pages/UserDashboard';
import { TradingBot } from './pages/TradingBot';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { TradingEnginePage } from './pages/TradingEngine';
import { useAuthContext } from './components/auth/AuthProvider';
import { tradingEngine } from './services/tradingEngine';

function AppContent() {
  const { user, profile, loading } = useAuthContext();
  const [currentPage, setCurrentPage] = useState('landing');

  useEffect(() => {
    // Effect to manage trading engine state and initial page based on authentication.
    if (user && profile) {
      // User is authenticated
      console.log('User authenticated, starting trading engine...');
      tradingEngine.startEngine()
        .then(() => console.log('Trading engine started successfully.'))
        .catch(error => {
          console.error('Failed to start trading engine:', error);
          // toast.error('Failed to start trading engine. Please contact support.'); // Consider if user needs to see this
        });
      
      // Navigate to the appropriate dashboard based on user role
      if (profile.role === 'admin') {
        setCurrentPage('admin');
      } else {
        setCurrentPage('dashboard');
      }
    } else if (!user && !loading) { // Ensure not loading to prevent premature stop on initial load
      // User is not authenticated (logged out or session expired)
      console.log('User not authenticated, stopping trading engine...');
      tradingEngine.stopEngine()
        .then(() => console.log('Trading engine stopped successfully.'))
        .catch(error => {
          console.error('Failed to stop trading engine:', error);
          // toast.error('Failed to stop trading engine.'); // Consider if user needs to see this
        });
      setCurrentPage('landing');
    }
  }, [user, profile, loading]); // Added loading to dependency array

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading GoldBot Pro...</p>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'admin':
        return <AdminDashboard />;
      case 'dashboard':
        return <UserDashboard />;
      case 'bot':
        return <TradingBot />;
      case 'analytics':
        return <Analytics />;
      case 'settings':
        return <Settings />;
      case 'engine':
        return <TradingEnginePage />;
      default:
        return <LandingPage />;
    }
  };

  if (!user || currentPage === 'landing') {
    return renderPage();
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Navigation 
        currentPage={currentPage} 
        onNavigate={setCurrentPage}
        userRole={profile?.role || null}
      />
      <main className="ml-64 min-h-screen">
        {renderPage()}
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1f2937',
            color: '#fff',
            border: '1px solid #374151'
          }
        }}
      />
    </AuthProvider>
  );
}

export default App;