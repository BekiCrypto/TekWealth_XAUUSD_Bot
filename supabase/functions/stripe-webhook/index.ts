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

    const signature = req.headers.get('stripe-signature')
    const body = await req.text()
    
    // Verify webhook signature
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
    if (!webhookSecret) {
      throw new Error('Missing webhook secret')
    }

    // Parse the event
    const event = JSON.parse(body)

    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(supabaseClient, event.data.object)
        break
      
      case 'invoice.payment_succeeded':
        await handleSubscriptionPayment(supabaseClient, event.data.object)
        break
      
      case 'customer.subscription.deleted':
        await handleSubscriptionCancellation(supabaseClient, event.data.object)
        break
      
      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

async function handlePaymentSuccess(supabase: any, paymentIntent: any) {
  // Update payment status
  const { error } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      provider_payment_id: paymentIntent.id,
      updated_at: new Date().toISOString()
    })
    .eq('provider_payment_id', paymentIntent.id)

  if (error) {
    console.error('Error updating payment:', error)
  }
}

async function handleSubscriptionPayment(supabase: any, invoice: any) {
  // Update subscription status
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', invoice.subscription)

  if (error) {
    console.error('Error updating subscription:', error)
  }
}

async function handleSubscriptionCancellation(supabase: any, subscription: any) {
  // Update subscription status
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      auto_renew: false,
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscription.id)

  if (error) {
    console.error('Error cancelling subscription:', error)
  }
}