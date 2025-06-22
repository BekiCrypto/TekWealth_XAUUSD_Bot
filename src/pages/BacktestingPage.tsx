// src/pages/BacktestingPage.tsx
import React, { useState, useEffect } from 'react';
import { tradingService } from '../services/tradingService'; // Assuming tradingService is correctly exported
import { useAuth } from '../hooks/useAuth'; // Assuming you have an auth hook for userId

// Define interfaces for the data we expect (mirroring backend or simplifying)
interface BacktestParams {
  userId?: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  strategySettings: {
    shortPeriod: number;
    longPeriod: number;
  };
  riskSettings: {
    riskLevel: 'conservative' | 'medium' | 'risky'; // Or more detailed if needed
    maxLotSize: number;
    stopLossPips: number;
  };
}

interface BacktestReport {
  id: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_trades: number;
  total_profit_loss: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  created_at: string;
  trades?: any[]; // Array of simulated trades
  // ... other summary fields from backtest_reports table
}

const BacktestingPage: React.FC = () => {
  const { user } = useAuth(); // Get current user
  const [params, setParams] = useState<Partial<BacktestParams>>({
    symbol: 'XAUUSD',
    timeframe: '15min',
    startDate: new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0], // Default to 1 year ago
    endDate: new Date().toISOString().split('T')[0], // Default to today
    strategySettings: { shortPeriod: 20, longPeriod: 50 },
    riskSettings: { riskLevel: 'conservative', maxLotSize: 0.01, stopLossPips: 200 },
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [currentReport, setCurrentReport] = useState<BacktestReport | null>(null);
  const [pastReports, setPastReports] = useState<BacktestReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      setParams(prev => ({ ...prev, userId: user.id }));
      loadPastReports(user.id);
    }
  }, [user]);

  const loadPastReports = async (userId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await tradingService.listBacktests(userId);
      if (response.error) throw response.error;
      setPastReports(response.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load past reports');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchHistoricalData = async () => {
    setLoading(true);
    setError(null);
    try {
        // Example: Fetch last 3 months of 15min data
        // Adjust params as needed, or add UI fields for this
        const historicalDataParams = {
            symbol: params.symbol || 'XAUUSD',
            fromCurrency: 'XAU', // Assuming XAU/USD
            toCurrency: 'USD',
            interval: params.timeframe || '15min',
            outputsize: 'full' // Fetch more data for backtesting period
        };
        const response = await tradingService.fetchHistoricalData(historicalDataParams);
        if (response.error) throw response.error;
        alert(`Historical data fetch initiated: ${response.data?.message || 'Check logs'}`);
    } catch (err:any) {
        setError(err.message || 'Failed to fetch historical data');
        alert(`Error fetching historical data: ${err.message}`);
    } finally {
        setLoading(false);
    }
  }

  const handleRunBacktest = async () => {
    if (!params.startDate || !params.endDate) {
      setError("Start date and end date are required.");
      return;
    }
    setLoading(true);
    setError(null);
    setCurrentReport(null);
    try {
      const runParams: BacktestParams = {
        userId: user?.id,
        symbol: params.symbol || 'XAUUSD',
        timeframe: params.timeframe || '15min',
        startDate: params.startDate,
        endDate: params.endDate,
        strategySettings: params.strategySettings || { shortPeriod: 20, longPeriod: 50 },
        riskSettings: params.riskSettings || { riskLevel: 'conservative', maxLotSize: 0.01, stopLossPips: 200 },
      };
      const response = await tradingService.runBacktest(runParams);
      if (response.error) throw response.error;
      setCurrentReport(response.data);
      if (user?.id) loadPastReports(user.id); // Refresh list
    } catch (err: any) {
      setError(err.message || 'Failed to run backtest');
    } finally {
      setLoading(false);
    }
  };

  const handleViewReport = async (reportId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await tradingService.getBacktestReport(reportId);
      if (response.error) throw response.error;
      setCurrentReport(response.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load report details');
    } finally {
      setLoading(false);
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;

    if (name.startsWith("strategySettings.")) {
        const key = name.split(".")[1] as keyof BacktestParams['strategySettings'];
        setParams(prev => ({
            ...prev,
            strategySettings: { ...prev.strategySettings!, [key]: type === 'number' ? parseFloat(value) : value }
        }));
    } else if (name.startsWith("riskSettings.")) {
        const key = name.split(".")[1] as keyof BacktestParams['riskSettings'];
         setParams(prev => ({
            ...prev,
            riskSettings: { ...prev.riskSettings!, [key]: type === 'number' ? parseFloat(value) : value }
        }));
    } else {
        setParams(prev => ({ ...prev, [name]: type === 'number' ? parseFloat(value) : value }));
    }
  };


  return (
    <div style={{ padding: '20px' }}>
      <h1>Strategy Backtester</h1>

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '10px' }}>
        <h2>Configure Backtest</h2>
        <div>
          <label>Symbol: </label>
          <input name="symbol" value={params.symbol} onChange={handleChange} />
        </div>
        <div>
          <label>Timeframe: </label>
          <select name="timeframe" value={params.timeframe} onChange={handleChange}>
            <option value="15min">15 Minutes</option>
            <option value="1hour">1 Hour</option>
            <option value="daily">Daily</option>
          </select>
        </div>
        <div>
          <label>Start Date: </label>
          <input type="date" name="startDate" value={params.startDate} onChange={handleChange} />
        </div>
        <div>
          <label>End Date: </label>
          <input type="date" name="endDate" value={params.endDate} onChange={handleChange} />
        </div>
        <fieldset style={{margin: '10px 0'}}>
            <legend>Strategy Settings (SMA)</legend>
            <div><label>Short Period: <input type="number" name="strategySettings.shortPeriod" value={params.strategySettings?.shortPeriod} onChange={handleChange} /></label></div>
            <div><label>Long Period: <input type="number" name="strategySettings.longPeriod" value={params.strategySettings?.longPeriod} onChange={handleChange} /></label></div>
        </fieldset>
        <fieldset style={{margin: '10px 0'}}>
            <legend>Risk Settings</legend>
            <div><label>Max Lot Size: <input type="number" step="0.01" name="riskSettings.maxLotSize" value={params.riskSettings?.maxLotSize} onChange={handleChange} /></label></div>
            <div><label>Stop Loss Pips: <input type="number" name="riskSettings.stopLossPips" value={params.riskSettings?.stopLossPips} onChange={handleChange} /></label></div>
        </fieldset>
        <button onClick={handleFetchHistoricalData} disabled={loading} style={{marginRight: '10px'}}>
            {loading ? 'Fetching Data...' : 'Fetch/Update Historical Data for Period'}
        </button>
        <button onClick={handleRunBacktest} disabled={loading}>
          {loading ? 'Running...' : 'Run Backtest'}
        </button>
      </div>

      {currentReport && (
        <div style={{ marginTop: '20px', border: '1px solid #ccc', padding: '10px' }}>
          <h2>Backtest Report: {currentReport.id}</h2>
          <p>Period: {new Date(currentReport.start_date).toLocaleDateString()} - {new Date(currentReport.end_date).toLocaleDateString()}</p>
          <p>Symbol: {currentReport.symbol} ({currentReport.timeframe})</p>
          <p>Total Trades: {currentReport.total_trades}</p>
          <p>Total P/L: ${currentReport.total_profit_loss?.toFixed(2)}</p>
          <p>Win Rate: {currentReport.win_rate?.toFixed(2)}%</p>
          <p>Wins: {currentReport.winning_trades} / Losses: {currentReport.losing_trades}</p>
          <h3>Simulated Trades:</h3>
          <div style={{maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee'}}>
            <table style={{width: '100%', borderCollapse: 'collapse'}}>
                <thead>
                    <tr>
                        <th>Entry Time</th><th>Type</th><th>Entry Price</th><th>Exit Time</th><th>Exit Price</th><th>P/L</th><th>Reason</th>
                    </tr>
                </thead>
                <tbody>
                {currentReport.trades?.map((trade: any, index: number) => (
                    <tr key={index}>
                    <td>{new Date(trade.entryTime).toLocaleString()}</td>
                    <td>{trade.tradeType}</td>
                    <td>{trade.entryPrice?.toFixed(4)}</td>
                    <td>{trade.exitTime ? new Date(trade.exitTime).toLocaleString() : 'N/A'}</td>
                    <td>{trade.exitPrice?.toFixed(4)}</td>
                    <td style={{color: trade.profitOrLoss > 0 ? 'green' : (trade.profitOrLoss < 0 ? 'red' : 'black')}}>{trade.profitOrLoss?.toFixed(2)}</td>
                    <td>{trade.closeReason}</td>
                    </tr>
                ))}
                </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: '30px' }}>
        <h2>Past Backtest Reports</h2>
        {pastReports.length === 0 && <p>No past reports found.</p>}
        <ul style={{listStyle: 'none', padding: 0}}>
          {pastReports.map(report => (
            <li key={report.id} style={{ border: '1px solid #eee', padding: '10px', marginBottom: '5px', cursor: 'pointer'}} onClick={() => handleViewReport(report.id)}>
              ID: {report.id} ({new Date(report.created_at).toLocaleDateString()}) <br/>
              {report.symbol} {report.timeframe} | P/L: ${report.total_profit_loss?.toFixed(2)} | Win Rate: {report.win_rate?.toFixed(2)}%
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default BacktestingPage;
