import React, { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import { AuthProvider, useAuthContext } from './components/auth/AuthProvider';
import { Navigation } from './components/Navigation';
import { LandingPage } from './pages/LandingPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { UserDashboard } from './pages/UserDashboard';
import { TradingBot } from './pages/TradingBot';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { TradingEnginePage } from './pages/TradingEngine';
import { tradingEngine } from './services/tradingEngine';

function AppContent() {
  const { user, profile, loading } = useAuthContext();
  const [currentPage, setCurrentPage] = useState('landing');
  const [userName, setUserName] = useState<string | undefined>();

  useEffect(() => {
    if (user && profile) {
      console.log('User authenticated, starting trading engine...');
      tradingEngine.startEngine()
        .then(() => console.log('Trading engine started successfully.'))
        .catch((error) => console.error('Failed to start trading engine:', error));

      if (profile.role === 'admin') {
        setCurrentPage('admin');
      } else {
        setCurrentPage('dashboard');
      }

      if (profile.name) {
        setUserName(profile.name);
      }
    } else if (!user && !loading) {
      console.log('User not authenticated, stopping trading engine...');
      tradingEngine.stopEngine()
        .then(() => console.log('Trading engine stopped successfully.'))
        .catch((error) => console.error('Failed to stop trading engine:', error));

      setCurrentPage('landing');
      setUserName(undefined);
    }
  }, [user, profile, loading]);

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
        userName={userName}
        onLogout={() => {
          setCurrentPage('landing');
          setUserName(undefined);
        }}
      />
      <main className="ml-64 min-h-screen">
        {renderPage()}
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;