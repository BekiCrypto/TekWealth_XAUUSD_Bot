import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Helper function to get environment variables
function getEnv(variableName: string): string {
  const value = Deno.env.get(variableName)
  if (!value) {
    throw new Error(`Environment variable ${variableName} is not set.`)
  }
  return value
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Global variable to cache the latest price to minimize API calls
let latestGoldPrice: { price: number; timestamp: number } | null = null;
const PRICE_CACHE_DURATION_MS = 5 * 60 * 1000; // Cache price for 5 minutes

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      getEnv('SUPABASE_URL'),
      getEnv('SUPABASE_SERVICE_ROLE_KEY')
    )
    const alphaVantageApiKey = getEnv('ALPHA_VANTAGE_API_KEY')

    const body = await req.json()
    const action = body.action; // Ensure action is correctly extracted
    const data = body.data;     // Ensure data is correctly extracted

    switch (action) {
      case 'execute_trade':
        return await executeTrade(supabaseClient, data, alphaVantageApiKey)
      
      case 'close_trade':
        return await closeTrade(supabaseClient, data, alphaVantageApiKey)
      
      case 'update_prices':
        return await updatePrices(supabaseClient, data)
      
      case 'run_bot_logic':
        return await runBotLogic(supabaseClient, data, alphaVantageApiKey)

      case 'get_current_price_action':
         const price = await getCurrentGoldPrice(alphaVantageApiKey);
         return new Response(JSON.stringify({ price }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         });

      case 'fetch_historical_data_action': // New action
        return await fetchAndStoreHistoricalData(supabaseClient, data, alphaVantageApiKey);

      case 'run_backtest_action': // New action for backtesting
        return await runBacktestAction(supabaseClient, data, alphaVantageApiKey);

      case 'get_backtest_report_action':
        return await getBacktestReportAction(supabaseClient, data);

      case 'list_backtests_action':
        return await listBacktestsAction(supabaseClient, data);

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  } catch (error) {
    console.error('Trading engine error:', error.message, error.stack)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

async function fetchCurrentGoldPriceFromAPI(apiKey: string): Promise<number> {
  // Using Alpha Vantage CURRENCY_EXCHANGE_RATE endpoint for XAU to USD
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=${apiKey}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage API error: ${response.statusText}`);
    }
    const data = await response.json();
    const rate = data["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];
    if (!rate) {
      console.warn("Alpha Vantage API did not return expected price data:", data);
      // Fallback or error if no rate found
      if (latestGoldPrice) return latestGoldPrice.price; // return cached if available
      throw new Error("Could not fetch current gold price from Alpha Vantage.");
    }
    const price = parseFloat(rate);
    latestGoldPrice = { price, timestamp: Date.now() };
    console.log("Fetched new gold price from API:", price);
    return price;
  } catch (error) {
    console.error("Error fetching gold price from Alpha Vantage:", error);
    // If API fails, try to return the last cached price if not too old
    if (latestGoldPrice && (Date.now() - latestGoldPrice.timestamp < PRICE_CACHE_DURATION_MS * 2)) {
      console.warn("Returning cached gold price due to API error.");
      return latestGoldPrice.price;
    }
    throw error; // Re-throw if no usable cache
  }
}

// --- Email Sending Helper ---
async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const sendGridApiKey = Deno.env.get('SENDGRID_API_KEY');
  const fromEmail = Deno.env.get('FROM_EMAIL');

  if (!sendGridApiKey) {
    console.error('SENDGRID_API_KEY environment variable is not set. Cannot send email.');
    return { success: false, error: 'SendGrid API Key not configured.' };
  }
  if (!fromEmail) {
    console.error('FROM_EMAIL environment variable is not set. Cannot send email.');
    return { success: false, error: 'Sender email (FROM_EMAIL) not configured.' };
  }

  const emailData = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: 'TekWealth Trading Bot' }, // Optional: Add a sender name
    subject: subject,
    content: [{ type: 'text/html', value: htmlContent }],
  };

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendGridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    if (response.status === 202) { // SendGrid returns 202 Accepted on success
      console.log(`Email sent successfully to ${to}. Subject: ${subject}`);
      // SendGrid does not return a message ID in the V3 mail/send response body directly for 202.
      // It's available via X-Message-Id header, which we can try to get if needed, or via event webhooks.
      // For simplicity, we'll just confirm success based on status.
      const messageId = response.headers.get('x-message-id');
      return { success: true, messageId: messageId || undefined };
    } else {
      const errorBody = await response.json();
      console.error(`Failed to send email. Status: ${response.status}`, errorBody);
      return { success: false, error: `SendGrid API Error: ${response.status} - ${JSON.stringify(errorBody)}` };
    }
  } catch (error) {
    console.error('Error sending email via SendGrid:', error);
    return { success: false, error: error.message };
  }
}
// --- End Email Sending Helper ---

interface SimulatedTrade {
  entryTime: string;
  entryPrice: number;
  exitTime?: string;
  exitPrice?: number;
  tradeType: 'BUY' | 'SELL';
  lotSize: number;
  stopLossPrice: number;
  takeProfitPrice?: number | null;
  status: 'open' | 'closed';
  profitOrLoss?: number;
  closeReason?: string; // e.g., 'SL', 'Signal'
}

async function runBacktestAction(supabase: any, data: any, apiKey: string) {
  const {
    userId, // For potential future use (e.g. saving reports per user)
    symbol = 'XAUUSD',
    timeframe = '15min', // Should match the strategy's timeframe
    startDate, // ISO Date string
    endDate,   // ISO Date string
    strategySettings = { shortPeriod: 20, longPeriod: 50 }, // Default SMA settings
    // Default risk settings, similar to processBotSession
    riskSettings = { riskLevel: 'conservative', maxLotSize: 0.01, stopLossPips: 200 }
  } = data;

  if (!startDate || !endDate) {
    return new Response(JSON.stringify({ error: "startDate and endDate are required." }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  if (!userId) {
     // In a real app, you might get userId from JWT or session
     // For now, if not provided, we can use a placeholder or make it optional for report storage
     console.warn("userId not provided for backtest report. Report will not be user-associated if saved.");
  }


  try {
    // 1. Fetch Historical Data from DB
    const { data: historicalOhlc, error: dbError } = await supabase
      .from('price_data')
      .select('timestamp, open_price, high_price, low_price, close_price, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('timestamp', startDate)
      .lte('timestamp', endDate)
      .order('timestamp', { ascending: true });

    if (dbError) throw dbError;
    if (!historicalOhlc || historicalOhlc.length < strategySettings.longPeriod) {
      return new Response(JSON.stringify({ error: "Not enough historical data for the selected period or to meet strategy MA length." }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const tradesForDb: Omit<SimulatedTrade, 'status' | 'profitOrLoss' | 'closeReason'>[] = [];
    let openTrade: SimulatedTrade | null = null;

    const pipsToPricePoints = (pips: number) => pips / 10;

    for (let i = strategySettings.longPeriod; i < historicalOhlc.length; i++) {
      const currentCandle = historicalOhlc[i];
      const currentTime = currentCandle.timestamp;
      const currentLowPrice = currentCandle.low_price;
      const currentHighPrice = currentCandle.high_price;

      if (openTrade) {
        let slHit = false;
        let slPrice = 0;
        if (openTrade.tradeType === 'BUY' && currentLowPrice <= openTrade.stopLossPrice) {
          slHit = true;
          slPrice = openTrade.stopLossPrice;
        } else if (openTrade.tradeType === 'SELL' && currentHighPrice >= openTrade.stopLossPrice) {
          slHit = true;
          slPrice = openTrade.stopLossPrice;
        }

        if (slHit) {
          const priceDiff = openTrade.tradeType === 'BUY' ? slPrice - openTrade.entryPrice : openTrade.entryPrice - slPrice;
          tradesForDb.push({
            ...openTrade,
            exitTime: currentTime,
            exitPrice: slPrice,
            profitOrLoss: priceDiff * openTrade.lotSize * 100,
            closeReason: 'SL',
          });
          openTrade = null;
        }
      }

      const analysisResult = await analyzeMarketConditions(
        apiKey,
        strategySettings.shortPeriod,
        strategySettings.longPeriod,
        historicalOhlc,
        i
      );

      if (openTrade) {
        if ((openTrade.tradeType === 'BUY' && analysisResult.shouldTrade && analysisResult.tradeType === 'SELL') ||
            (openTrade.tradeType === 'SELL' && analysisResult.shouldTrade && analysisResult.tradeType === 'BUY')) {
          const exitPrice = analysisResult.priceAtDecision as number;
          const priceDiff = openTrade.tradeType === 'BUY' ? exitPrice - openTrade.entryPrice : openTrade.entryPrice - exitPrice;
          tradesForDb.push({
            ...openTrade,
            exitTime: currentTime,
            exitPrice: exitPrice,
            profitOrLoss: priceDiff * openTrade.lotSize * 100,
            closeReason: 'Signal',
          });
          openTrade = null;
        }
      } else {
        if (analysisResult.shouldTrade && analysisResult.tradeType && analysisResult.priceAtDecision) {
          const entryPrice = analysisResult.priceAtDecision;
          const stopLossDistance = pipsToPricePoints(riskSettings.stopLossPips);
          openTrade = {
            entryTime: currentTime,
            entryPrice: entryPrice,
            tradeType: analysisResult.tradeType,
            lotSize: riskSettings.maxLotSize,
            stopLossPrice: analysisResult.tradeType === 'BUY' ? entryPrice - stopLossDistance : entryPrice + stopLossDistance,
            status: 'open', // status is internal to loop, not stored directly this way in tradesForDb
          };
        }
      }
    }

    if (openTrade) {
      const lastCandle = historicalOhlc[historicalOhlc.length - 1];
      const exitPrice = lastCandle.close_price;
      const priceDiff = openTrade.tradeType === 'BUY' ? exitPrice - openTrade.entryPrice : openTrade.entryPrice - exitPrice;
      tradesForDb.push({
        ...openTrade,
        exitTime: lastCandle.timestamp,
        exitPrice: exitPrice,
        profitOrLoss: priceDiff * openTrade.lotSize * 100,
        closeReason: 'EndOfTest',
      });
    }

    let totalProfitLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    tradesForDb.forEach(trade => {
      if (trade.profitOrLoss) {
        totalProfitLoss += trade.profitOrLoss;
        if (trade.profitOrLoss > 0) winningTrades++;
        else if (trade.profitOrLoss < 0) losingTrades++;
      }
    });
    const totalTrades = tradesForDb.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const reportSummary = {
      user_id: userId || null, // Store null if no userId
      symbol,
      timeframe,
      start_date: startDate,
      end_date: endDate,
      strategy_settings: strategySettings,
      risk_settings: riskSettings,
      total_trades: totalTrades,
      total_profit_loss: parseFloat(totalProfitLoss.toFixed(2)),
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      win_rate: parseFloat(winRate.toFixed(2)),
    };

    const { data: report, error: reportError } = await supabase
      .from('backtest_reports')
      .insert(reportSummary)
      .select()
      .single();

    if (reportError) throw reportError;
    if (!report) throw new Error("Failed to save backtest report summary.");

    const reportId = report.id;
    const simulatedTradesToStore = tradesForDb.map(t => ({
      backtest_report_id: reportId,
      entry_time: t.entryTime,
      entry_price: t.entryPrice,
      exit_time: t.exitTime,
      exit_price: t.exitPrice,
      trade_type: t.tradeType,
      lot_size: t.lotSize,
      stop_loss_price: t.stopLossPrice,
      profit_or_loss: t.profitOrLoss,
      close_reason: t.closeReason,
    }));

    if (simulatedTradesToStore.length > 0) {
        const { error: tradesError } = await supabase.from('simulated_trades').insert(simulatedTradesToStore);
        if (tradesError) {
            // Attempt to delete the summary report if saving trades fails to maintain consistency
            await supabase.from('backtest_reports').delete().eq('id', reportId);
            throw tradesError;
        }
    }

    // Return the full report including the ID and saved trades
    const finalResults = {
        ...reportSummary, // This doesn't include the 'id' and 'created_at' from the DB response
        id: reportId, // Add the actual report ID
        created_at: report.created_at, // Add created_at from DB
        trades: tradesForDb // Return the trades array as computed (before DB mapping)
    };

    // Send email notification for backtest completion
    const recipientEmail = Deno.env.get('NOTIFICATION_EMAIL_RECIPIENT');
    if (recipientEmail) {
      const emailSubject = `[Trading Bot] Backtest Completed: Report ID ${reportId}`;
      const emailHtmlContent = `
        <h1>Backtest Completed</h1>
        <p>A backtest has successfully completed. Details:</p>
        <ul>
          <li>Report ID: ${reportId}</li>
          <li>Symbol: ${reportSummary.symbol}</li>
          <li>Timeframe: ${reportSummary.timeframe}</li>
          <li>Period: ${new Date(reportSummary.start_date).toLocaleDateString()} - ${new Date(reportSummary.end_date).toLocaleDateString()}</li>
          <li>Total Trades: ${reportSummary.total_trades}</li>
          <li>Total P/L: $${reportSummary.total_profit_loss}</li>
          <li>Win Rate: ${reportSummary.win_rate}%</li>
        </ul>
        <p>Full details and trade list are available in the application.</p>
      `;
      sendEmail(recipientEmail, emailSubject, emailHtmlContent)
        .then(emailRes => {
          if (emailRes.success) console.log(`Backtest completion email sent to ${recipientEmail}, Message ID: ${emailRes.messageId}`);
          else console.error(`Failed to send backtest completion email: ${emailRes.error}`);
        })
        .catch(err => console.error(`Exception while sending backtest completion email: ${err.message}`));
    } else {
      console.warn("NOTIFICATION_EMAIL_RECIPIENT not set. Skipping backtest completion email.");
    }

    return new Response(JSON.stringify(finalResults), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in runBacktestAction:", error.message, error.stack);
    return new Response(JSON.stringify({ error: "Backtesting failed: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function getBacktestReportAction(supabase: any, data: any) {
  const { reportId } = data;
  if (!reportId) {
    return new Response(JSON.stringify({ error: "reportId is required." }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { data: report, error: reportError } = await supabase
      .from('backtest_reports')
      .select('*')
      .eq('id', reportId)
      .single();

    if (reportError) throw reportError;
    if (!report) {
      return new Response(JSON.stringify({ error: "Backtest report not found." }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: trades, error: tradesError } = await supabase
      .from('simulated_trades')
      .select('*')
      .eq('backtest_report_id', reportId)
      .order('entry_time', { ascending: true });

    if (tradesError) throw tradesError;

    return new Response(JSON.stringify({ ...report, trades: trades || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in getBacktestReportAction:", error.message);
    return new Response(JSON.stringify({ error: "Failed to fetch backtest report: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function listBacktestsAction(supabase: any, data: any) {
  const { userId } = data; // Optional: if not provided, could list all (admin) or require auth context

  try {
    let query = supabase.from('backtest_reports').select('*').order('created_at', { ascending: false });
    if (userId) {
      query = query.eq('user_id', userId);
    }
    // Add pagination if needed: .range(from, to)

    const { data: reports, error } = await query;
    if (error) throw error;

    return new Response(JSON.stringify(reports || []), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in listBacktestsAction:", error.message);
    return new Response(JSON.stringify({ error: "Failed to list backtest reports: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}


async function getCurrentGoldPrice(apiKey: string): Promise<number> {
  if (latestGoldPrice && (Date.now() - latestGoldPrice.timestamp < PRICE_CACHE_DURATION_MS)) {
    console.log("Using cached gold price:", latestGoldPrice.price);
    return latestGoldPrice.price;
  }
  return await fetchCurrentGoldPriceFromAPI(apiKey);
}


async function executeTrade(supabase: any, tradeData: any, apiKey: string) {
  const currentPrice = await getCurrentGoldPrice(apiKey)
  
  const { data: trade, error } = await supabase
    .from('trades')
    .insert({
      user_id: tradeData.userId,
      trading_account_id: tradeData.accountId,
      ticket_id: generateTicketId(),
      symbol: 'XAUUSD',
      trade_type: tradeData.type, // Should be 'BUY' or 'SELL'
      lot_size: tradeData.lotSize,
      open_price: currentPrice,
      stop_loss: tradeData.stopLoss, // Ensure this is calculated correctly by caller
      take_profit: tradeData.takeProfit,
      status: 'open'
    })
    .select()
    .single()

  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: tradeData.userId,
    type: 'trade_alert',
    title: 'Trade Executed (Simulated)',
    message: `${tradeData.type} ${tradeData.lotSize} lots of XAUUSD at $${currentPrice}`
  })

  return new Response(JSON.stringify({ trade }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function closeTrade(supabase: any, closeData: any, apiKey: string) {
  const currentPrice = await getCurrentGoldPrice(apiKey)
  
  const { data: trade, error: fetchError } = await supabase
    .from('trades')
    .select('*')
    .eq('id', closeData.tradeId)
    .single()

  if (fetchError) throw fetchError
  if (!trade) throw new Error(`Trade with ID ${closeData.tradeId} not found.`);

  const priceDiff = trade.trade_type === 'BUY' 
    ? currentPrice - trade.open_price
    : trade.open_price - currentPrice
  
  const profitLoss = priceDiff * trade.lot_size * 100 // Simplified P&L

  const { data: updatedTrade, error } = await supabase
    .from('trades')
    .update({
      close_price: currentPrice,
      profit_loss: profitLoss,
      status: 'closed',
      close_time: new Date().toISOString()
    })
    .eq('id', closeData.tradeId)
    .select()
    .single()

  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: trade.user_id,
    type: 'trade_alert',
    title: 'Trade Closed (Simulated)',
    message: `Trade ${trade.id} closed. P/L: $${profitLoss.toFixed(2)}`
  })

  return new Response(JSON.stringify({ trade: updatedTrade }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// This function might be re-purposed to periodically fetch and store
// historical data from Alpha Vantage if needed for other analytics,
// or if the bot needs more data than it fetches per run.
async function updatePrices(supabase: any, priceData: any) {
  // For now, this is less critical as the bot will fetch its own data.
  // Could be used to backfill `price_data` table from Alpha Vantage.
  console.log("updatePrices called, currently a placeholder action.", priceData)
  // Example: Storing to price_data if you adapt it
  // const { data, error } = await supabase
  //   .from('price_data')
  //   .insert({ /* ... priceData mapping ... */ })
  // if (error) throw error
  return new Response(JSON.stringify({ success: true, message: "updatePrices placeholder" }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function runBotLogic(supabase: any, _botData: any, apiKey: string) {
  const { data: sessions, error } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('status', 'active')

  if (error) throw error
  if (!sessions || sessions.length === 0) return new Response(JSON.stringify({ processed: 0, message: "No active sessions" }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })


  let processedCount = 0;
  for (const session of sessions) {
    try {
      await processBotSession(supabase, session, apiKey)
      processedCount++;
    } catch (sessionError) {
      console.error(`Error processing bot session ${session.id}:`, sessionError.message, sessionError.stack)
      // Optionally, update session status to 'error' or log error to DB
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_error',
        title: 'Bot Session Error',
        message: `Error in bot session ${session.id}: ${sessionError.message}`
      });
    }
  }

  return new Response(JSON.stringify({ processed: processedCount }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function fetchHistoricalGoldPrices(apiKey: string, interval: string = '15min', outputsize: string = 'compact'): Promise<any[]> {
  // Using Alpha Vantage TIME_SERIES_INTRADAY for XAU (often needs a proxy like XAUUSD or a specific broker symbol if AV supports it directly)
  // For XAU/USD, Alpha Vantage provides FX_INTRADAY
  const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=XAU&to_symbol=USD&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&datatype=json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage historical data API error: ${response.statusText}`);
    }
    const data = await response.json();
    const timeSeriesKey = `Time Series FX (${interval})`;
    const timeSeries = data[timeSeriesKey];

    if (!timeSeries) {
      console.warn("Alpha Vantage API did not return expected historical data:", data);
      throw new Error("Could not fetch historical gold prices from Alpha Vantage. Check symbol or API response format.");
    }
    // Convert to array of { timestamp, open, high, low, close, volume }
    // Alpha Vantage returns data with "1. open", "2. high", etc.
    return Object.entries(timeSeries).map(([timestamp, values]: [string, any]) => ({
      timestamp,
      open: parseFloat(values["1. open"]),
      high: parseFloat(values["2. high"]),
      low: parseFloat(values["3. low"]),
      close: parseFloat(values["4. close"]),
    })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Ensure ascending order
  } catch (error) {
    console.error("Error fetching historical gold prices:", error);
    throw error;
  }
}

