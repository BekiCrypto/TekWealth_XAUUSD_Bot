import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action, data } = await req.json()

    switch (action) {
      case 'execute_trade':
        return await executeTrade(supabaseClient, data)
      
      case 'close_trade':
        return await closeTrade(supabaseClient, data)
      
      case 'update_prices':
        return await updatePrices(supabaseClient, data)
      
      case 'run_bot_logic':
        return await runBotLogic(supabaseClient, data)
      
      default:
        throw new Error(`Unknown action: ${action}`)
    }
  } catch (error) {
    console.error('Trading engine error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

async function executeTrade(supabase: any, tradeData: any) {
  // Simulate trade execution
  const currentPrice = await getCurrentGoldPrice()
  
  const { data: trade, error } = await supabase
    .from('trades')
    .insert({
      user_id: tradeData.userId,
      trading_account_id: tradeData.accountId,
      ticket_id: generateTicketId(),
      symbol: 'XAUUSD',
      trade_type: tradeData.type,
      lot_size: tradeData.lotSize,
      open_price: currentPrice,
      stop_loss: tradeData.stopLoss,
      take_profit: tradeData.takeProfit,
      status: 'open'
    })
    .select()
    .single()

  if (error) throw error

  // Create notification
  await supabase.from('notifications').insert({
    user_id: tradeData.userId,
    type: 'trade_alert',
    title: 'Trade Executed',
    message: `${tradeData.type} ${tradeData.lotSize} lots of XAUUSD at $${currentPrice}`
  })

  return new Response(JSON.stringify({ trade }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function closeTrade(supabase: any, closeData: any) {
  const currentPrice = await getCurrentGoldPrice()
  
  // Get trade details
  const { data: trade, error: fetchError } = await supabase
    .from('trades')
    .select('*')
    .eq('id', closeData.tradeId)
    .single()

  if (fetchError) throw fetchError

  // Calculate profit/loss
  const priceDiff = trade.trade_type === 'BUY' 
    ? currentPrice - trade.open_price
    : trade.open_price - currentPrice
  
  const profitLoss = priceDiff * trade.lot_size * 100

  // Update trade
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

  // Create notification
  await supabase.from('notifications').insert({
    user_id: trade.user_id,
    type: 'trade_alert',
    title: 'Trade Closed',
    message: `Trade closed with ${profitLoss >= 0 ? 'profit' : 'loss'}: $${profitLoss.toFixed(2)}`
  })

  return new Response(JSON.stringify({ trade: updatedTrade }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function updatePrices(supabase: any, priceData: any) {
  const { data, error } = await supabase
    .from('price_data')
    .insert({
      symbol: 'XAUUSD',
      timestamp: new Date().toISOString(),
      open_price: priceData.open,
      high_price: priceData.high,
      low_price: priceData.low,
      close_price: priceData.close,
      volume: priceData.volume || 0,
      timeframe: '1m'
    })

  if (error) throw error

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function runBotLogic(supabase: any, botData: any) {
  // Get active bot sessions
  const { data: sessions, error } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('status', 'active')

  if (error) throw error

  for (const session of sessions) {
    await processBotSession(supabase, session)
  }

  return new Response(JSON.stringify({ processed: sessions.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function processBotSession(supabase: any, session: any) {
  // Implement bot trading logic based on risk level
  const riskSettings = {
    conservative: { maxLotSize: 0.1, maxDailyTrades: 5, stopLoss: 20 },
    medium: { maxLotSize: 0.5, maxDailyTrades: 10, stopLoss: 30 },
    risky: { maxLotSize: 1.0, maxDailyTrades: 20, stopLoss: 50 }
  }

  const settings = riskSettings[session.risk_level]
  
  // Check if should execute trade based on market conditions
  const shouldTrade = await analyzeMarketConditions()
  
  if (shouldTrade) {
    const tradeType = Math.random() > 0.5 ? 'BUY' : 'SELL'
    const currentPrice = await getCurrentGoldPrice()
    
    await supabase.from('trades').insert({
      user_id: session.user_id,
      trading_account_id: session.trading_account_id,
      ticket_id: generateTicketId(),
      symbol: 'XAUUSD',
      trade_type: tradeType,
      lot_size: settings.maxLotSize,
      open_price: currentPrice,
      stop_loss: tradeType === 'BUY' ? currentPrice - settings.stopLoss : currentPrice + settings.stopLoss,
      status: 'open'
    })

    // Update session stats
    await supabase
      .from('bot_sessions')
      .update({
        total_trades: session.total_trades + 1
      })
      .eq('id', session.id)
  }
}

async function getCurrentGoldPrice(): Promise<number> {
  // In production, fetch from real price feed
  const basePrice = 2045
  const variation = (Math.random() - 0.5) * 10
  return basePrice + variation
}

async function analyzeMarketConditions(): Promise<boolean> {
  // Implement market analysis logic
  // For demo, random decision with 30% probability
  return Math.random() > 0.7
}

function generateTicketId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}