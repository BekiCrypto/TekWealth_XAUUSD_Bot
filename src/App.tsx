import React, { useState } from 'react';
import { Navigation } from './components/Navigation';
import { LandingPage } from './pages/LandingPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { UserDashboard } from './pages/UserDashboard';
import { TradingBot } from './pages/TradingBot';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { Backtesting } from './pages/Backtesting'; // ✅ Added backtesting page
import { Toaster } from 'sonner'; // Import Toaster

function App() {
  const [currentPage, setCurrentPage] = useState('landing');
  const [userRole, setUserRole] = useState<'admin' | 'subscriber' | null>(null);
  const [userName, setUserName] = useState<string | undefined>();

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
      case 'backtesting':
        return <Backtesting />;
      default:
        return (
          <LandingPage
            onLogin={(role, name) => {
              setUserRole(role);
              setUserName(name);
              setCurrentPage(role === 'admin' ? 'admin' : 'dashboard');
            }}
          />
        );
    }
  };

  if (currentPage === 'landing') {
    return renderPage();
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Navigation
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        userRole={userRole}
        userName={userName}
        onLogout={() => {
          setCurrentPage('landing');
          setUserRole(null);
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

export default App;