function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const sum = prices.slice(-period).reduce((acc, val) => acc + val, 0);
  return sum / period;
}

interface MarketAnalysisResult {
  shouldTrade: boolean;
  tradeType?: 'BUY' | 'SELL';
  priceAtDecision?: number; // The price at which the decision is made (e.g., open of current candle in backtest)
}

// --- Trade Execution Abstraction ---
interface ExecuteOrderParams {
  userId: string;
  tradingAccountId: string;
  symbol: string;
  tradeType: 'BUY' | 'SELL';
  lotSize: number;
  openPrice: number;
  stopLossPrice: number; // Changed from optional to required for the provider
  takeProfitPrice?: number; // Remains optional
  botSessionId?: string;
}

interface ExecuteOrderResult {
  success: boolean;
  tradeId?: string; // Actual ID from trades table or broker
  ticketId?: string;
  error?: string;
}

// We can expand this interface later with closeOrder, modifyOrder, etc.
interface ITradeExecutionProvider {
  executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult>;
}

class SimulatedTradeProvider implements ITradeExecutionProvider {
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
    try {
      const ticketId = generateTicketId(); // Ensure generateTicketId() is accessible or passed
      const { data: dbTrade, error } = await this.supabase
        .from('trades')
        .insert({
          user_id: params.userId,
          trading_account_id: params.tradingAccountId,
          ticket_id: ticketId,
          symbol: params.symbol,
          trade_type: params.tradeType,
          lot_size: params.lotSize,
          open_price: params.openPrice,
          stop_loss: params.stopLossPrice, // Ensure field name matches DB
          take_profit: params.takeProfitPrice,
          status: 'open',
          bot_session_id: params.botSessionId,
        })
        .select('id')
        .single();

      if (error) {
        console.error('SimulatedTradeProvider: Error inserting trade:', error);
        return { success: false, error: error.message, ticketId };
      }
      if (!dbTrade || !dbTrade.id) {
        return { success: false, error: "SimulatedTradeProvider: Failed to insert trade or retrieve its ID.", ticketId };
      }

      return { success: true, tradeId: dbTrade.id, ticketId };

    } catch (e) {
      console.error('SimulatedTradeProvider: Exception in executeOrder:', e);
      return { success: false, error: e.message };
    }
  }
}
// --- End Trade Execution Abstraction ---


