// src/pages/BacktestingPage.tsx
import React, { useState, useEffect } from 'react';
import { tradingService, StrategyParams } from '../services/tradingService';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner'; // Import toast

// Define interface for the data structure this page will manage
interface UIPerBacktestParams {
  userId?: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  strategySelectionMode: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY';
  strategyParams: Partial<StrategyParams>; // Use the imported type, allow partial for form state
  riskSettings: {
    riskLevel: 'conservative' | 'medium' | 'risky';
    maxLotSize?: number; // This will likely be determined by riskLevel on backend
  };
  commissionPerLot?: number; // New
  slippagePoints?: number;   // New
}

// Interface for the report structure returned by the backend
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
  strategy_selection_mode?: string; // Added
  strategy_params?: StrategyParams;  // Added
  risk_settings?: any;               // Added
  trades?: Array<{ // Define structure for individual trades in the report
    entryTime: string;
    entryPrice: number;
    exitTime?: string;
    exitPrice?: number;
    tradeType: 'BUY' | 'SELL';
    lotSize: number;
    stopLossPrice: number;
    takeProfitPrice?: number | null;
    profitOrLoss?: number;
    closeReason?: string;
  }>;
}

const BacktestingPage: React.FC = () => {
  const { user } = useAuth();
  const [params, setParams] = useState<UIPerBacktestParams>({
    userId: undefined,
    symbol: 'XAUUSD',
    timeframe: '15min',
    startDate: new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    strategySelectionMode: 'ADAPTIVE',
    strategyParams: {
      smaShortPeriod: 20, smaLongPeriod: 50,
      bbPeriod: 20, bbStdDevMult: 2,
      rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
      adxPeriod: 14, adxTrendMinLevel: 25, adxRangeThreshold: 20, adxTrendThreshold: 25,
      atrPeriod: 14, atrMultiplierSL: 1.5, atrMultiplierTP: 3.0,
      breakoutLookbackPeriod: 50, atrSpikeMultiplier: 1.5,
    },
    riskSettings: { riskLevel: 'conservative' },
    commissionPerLot: 0, // Default commission
    slippagePoints: 0,   // Default slippage
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
    setLoading(true); setError(null);
    try {
      const response = await tradingService.listBacktests(userId);
      if (response.error) throw response.error;
      setPastReports(response.data || []);
    } catch (err: any) { setError(err.message || 'Failed to load past reports'); }
    finally { setLoading(false); }
  };

  const handleFetchHistoricalData = async () => {
    setLoading(true); setError(null);
    try {
        const historicalDataParams = {
            symbol: params.symbol || 'XAUUSD',
            fromCurrency: 'XAU', toCurrency: 'USD',
            interval: params.timeframe || '15min',
            outputsize: 'full'
        };
        const response = await tradingService.fetchHistoricalData(historicalDataParams);
        if (response.error) throw response.error;

        const message = response.data?.message || (response.data?.success ? 'Successfully fetched/updated historical data.' : 'Historical data operation completed, but status unclear or no new data.');
        if (response.data?.success || response.data?.inserted > 0) {
            toast.success(message);
        } else {
            toast.info(message); // Use info for neutral messages
        }
    } catch (err:any) {
        const errorMessage = err.message || 'Failed to fetch historical data';
        setError(errorMessage);
        toast.error(`Error fetching historical data: ${errorMessage}`);
    }
    finally { setLoading(false); }
  };

  const handleRunBacktest = async () => {
    if (!params.startDate || !params.endDate || !params.strategyParams) {
      setError("Start date, end date, and strategy parameters are required.");
      return;
    }
    setLoading(true); setError(null); setCurrentReport(null);
    try {
      // Construct the params for the service call carefully
      const runParamsPayload = {
        userId: user?.id,
        symbol: params.symbol,
        timeframe: params.timeframe,
        startDate: params.startDate,
        endDate: params.endDate,
        strategySelectionMode: params.strategySelectionMode,
        strategyParams: params.strategyParams as StrategyParams, // Ensure all defaults are covered if not in UI
        riskSettings: {
            riskLevel: params.riskSettings.riskLevel,
            ...(params.riskSettings.maxLotSize && { maxLotSize: params.riskSettings.maxLotSize })
        },
        commissionPerLot: params.commissionPerLot, // Add commission
        slippagePoints: params.slippagePoints     // Add slippage
      };
      const response = await tradingService.runBacktest(runParamsPayload);
      if (response.error) throw response.error;
      setCurrentReport(response.data as BacktestReport); // Cast to ensure type
      if (user?.id) loadPastReports(user.id);
    } catch (err: any) { setError(err.message || 'Failed to run backtest'); }
    finally { setLoading(false); }
  };

  const handleViewReport = async (reportId: string) => {
    setLoading(true); setError(null);
    try {
      const response = await tradingService.getBacktestReport(reportId);
      if (response.error) throw response.error;
      setCurrentReport(response.data as BacktestReport);
    } catch (err: any) { setError(err.message || 'Failed to load report details'); }
    finally { setLoading(false); }
  };

  const handleParamChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const type = e.target.type; // For input type="number"
    const parsedValue = type === 'number' ? (value === '' ? undefined : parseFloat(value)) : value;

    setParams(prev => {
        const newParams = JSON.parse(JSON.stringify(prev)); // Deep copy for nested state

        if (name === 'strategySelectionMode') {
            newParams.strategySelectionMode = parsedValue as UIPerBacktestParams['strategySelectionMode'];
        } else if (name === 'riskLevel') {
            newParams.riskSettings.riskLevel = parsedValue as UIPerBacktestParams['riskSettings']['riskLevel'];
        } else if (name === 'maxLotSize') {
            newParams.riskSettings.maxLotSize = parsedValue as number | undefined;
        } else if (Object.keys(newParams.strategyParams).includes(name)) {
            (newParams.strategyParams as any)[name] = parsedValue;
        } else { // Top-level params like symbol, timeframe, startDate, endDate
            (newParams as any)[name] = parsedValue;
        }
        return newParams;
    });
};


  const renderStrategyParamsInputs = () => {
    const sp = params.strategyParams; // shortcut
    return (
      <>
        <fieldset style={{margin: '10px 0', border: '1px dashed #888', padding: '10px', background: '#222'}}>
          <legend style={{color: '#ddd'}}>Global ATR (for SL/TP)</legend>
          <div><label>ATR Period: <input type="number" name="atrPeriod" value={sp.atrPeriod ?? 14} onChange={handleParamChange} /></label></div>
          <div><label>ATR SL Multiplier: <input type="number" step="0.1" name="atrMultiplierSL" value={sp.atrMultiplierSL ?? 1.5} onChange={handleParamChange} /></label></div>
          <div><label>ATR TP Multiplier: <input type="number" step="0.1" name="atrMultiplierTP" value={sp.atrMultiplierTP ?? 3.0} onChange={handleParamChange} /></label></div>
        </fieldset>

        {(params.strategySelectionMode === 'SMA_ONLY' || params.strategySelectionMode === 'ADAPTIVE') && (
          <fieldset style={{margin: '10px 0', border: '1px dashed #888', padding: '10px', background: '#222'}}>
            <legend style={{color: '#ddd'}}>SMA Crossover Settings</legend>
            <div><label>SMA Short: <input type="number" name="smaShortPeriod" value={sp.smaShortPeriod ?? 20} onChange={handleParamChange} /></label></div>
            <div><label>SMA Long: <input type="number" name="smaLongPeriod" value={sp.smaLongPeriod ?? 50} onChange={handleParamChange} /></label></div>
            {(params.strategySelectionMode === 'ADAPTIVE') && <div><label>ADX Confirm Level (for SMA): <input type="number" name="adxTrendMinLevel" value={sp.adxTrendMinLevel ?? 25} onChange={handleParamChange} /></label></div>}
          </fieldset>
        )}

        {(params.strategySelectionMode === 'MEAN_REVERSION_ONLY' || params.strategySelectionMode === 'ADAPTIVE') && (
          <fieldset style={{margin: '10px 0', border: '1px dashed #888', padding: '10px', background: '#222'}}>
            <legend style={{color: '#ddd'}}>Mean Reversion (BB+RSI) Settings</legend>
            <div><label>BB Period: <input type="number" name="bbPeriod" value={sp.bbPeriod ?? 20} onChange={handleParamChange} /></label></div>
            <div><label>BB StdDev Mult: <input type="number" step="0.1" name="bbStdDevMult" value={sp.bbStdDevMult ?? 2} onChange={handleParamChange} /></label></div>
            <div><label>RSI Period: <input type="number" name="rsiPeriod" value={sp.rsiPeriod ?? 14} onChange={handleParamChange} /></label></div>
            <div><label>RSI Oversold: <input type="number" name="rsiOversold" value={sp.rsiOversold ?? 30} onChange={handleParamChange} /></label></div>
            <div><label>RSI Overbought: <input type="number" name="rsiOverbought" value={sp.rsiOverbought ?? 70} onChange={handleParamChange} /></label></div>
          </fieldset>
        )}
         {(params.strategySelectionMode === 'BREAKOUT_ONLY' || params.strategySelectionMode === 'ADAPTIVE') && (
            <fieldset style={{margin: '10px 0', border: '1px dashed #888', padding: '10px', background: '#222'}}>
                <legend style={{color: '#ddd'}}>Breakout Settings</legend>
                <div><label>Breakout Lookback: <input type="number" name="breakoutLookbackPeriod" value={sp.breakoutLookbackPeriod ?? 50} onChange={handleParamChange} /></label></div>
                <div><label>ATR Spike Multiplier: <input type="number" step="0.1" name="atrSpikeMultiplier" value={sp.atrSpikeMultiplier ?? 1.5} onChange={handleParamChange} /></label></div>
            </fieldset>
        )}

        {params.strategySelectionMode === 'ADAPTIVE' && (
          <fieldset style={{margin: '10px 0', border: '1px dashed #888', padding: '10px', background: '#222'}}>
            <legend style={{color: '#ddd'}}>Adaptive Regime (ADX) Settings</legend>
            <div><label>ADX Period: <input type="number" name="adxPeriod" value={sp.adxPeriod ?? 14} onChange={handleParamChange} /></label></div>
            <div><label>ADX Range Threshold: <input type="number" name="adxRangeThreshold" value={sp.adxRangeThreshold ?? 20} onChange={handleParamChange} /></label></div>
            <div><label>ADX Trend Threshold: <input type="number" name="adxTrendThreshold" value={sp.adxTrendThreshold ?? 25} onChange={handleParamChange} /></label></div>
          </fieldset>
        )}
      </>
    );
  };

  // Basic styling for inputs (can be replaced by a UI library)
  const inputStyle = "bg-gray-700 text-white p-2 rounded border border-gray-600 focus:border-yellow-500 focus:outline-none";
  const labelStyle = "block text-sm font-medium text-gray-300 mb-1";
  const fieldsetStyle = {margin: '15px 0', padding: '15px', border: '1px solid #4A5568', borderRadius: '8px', background: '#2D3748'};
  const legendStyle = {color: '#F7B538', fontWeight: 'bold', padding: '0 5px'};

  return (
    <div style={{ padding: '20px', color: '#E2E8F0', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem', textAlign: 'center' }}>Strategy Backtester</h1>

      {error && <p style={{ color: '#FC8181', background: '#4A5568', padding: '10px', borderRadius: '5px' }}>Error: {error}</p>}

      <div style={{ background: '#2D3748', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'semibold', marginBottom: '1rem', borderBottom: '1px solid #4A5568', paddingBottom: '0.5rem' }}>Configure Backtest</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div><label className={labelStyle}>Symbol: </label><input name="symbol" value={params.symbol} onChange={handleParamChange} className={inputStyle} /></div>
          <div>
            <label className={labelStyle}>Timeframe: </label>
            <select name="timeframe" value={params.timeframe} onChange={handleParamChange} className={inputStyle + " w-full"}>
              <option value="15min">15 Minutes</option>
              <option value="1hour">1 Hour</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          <div><label className={labelStyle}>Start Date: </label><input type="date" name="startDate" value={params.startDate} onChange={handleParamChange} className={inputStyle + " w-full"} /></div>
          <div><label className={labelStyle}>End Date: </label><input type="date" name="endDate" value={params.endDate} onChange={handleParamChange} className={inputStyle + " w-full"} /></div>
        </div>

        <div className="mb-4">
          <label className={labelStyle}>Strategy Mode: </label>
          <select name="strategySelectionMode" value={params.strategySelectionMode} onChange={handleParamChange} className={inputStyle + " w-full"}>
            <option value="ADAPTIVE">Adaptive (Regime Switching)</option>
            <option value="SMA_ONLY">SMA Crossover Only</option>
            <option value="MEAN_REVERSION_ONLY">Mean Reversion Only</option>
            <option value="BREAKOUT_ONLY">Breakout Only</option>
          </select>
        </div>

        <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>General Risk Settings</legend>
            <div>
                <label className={labelStyle}>Risk Level (for Base Lot Size): </label>
                <select name="riskLevel" value={params.riskSettings.riskLevel} onChange={handleParamChange} className={inputStyle + " w-full"}>
                    <option value="conservative">Conservative</option>
                    <option value="medium">Medium</option>
                    <option value="risky">Risky</option>
                </select>
            </div>
            {/* <div><label className={labelStyle}>Max Lot Size (Override): <input type="number" step="0.01" name="maxLotSize" value={params.riskSettings.maxLotSize ?? ''} onChange={handleParamChange} className={inputStyle} /></label></div> */}
            <div className="mt-2">
                <label className={labelStyle}>Commission Per Lot (e.g., 0.7 for $0.70): </label>
                <input type="number" step="0.01" name="commissionPerLot" value={params.commissionPerLot ?? 0} onChange={handleParamChange} className={inputStyle + " w-full"} />
            </div>
            <div className="mt-2">
                <label className={labelStyle}>Slippage Points (e.g., 0.2 for XAUUSD): </label>
                <input type="number" step="0.01" name="slippagePoints" value={params.slippagePoints ?? 0} onChange={handleParamChange} className={inputStyle + " w-full"} />
            </div>
        </fieldset>

        {renderStrategyParamsInputs()}

        <div className="mt-6 flex gap-4">
            <button onClick={handleFetchHistoricalData} disabled={loading} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition-colors disabled:opacity-50">
                {loading ? 'Fetching Data...' : 'Fetch Historical Data'}
            </button>
            <button onClick={handleRunBacktest} disabled={loading} className="bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-2 px-4 rounded transition-colors disabled:opacity-50">
            {loading ? 'Running...' : 'Run Backtest'}
            </button>
        </div>
      </div>

      {currentReport && (
        <div style={{ marginTop: '2rem', background: '#2D3748', padding: '20px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'semibold', marginBottom: '1rem', borderBottom: '1px solid #4A5568', paddingBottom: '0.5rem' }}>Backtest Report: <span className="text-yellow-400">{currentReport.id.substring(0,8)}...</span></h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm">
            <p><strong>Period:</strong> {new Date(currentReport.start_date).toLocaleDateString()} - {new Date(currentReport.end_date).toLocaleDateString()}</p>
            <p><strong>Symbol:</strong> {currentReport.symbol} ({currentReport.timeframe})</p>
            <p><strong>Strategy Mode:</strong> {currentReport.strategy_selection_mode || params.strategySelectionMode}</p>
            <p><strong>Total Trades:</strong> {currentReport.total_trades}</p>
            <p className={currentReport.total_profit_loss >= 0 ? "text-green-400" : "text-red-400"}><strong>Total P/L:</strong> ${currentReport.total_profit_loss?.toFixed(2)}</p>
            <p><strong>Win Rate:</strong> {currentReport.win_rate?.toFixed(2)}%</p>
            <p><strong>Wins:</strong> {currentReport.winning_trades} / <strong>Losses:</strong> {currentReport.losing_trades}</p>
          </div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 'semibold', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Simulated Trades:</h3>
          <div style={{maxHeight: '400px', overflowY: 'auto', border: '1px solid #4A5568', borderRadius: '4px'}}>
            <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem'}}>
                <thead style={{backgroundColor: '#4A5568'}}>
                    <tr>
                        {['Entry Time', 'Type', 'Entry Price', 'Exit Time', 'Exit Price', 'P/L', 'Reason'].map(header =>
                            <th key={header} style={{padding: '8px', border: '1px solid #2D3748', textAlign: 'left'}}>{header}</th>)}
                    </tr>
                </thead>
                <tbody>
                {currentReport.trades?.map((trade, index: number) => (
                    <tr key={index} className={index % 2 === 0 ? "bg-gray-700/50" : "bg-gray-800/50"}>
                        <td style={{padding: '8px', border: '1px solid #4A5568'}}>{new Date(trade.entryTime).toLocaleString()}</td>
                        <td style={{padding: '8px', border: '1px solid #4A5568'}} className={trade.tradeType === 'BUY' ? 'text-green-400' : 'text-red-400'}>{trade.tradeType}</td>
                        <td style={{padding: '8px', border: '1px solid #4A5568'}}>{trade.entryPrice?.toFixed(4)}</td>
                        <td style={{padding: '8px', border: '1px solid #4A5568'}}>{trade.exitTime ? new Date(trade.exitTime).toLocaleString() : 'N/A'}</td>
                        <td style={{padding: '8px', border: '1px solid #4A5568'}}>{trade.exitPrice?.toFixed(4) || 'N/A'}</td>
                        <td style={{padding: '8px', border: '1px solid #4A5568', color: (trade.profitOrLoss ?? 0) > 0 ? '#68D391' : ((trade.profitOrLoss ?? 0) < 0 ? '#FC8181' : '#A0AEC0')}}>{trade.profitOrLoss?.toFixed(2)}</td>
                        <td style={{padding: '8px', border: '1px solid #4A5568'}}>{trade.closeReason}</td>
                    </tr>
                ))}
                </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: '3rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'semibold', marginBottom: '1rem', borderBottom: '1px solid #4A5568', paddingBottom: '0.5rem' }}>Past Backtest Reports</h2>
        {pastReports.length === 0 && <p>No past reports found.</p>}
        <ul style={{listStyle: 'none', padding: 0}}>
          {pastReports.map(report => (
            <li
              key={report.id}
              style={{ background: '#2D3748', border: '1px solid #4A5568', padding: '15px', marginBottom: '10px', borderRadius: '8px', cursor: 'pointer', transition: 'background-color 0.2s ease'}}
              onClick={() => handleViewReport(report.id)}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#4A5568'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2D3748'}
            >
              ID: <span className="text-yellow-400">{report.id.substring(0,8)}...</span> ({new Date(report.created_at).toLocaleDateString()}) <br/>
              {report.symbol} ({report.timeframe}) | Strategy: {report.strategy_selection_mode || "N/A"} <br />
              P/L: <span className={ (report.total_profit_loss ?? 0) >= 0 ? "text-green-400" : "text-red-400"}>${report.total_profit_loss?.toFixed(2)}</span> |
              Win Rate: {report.win_rate?.toFixed(2)}% ({report.winning_trades}/{report.total_trades})
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default BacktestingPage;
