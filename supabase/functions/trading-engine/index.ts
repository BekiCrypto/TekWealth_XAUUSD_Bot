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

    const { action, data } = await req.json()

    switch (action) {
      case 'execute_trade':
        return await executeTrade(supabaseClient, data, alphaVantageApiKey)
      
      case 'close_trade':
        return await closeTrade(supabaseClient, data, alphaVantageApiKey)
      
      case 'update_prices': // This might be deprecated or re-purposed
        return await updatePrices(supabaseClient, data)
      
      case 'run_bot_logic':
        return await runBotLogic(supabaseClient, data, alphaVantageApiKey)
      
      case 'get_current_price_action': // New action for frontend to get price
         const price = await getCurrentGoldPrice(alphaVantageApiKey);
         return new Response(JSON.stringify({ price }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         });

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
  confidence?: number; // Optional: for future use
  priceAtAnalysis?: number;
}

async function analyzeMarketConditions(apiKey: string, shortPeriod: number = 20, longPeriod: number = 50): Promise<MarketAnalysisResult> {
  try {
    // Fetch historical data - e.g., 15min interval, need enough data for longest MA.
    // Alpha Vantage 'compact' returns last 100 data points. 'full' returns more.
    // For a 50-period MA, we need at least 50 data points.
    const historicalData = await fetchHistoricalGoldPrices(apiKey, '15min', 'compact');

    if (historicalData.length < longPeriod) {
      console.warn(`Not enough historical data for MA calculation. Have ${historicalData.length}, need ${longPeriod}`);
      return { shouldTrade: false };
    }

    const closePrices = historicalData.map(p => p.close);
    const currentPrice = await getCurrentGoldPrice(apiKey); // Get the most recent price for decision making

    const smaShort = calculateSMA(closePrices, shortPeriod);
    const smaLong = calculateSMA(closePrices, longPeriod);

    // For crossover, we also need previous MAs
    const smaShortPrev = calculateSMA(closePrices.slice(0, -1), shortPeriod);
    const smaLongPrev = calculateSMA(closePrices.slice(0, -1), longPeriod);

    if (smaShort === null || smaLong === null || smaShortPrev === null || smaLongPrev === null) {
      console.log("Could not calculate SMAs (null).", { smaShort, smaLong, smaShortPrev, smaLongPrev });
      return { shouldTrade: false, priceAtAnalysis: currentPrice };
    }

    console.log(`SMA Analysis: Current Price: ${currentPrice}, SMA(${shortPeriod}): ${smaShort.toFixed(2)}, SMA(${longPeriod}): ${smaLong.toFixed(2)}`);
    console.log(`SMA Analysis: Prev SMA(${shortPeriod}): ${smaShortPrev.toFixed(2)}, Prev SMA(${longPeriod}): ${smaLongPrev.toFixed(2)}`);

    // Bullish Crossover: Short MA crosses above Long MA
    if (smaShortPrev <= smaLongPrev && smaShort > smaLong) {
      console.log("Bullish Crossover Detected");
      return { shouldTrade: true, tradeType: 'BUY', priceAtAnalysis: currentPrice };
    }

    // Bearish Crossover: Short MA crosses below Long MA
    if (smaShortPrev >= smaLongPrev && smaShort < smaLong) {
      console.log("Bearish Crossover Detected");
      return { shouldTrade: true, tradeType: 'SELL', priceAtAnalysis: currentPrice };
    }

    console.log("No Crossover Detected");
    return { shouldTrade: false, priceAtAnalysis: currentPrice };

  } catch (error) {
    console.error("Error during market analysis:", error.message, error.stack);
    return { shouldTrade: false };
  }
}


async function processBotSession(supabase: any, session: any, apiKey: string) {
  console.log(`Processing bot session ${session.id} for user ${session.user_id}`);

  const riskSettingsMap = {
    conservative: { maxLotSize: 0.01, stopLossPips: 200 }, // Example: 200 pips for XAUUSD = $20 move if 1 pip = $0.1 for 0.01 lot
    medium: { maxLotSize: 0.05, stopLossPips: 300 },
    risky: { maxLotSize: 0.10, stopLossPips: 500 }
  };

  const settings = riskSettingsMap[session.risk_level] || riskSettingsMap.conservative;

  // Check existing open trades for this session/user to avoid over-trading (simplified)
  const { data: openTrades, error: openTradesError } = await supabase
    .from('trades')
    .select('id')
    .eq('user_id', session.user_id)
    .eq('trading_account_id', session.trading_account_id) // Assuming bot trades on a specific account
    .eq('status', 'open');

  if (openTradesError) {
    console.error("Error fetching open trades:", openTradesError);
    // Decide if to proceed or skip this run
  }

  if (openTrades && openTrades.length > 0) {
    console.log(`User ${session.user_id} already has ${openTrades.length} open trade(s). Skipping new trade for now.`);
    // Potentially add logic here to manage existing trades (e.g. check SL/TP based on new price)
    return;
  }
  
  const analysisResult = await analyzeMarketConditions(apiKey);
  
  if (analysisResult.shouldTrade && analysisResult.tradeType && analysisResult.priceAtAnalysis) {
    const tradeType = analysisResult.tradeType;
    const currentPrice = analysisResult.priceAtAnalysis; // Price at the time of analysis
    const lotSize = settings.maxLotSize;

    // Calculate Stop Loss price
    // For XAUUSD, 1 pip can be $0.01 for micro lots, $0.1 for mini lots, $1 for standard lots.
    // Assuming pip value is related to price, e.g. $1 move = 100 pips.
    // A $20 stop loss means 20 price points.
    const stopLossDistance = settings.stopLossPips / 10; // Convert pips to price points (e.g. 200 pips = $20)
    let stopLossPrice;
    if (tradeType === 'BUY') {
      stopLossPrice = currentPrice - stopLossDistance;
    } else { // SELL
      stopLossPrice = currentPrice + stopLossDistance;
    }
    
    console.log(`Executing ${tradeType} for session ${session.id}: Price=${currentPrice}, SL=${stopLossPrice}, Lot=${lotSize}`);

    const { error: tradeError } = await supabase.from('trades').insert({
      user_id: session.user_id,
      trading_account_id: session.trading_account_id,
      ticket_id: generateTicketId(),
      symbol: 'XAUUSD',
      trade_type: tradeType,
      lot_size: lotSize,
      open_price: currentPrice,
      stop_loss: stopLossPrice.toFixed(2), // Ensure correct decimal places for price
      // take_profit: null, // Add TP logic if desired
      status: 'open',
      bot_session_id: session.id // Link trade to bot session
    });

    if (tradeError) {
      console.error(`Error executing trade for session ${session.id}:`, tradeError);
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_trade_error',
        title: 'Bot Trade Failed',
        message: `Failed to execute ${tradeType} for bot session ${session.id}: ${tradeError.message}`
      });
    } else {
      console.log(`Trade executed for session ${session.id}`);
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_trade_executed',
        title: 'Bot Trade Executed',
        message: `${tradeType} ${lotSize} XAUUSD @ ${currentPrice} by bot (Session ${session.id})`
      });
      await supabase
        .from('bot_sessions')
        .update({ total_trades: (session.total_trades || 0) + 1, last_trade_time: new Date().toISOString() })
        .eq('id', session.id);
    }
  } else {
    console.log(`No trade signal for session ${session.id} based on current market conditions.`);
  }
}

function generateTicketId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}