// Refactored for backtesting and live trading
async function analyzeMarketConditions(
  apiKey: string,
  shortPeriod: number = 20,
  longPeriod: number = 50,
  // Optional parameters for backtesting:
  ohlcDataForAnalysis?: any[], // Pre-fetched OHLC data
  currentIndexForDecision?: number // Index of the current candle in ohlcDataForAnalysis for decision making
): Promise<MarketAnalysisResult> {
  try {
    let decisionPrice: number;
    let relevantHistoricalData: any[];

    if (ohlcDataForAnalysis && currentIndexForDecision !== undefined && currentIndexForDecision >= 0) {
      // Backtesting mode: Use provided historical data
      if (currentIndexForDecision === 0) { // Not enough data for previous candle's MAs
          return { shouldTrade: false };
      }
      // Data for MA calculation is up to one candle *before* the current decision candle
      relevantHistoricalData = ohlcDataForAnalysis.slice(0, currentIndexForDecision);
      // Decision price is typically the open of the current candle, or close of previous for signal generation
      decisionPrice = ohlcDataForAnalysis[currentIndexForDecision].open_price;
                                       // Or .close_price of [currentIndex-1] depending on strategy rules.
                                       // For this crossover, decision is based on previous close, action on current open.
    } else {
      // Live trading mode: Fetch live historical data and current price
      relevantHistoricalData = await fetchHistoricalGoldPrices(apiKey, '15min', 'compact');
      decisionPrice = await getCurrentGoldPrice(apiKey); // This is the most recent tick price
    }

    if (relevantHistoricalData.length < longPeriod) {
      // console.warn(`Not enough historical data for MA calculation. Have ${relevantHistoricalData.length}, need ${longPeriod}`);
      return { shouldTrade: false, priceAtDecision: decisionPrice };
    }

    const closePrices = relevantHistoricalData.map(p => p.close_price || p.close); // Adapt to property name

    // SMAs for the most recent completed candle available in relevantHistoricalData
    const smaShort = calculateSMA(closePrices, shortPeriod);
    const smaLong = calculateSMA(closePrices, longPeriod);

    // SMAs for the candle *before* the most recent completed one
    // This means removing the last element from closePrices before calculating previous MAs
    const smaShortPrev = calculateSMA(closePrices.slice(0, -1), shortPeriod);
    const smaLongPrev = calculateSMA(closePrices.slice(0, -1), longPeriod);

    if (smaShort === null || smaLong === null || smaShortPrev === null || smaLongPrev === null) {
      // console.log("Could not calculate SMAs (null).", { smaShort, smaLong, smaShortPrev, smaLongPrev });
      return { shouldTrade: false, priceAtDecision: decisionPrice };
    }

    // In live mode, log current state
    if (!(ohlcDataForAnalysis && currentIndexForDecision !== undefined)) {
        console.log(`SMA Analysis (Live): Decision Price: ${decisionPrice}, SMA(${shortPeriod}): ${smaShort.toFixed(2)}, SMA(${longPeriod}): ${smaLong.toFixed(2)}`);
        console.log(`SMA Analysis (Live): Prev SMA(${shortPeriod}): ${smaShortPrev.toFixed(2)}, Prev SMA(${longPeriod}): ${smaLongPrev.toFixed(2)}`);
    }


    // Bullish Crossover: Short MA (at previous candle) crossed above Long MA (at previous candle)
    if (smaShortPrev <= smaLongPrev && smaShort > smaLong) {
      if (!(ohlcDataForAnalysis && currentIndexForDecision !== undefined)) console.log("Bullish Crossover Detected (Live)");
      return { shouldTrade: true, tradeType: 'BUY', priceAtDecision: decisionPrice };
    }

    // Bearish Crossover: Short MA crossed below Long MA
    if (smaShortPrev >= smaLongPrev && smaShort < smaLong) {
      if (!(ohlcDataForAnalysis && currentIndexForDecision !== undefined)) console.log("Bearish Crossover Detected (Live)");
      return { shouldTrade: true, tradeType: 'SELL', priceAtDecision: decisionPrice };
    }

    // if (!(ohlcDataForAnalysis && currentIndexForDecision !== undefined)) console.log("No Crossover Detected (Live)");
    return { shouldTrade: false, priceAtDecision: decisionPrice };

  } catch (error) {
    console.error("Error during market analysis:", error.message, error.stack);
    return { shouldTrade: false }; // Default to no trade on error
  }
}


