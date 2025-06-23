import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, Clock } from 'lucide-react';
import { tradingEngine } from '../services/tradingEngine';

interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  change: number;
  changePercent: number;
  timestamp: Date;
}

export function MarketDataWidget() {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');

  useEffect(() => {
    const updatePriceData = () => {
      const engineStatus = tradingEngine.getEngineStatus();
      const marketData = engineStatus.marketData?.XAUUSD;
      
      if (marketData) {
        const currentPrice = (marketData.bid + marketData.ask) / 2;
        
        // Calculate price direction
        if (previousPrice !== null) {
          if (currentPrice > previousPrice) {
            setPriceDirection('up');
          } else if (currentPrice < previousPrice) {
            setPriceDirection('down');
          } else {
            setPriceDirection('neutral');
          }
        }
        
        setPreviousPrice(currentPrice);
        
        // Calculate change (simulated for demo)
        const change = previousPrice ? currentPrice - previousPrice : 0;
        const changePercent = previousPrice ? (change / previousPrice) * 100 : 0;
        
        setPriceData({
          symbol: 'XAUUSD',
          bid: marketData.bid,
          ask: marketData.ask,
          spread: marketData.spread,
          change,
          changePercent,
          timestamp: new Date(marketData.timestamp)
        });
      }
    };

    // Update immediately
    updatePriceData();
    
    // Update every second
    const interval = setInterval(updatePriceData, 1000);
    
    return () => clearInterval(interval);
  }, [previousPrice]);

  if (!priceData) {
    return (
      <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-6 h-6 text-yellow-400" />
          <h3 className="text-lg font-semibold text-white">Market Data</h3>
        </div>
        <div className="text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-600 border-t-yellow-400 rounded-full animate-spin mx-auto mb-2"></div>
          <p>Loading market data...</p>
        </div>
      </div>
    );
  }

  const midPrice = (priceData.bid + priceData.ask) / 2;
  const isPositive = priceData.change >= 0;

  return (
    <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-yellow-400" />
          <h3 className="text-lg font-semibold text-white">Market Data</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Clock className="w-4 h-4" />
          <span>{priceData.timestamp.toLocaleTimeString()}</span>
        </div>
      </div>

      {/* Main Price Display */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="text-2xl font-bold text-white">{priceData.symbol}</span>
          {priceDirection === 'up' && <TrendingUp className="w-6 h-6 text-green-400" />}
          {priceDirection === 'down' && <TrendingDown className="w-6 h-6 text-red-400" />}
        </div>
        
        <div className={`text-4xl font-bold mb-2 transition-colors duration-300 ${
          priceDirection === 'up' ? 'text-green-400' : 
          priceDirection === 'down' ? 'text-red-400' : 'text-white'
        }`}>
          ${midPrice.toFixed(2)}
        </div>
        
        <div className={`flex items-center justify-center gap-2 text-sm ${
          isPositive ? 'text-green-400' : 'text-red-400'
        }`}>
          {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          <span>{isPositive ? '+' : ''}{priceData.change.toFixed(2)}</span>
          <span>({isPositive ? '+' : ''}{priceData.changePercent.toFixed(2)}%)</span>
        </div>
      </div>

      {/* Bid/Ask Spread */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <div className="text-sm text-gray-400 mb-1">Bid</div>
          <div className="text-lg font-semibold text-red-400">${priceData.bid.toFixed(2)}</div>
        </div>
        
        <div className="text-center">
          <div className="text-sm text-gray-400 mb-1">Spread</div>
          <div className="text-lg font-semibold text-yellow-400">{priceData.spread.toFixed(1)}</div>
        </div>
        
        <div className="text-center">
          <div className="text-sm text-gray-400 mb-1">Ask</div>
          <div className="text-lg font-semibold text-green-400">${priceData.ask.toFixed(2)}</div>
        </div>
      </div>

      {/* Market Status */}
      <div className="flex items-center justify-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
        <span className="text-sm text-green-400 font-medium">Market Open</span>
      </div>
    </div>
  );
}