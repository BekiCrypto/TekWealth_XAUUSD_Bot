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
    // Auto-start trading engine when user is authenticated
    if (user && profile) {
      tradingEngine.startEngine().catch(console.error);
      
      // Navigate to appropriate dashboard
      if (profile.role === 'admin') {
        setCurrentPage('admin');
      } else {
        setCurrentPage('dashboard');
      }
    } else {
      // Stop trading engine when user logs out
      tradingEngine.stopEngine().catch(console.error);
      setCurrentPage('landing');
    }
  }, [user, profile]);

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