async function processBotSession(supabase: any, session: any, apiKey: string) {
  console.log(`Processing bot session ${session.id} for user ${session.user_id} (Live Mode)`);

  // Initialize the trade execution provider
  const tradeProvider: ITradeExecutionProvider = new SimulatedTradeProvider(supabase);

  const riskSettingsMap = {
    conservative: { maxLotSize: 0.01, stopLossPips: 200 },
    medium: { maxLotSize: 0.05, stopLossPips: 300 },
    risky: { maxLotSize: 0.10, stopLossPips: 500 }
  };

  const settings = riskSettingsMap[session.risk_level] || riskSettingsMap.conservative;

  const { data: openTrades, error: openTradesError } = await supabase
    .from('trades')
    .select('id')
    .eq('user_id', session.user_id)
    .eq('trading_account_id', session.trading_account_id)
    .eq('status', 'open')
    .eq('bot_session_id', session.id); // Ensure we only check trades for *this* bot session

  if (openTradesError) {
    console.error(`Error fetching open trades for session ${session.id}:`, openTradesError);
    // Depending on error severity, might decide to skip or throw
    return;
  }

  if (openTrades && openTrades.length > 0) {
    console.log(`Session ${session.id} for user ${session.user_id} already has ${openTrades.length} open trade(s). Skipping new trade.`);
    return;
  }

  // Call analyzeMarketConditions without backtesting parameters for live mode
  const analysisResult = await analyzeMarketConditions(apiKey, session.strategy_settings?.shortPeriod || 20, session.strategy_settings?.longPeriod || 50);
  
  if (analysisResult.shouldTrade && analysisResult.tradeType && analysisResult.priceAtDecision) {
    const tradeType = analysisResult.tradeType;
    const openPrice = analysisResult.priceAtDecision;
    const lotSize = settings.maxLotSize;

    const stopLossDistance = (settings.stopLossPips || 200) / 10; // Default SL pips if not set
    let stopLossPrice;
    if (tradeType === 'BUY') {
      stopLossPrice = openPrice - stopLossDistance;
    } else { // SELL
      stopLossPrice = openPrice + stopLossDistance;
    }
    
    console.log(`Executing ${tradeType} for session ${session.id}: Price=${openPrice}, SL=${stopLossPrice}, Lot=${lotSize}`);

    const executionParams: ExecuteOrderParams = {
      userId: session.user_id,
      tradingAccountId: session.trading_account_id,
      symbol: 'XAUUSD', // Assuming XAUUSD for now
      tradeType: tradeType,
      lotSize: lotSize,
      openPrice: openPrice,
      stopLossPrice: parseFloat(stopLossPrice.toFixed(4)), // Ensure correct precision
      // takeProfitPrice: undefined, // Add TP logic if desired
      botSessionId: session.id,
    };

    const executionResult = await tradeProvider.executeOrder(executionParams);

    if (executionResult.success && executionResult.tradeId) {
      console.log(`Trade executed for session ${session.id}, DB Trade ID: ${executionResult.tradeId}, Ticket: ${executionResult.ticketId}`);
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_trade_executed',
        title: 'Bot Trade Executed (Simulated)',
        message: `${tradeType} ${lotSize} XAUUSD @ ${openPrice} by bot (Session ${session.id})`
      });
      await supabase
        .from('bot_sessions')
        .update({ total_trades: (session.total_trades || 0) + 1, last_trade_time: new Date().toISOString() })
        .eq('id', session.id);

      // Send email notification
      const recipientEmail = Deno.env.get('NOTIFICATION_EMAIL_RECIPIENT');
      if (recipientEmail) {
        const emailSubject = `[Trading Bot] Trade Executed: ${tradeType} ${lotSize} ${executionParams.symbol}`;
        const emailHtmlContent = `
          <h1>Trade Executed</h1>
          <p>A trade was executed by the automated bot:</p>
          <ul>
            <li>Session ID: ${session.id}</li>
            <li>User ID: ${session.user_id}</li>
            <li>Symbol: ${executionParams.symbol}</li>
            <li>Type: ${tradeType}</li>
            <li>Lot Size: ${lotSize}</li>
            <li>Open Price: $${openPrice.toFixed(4)}</li>
            <li>Stop Loss: $${executionParams.stopLossPrice.toFixed(4)}</li>
            <li>Database Trade ID: ${executionResult.tradeId}</li>
            <li>Ticket ID: ${executionResult.ticketId}</li>
          </ul>
        `;
        sendEmail(recipientEmail, emailSubject, emailHtmlContent)
          .then(emailRes => {
            if (emailRes.success) console.log(`Trade execution email sent to ${recipientEmail}, Message ID: ${emailRes.messageId}`);
            else console.error(`Failed to send trade execution email: ${emailRes.error}`);
          })
          .catch(err => console.error(`Exception while sending trade execution email: ${err.message}`));
      } else {
        console.warn("NOTIFICATION_EMAIL_RECIPIENT not set. Skipping trade execution email.");
      }

    } else {
      console.error(`Error executing trade for session ${session.id}:`, executionResult.error);
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_trade_error',
        title: 'Bot Trade Failed (Simulated)',
        message: `Failed to execute ${tradeType} for bot session ${session.id}: ${executionResult.error}`
      });
    }
  } else {
    console.log(`No trade signal for session ${session.id} based on current market conditions.`);
  }
}

