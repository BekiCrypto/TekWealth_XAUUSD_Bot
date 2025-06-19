import React, { useState } from 'react';
import { 
  Shield, 
  TrendingUp, 
  Bot, 
  Users, 
  Crown, 
  CheckCircle,
  Star,
  Zap,
  BarChart3
} from 'lucide-react';

interface LandingPageProps {
  onLogin: (role: 'admin' | 'subscriber') => void;
}

export function LandingPage({ onLogin }: LandingPageProps) {
  const [showLogin, setShowLogin] = useState(false);

  const plans = [
    {
      name: 'Conservative',
      price: '299',
      period: 'month',
      description: 'Low-risk strategy with steady returns',
      features: [
        'Max 2% daily drawdown',
        'Conservative position sizing',
        'Basic analytics dashboard',
        'Email support',
        'Risk management tools'
      ],
      popular: false
    },
    {
      name: 'Medium Risk',
      price: '599',
      period: 'month',
      description: 'Balanced approach for optimal growth',
      features: [
        'Max 5% daily drawdown',
        'Advanced position sizing',
        'Real-time analytics',
        'Priority support',
        'Custom risk parameters',
        'Market scenario adaptation'
      ],
      popular: true
    },
    {
      name: 'High Risk',
      price: '999',
      period: 'month',
      description: 'Maximum returns with calculated risks',
      features: [
        'Max 10% daily drawdown',
        'Aggressive position sizing',
        'Advanced AI strategies',
        '24/7 dedicated support',
        'Full customization',
        'Multi-timeframe analysis',
        'VIP trading signals'
      ],
      popular: false
    }
  ];

  if (showLogin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-2xl p-8 shadow-2xl">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-gray-900" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Welcome Back</h2>
              <p className="text-gray-400">Access your trading dashboard</p>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => onLogin('admin')}
                className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 text-gray-900 font-semibold py-3 px-6 rounded-lg hover:from-yellow-400 hover:to-yellow-500 transition-all flex items-center justify-center gap-2"
              >
                <Crown className="w-5 h-5" />
                Admin Login
              </button>
              
              <button
                onClick={() => onLogin('subscriber')}
                className="w-full bg-gray-800 text-white font-semibold py-3 px-6 rounded-lg hover:bg-gray-700 transition-all flex items-center justify-center gap-2"
              >
                <Users className="w-5 h-5" />
                Subscriber Login
              </button>
            </div>

            <button
              onClick={() => setShowLogin(false)}
              className="w-full mt-6 text-gray-400 hover:text-gray-300 transition-colors"
            >
              ← Back to plans
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/10 to-transparent"></div>
        <div className="container mx-auto px-6 py-20">
          <div className="max-w-4xl mx-auto text-center">
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-xl flex items-center justify-center">
                <Shield className="w-8 h-8 text-gray-900" />
              </div>
              <h1 className="text-5xl font-bold text-white">GoldBot Pro</h1>
            </div>
            
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              Advanced AI-powered gold trading system with dynamic risk management 
              and proven profitable strategies for XAUUSD markets
            </p>

            <div className="flex flex-wrap justify-center gap-4 mb-12">
              <div className="flex items-center gap-2 bg-gray-900/50 px-4 py-2 rounded-full">
                <TrendingUp className="w-5 h-5 text-green-400" />
                <span className="text-gray-300">89.7% Win Rate</span>
              </div>
              <div className="flex items-center gap-2 bg-gray-900/50 px-4 py-2 rounded-full">
                <Bot className="w-5 h-5 text-blue-400" />
                <span className="text-gray-300">Fully Automated</span>
              </div>
              <div className="flex items-center gap-2 bg-gray-900/50 px-4 py-2 rounded-full">
                <BarChart3 className="w-5 h-5 text-purple-400" />
                <span className="text-gray-300">Real-time Analytics</span>
              </div>
            </div>

            <button
              onClick={() => setShowLogin(true)}
              className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-gray-900 font-bold py-4 px-8 rounded-lg hover:from-yellow-400 hover:to-yellow-500 transition-all transform hover:scale-105 shadow-lg"
            >
              Start Trading Now
            </button>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-20 bg-gray-900/30">
        <div className="container mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-white mb-16">
            Why Choose GoldBot Pro?
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
              <Zap className="w-12 h-12 text-yellow-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">Lightning Fast Execution</h3>
              <p className="text-gray-400">
                Execute trades in milliseconds with direct MT4/5 integration and zero latency
              </p>
            </div>
            
            <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
              <Shield className="w-12 h-12 text-green-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">Advanced Risk Management</h3>
              <p className="text-gray-400">
                Intelligent position sizing and dynamic stop-loss management protect your capital
              </p>
            </div>
            
            <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
              <BarChart3 className="w-12 h-12 text-blue-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">Professional Analytics</h3>
              <p className="text-gray-400">
                Comprehensive reporting with daily, weekly, and monthly performance insights
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Section */}
      <div className="py-20">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Choose Your Trading Strategy</h2>
            <p className="text-gray-400 text-lg">
              Select the risk level that matches your trading goals
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {plans.map((plan, index) => (
              <div
                key={index}
                className={`relative bg-gray-900/50 backdrop-blur-xl border rounded-2xl p-8 ${
                  plan.popular 
                    ? 'border-yellow-500 shadow-2xl shadow-yellow-500/20' 
                    : 'border-gray-800'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <div className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-gray-900 px-4 py-1 rounded-full text-sm font-semibold flex items-center gap-1">
                      <Star className="w-4 h-4" />
                      Most Popular
                    </div>
                  </div>
                )}
                
                <div className="text-center mb-8">
                  <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                  <p className="text-gray-400 mb-4">{plan.description}</p>
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-4xl font-bold text-white">${plan.price}</span>
                    <span className="text-gray-400">/{plan.period}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Paid in USDT (BEP20)</p>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                      <span className="text-gray-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => setShowLogin(true)}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all ${
                    plan.popular
                      ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-gray-900 hover:from-yellow-400 hover:to-yellow-500'
                      : 'bg-gray-800 text-white hover:bg-gray-700'
                  }`}
                >
                  Get Started
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}