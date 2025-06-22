import React, { useState } from 'react';
import { Navigation } from './components/Navigation';
import { LandingPage } from './pages/LandingPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { UserDashboard } from './pages/UserDashboard';
import { TradingBot } from './pages/TradingBot';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { Toaster } from 'sonner'; // Import Toaster

function App() {
  const [currentPage, setCurrentPage] = useState('landing');
  const [userRole, setUserRole] = useState<'admin' | 'subscriber' | null>(null);

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
      default:
        return <LandingPage onLogin={(role) => {
          setUserRole(role);
          setCurrentPage(role === 'admin' ? 'admin' : 'dashboard');
        }} />;
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
        onLogout={() => {
          setCurrentPage('landing');
          setUserRole(null);
        }}
      />
      <main className="ml-64 min-h-screen">
        {renderPage()}
      </main>
      <Toaster richColors position="top-right" /> {/* Add Toaster component */}
    </div>
  );
}

export default App;