function generateTicketId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

async function fetchAndStoreHistoricalData(supabase: any, data: any, apiKey: string) {
  const {
    symbol = 'XAUUSD', // Assuming XAU/USD for Alpha Vantage FX
    fromCurrency = 'XAU',
    toCurrency = 'USD',
    interval = '15min', // e.g., '1min', '5min', '15min', '30min', '60min', 'daily', 'weekly', 'monthly'
    outputsize = 'compact', // 'compact' for last 100, 'full' for full history
  } = data;

  let avFunction = '';
  let timeSeriesKeyPattern = ''; // Used to extract data from AV response

  if (['1min', '5min', '15min', '30min', '60min'].includes(interval)) {
    avFunction = 'FX_INTRADAY';
    timeSeriesKeyPattern = `Time Series FX (${interval})`;
  } else if (interval === 'daily') {
    avFunction = 'FX_DAILY';
    timeSeriesKeyPattern = `Time Series FX (Daily)`;
  } else if (interval === 'weekly') {
    avFunction = 'FX_WEEKLY';
    timeSeriesKeyPattern = `Time Series FX (Weekly)`;
  } else if (interval === 'monthly') {
    avFunction = 'FX_MONTHLY';
    timeSeriesKeyPattern = `Time Series FX (Monthly)`;
  } else {
    throw new Error(`Unsupported interval: ${interval}`);
  }

  const url = `https://www.alphavantage.co/query?function=${avFunction}&from_symbol=${fromCurrency}&to_symbol=${toCurrency}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&datatype=json`;

  try {
    console.log(`Fetching historical data from Alpha Vantage: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage API error for historical data: ${response.status} ${response.statusText}`);
    }
    const avData = await response.json();

    if (avData['Error Message'] || avData['Information']) {
        const message = avData['Error Message'] || avData['Information'];
        // Information can be a rate limit message, e.g., "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute and 500 calls per day."
        console.warn(`Alpha Vantage API message: ${message}`);
        if (message.includes("API call frequency")) {
             throw new Error(`Alpha Vantage API rate limit likely hit: ${message}`);
        }
        // For other messages that are not clearly errors but indicate no data, treat as warning but continue if possible
        // This part might need refinement based on typical AV non-error messages for empty data
    }

    const timeSeries = avData[timeSeriesKeyPattern];

    if (!timeSeries) {
      console.warn("Alpha Vantage API did not return expected time series data for key:", timeSeriesKeyPattern, "Response:", avData);
      // It's possible AV returns an empty object if no data, or a specific message.
      // If it's an error or rate limit, the above checks should catch it.
      // If it's genuinely no data for a valid query, we can return success with 0 inserted.
      return new Response(JSON.stringify({ success: true, message: "No time series data returned from Alpha Vantage, or key mismatch.", inserted: 0, response: avData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const recordsToInsert = Object.entries(timeSeries).map(([ts, values]: [string, any]) => {
      const record: any = {
        symbol: symbol, // The user-defined symbol like XAUUSD
        timeframe: interval,
        timestamp: new Date(ts).toISOString(), // Ensure ISO format for DB
        open_price: parseFloat(values["1. open"]),
        high_price: parseFloat(values["2. high"]),
        low_price: parseFloat(values["3. low"]),
        close_price: parseFloat(values["4. close"]),
      };
      // Alpha Vantage intraday for FX does not typically include volume. Daily does.
      if (values["5. volume"]) {
        record.volume = parseFloat(values["5. volume"]);
      } else if (avFunction === 'FX_DAILY' && values["5. volume"]) { // specifically for daily where volume is expected
        record.volume = parseFloat(values["5. volume"]);
      } else {
        record.volume = 0; // Default to 0 if not present
      }
      return record;
    });

    if (recordsToInsert.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No records to insert.", inserted: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Attempting to insert/upsert ${recordsToInsert.length} records into price_data.`);

    // Upsert based on a unique constraint on (symbol, timeframe, timestamp)
    // If the constraint doesn't exist, it will just insert.
    const { error: upsertError, count } = await supabase
      .from('price_data')
      .upsert(recordsToInsert, {
        onConflict: 'symbol,timeframe,timestamp', // Specify conflict columns
        // ignoreDuplicates: false, // default is false, ensures update on conflict
      });

    if (upsertError) {
      console.error('Error upserting price data:', upsertError);
      throw upsertError;
    }

    console.log(`Successfully upserted ${count ?? recordsToInsert.length} records.`);
    return new Response(JSON.stringify({ success: true, inserted: count ?? recordsToInsert.length, message: "Historical data fetched and stored." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in fetchAndStoreHistoricalData:", error.message, error.stack);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}