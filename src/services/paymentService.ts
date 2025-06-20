import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '../lib/supabase';
import { Database } from '../types/database';

type Subscription = Database['public']['Tables']['subscriptions']['Row'];
type Payment = Database['public']['Tables']['payments']['Row'];

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export class PaymentService {
  private static instance: PaymentService;

  static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }
    return PaymentService.instance;
  }

  // Subscription Management
  async createSubscription(subscriptionData: {
    userId: string;
    planType: 'conservative' | 'medium' | 'risky';
    paymentMethod: 'stripe' | 'crypto';
  }) {
    const planPrices = {
      conservative: 299,
      medium: 599,
      risky: 999
    };

    const price = planPrices[subscriptionData.planType];

    try {
      if (subscriptionData.paymentMethod === 'stripe') {
        return await this.createStripeSubscription(subscriptionData.userId, subscriptionData.planType, price);
      } else {
        return await this.createCryptoSubscription(subscriptionData.userId, subscriptionData.planType, price);
      }
    } catch (error) {
      console.error('Error creating subscription:', error);
      return { data: null, error };
    }
  }

  async getUserSubscription(userId: string) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    return { data, error };
  }

  async cancelSubscription(subscriptionId: string) {
    const { data: subscription, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    if (fetchError || !subscription) {
      return { data: null, error: fetchError };
    }

    // Cancel Stripe subscription if exists
    if (subscription.stripe_subscription_id) {
      await this.cancelStripeSubscription(subscription.stripe_subscription_id);
    }

    // Update subscription status
    const { data, error } = await supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        auto_renew: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', subscriptionId)
      .select()
      .single();

    return { data, error };
  }

  // Payment Processing
  async processStripePayment(amount: number, currency: string = 'usd') {
    const stripe = await stripePromise;
    if (!stripe) throw new Error('Stripe not loaded');

    // Create payment intent on server
    const response = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amount * 100, currency }), // Convert to cents
    });

    const { client_secret } = await response.json();

    return { client_secret, stripe };
  }

  async recordPayment(paymentData: {
    userId: string;
    subscriptionId?: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    paymentProvider: string;
    providerPaymentId?: string;
    status: 'pending' | 'completed' | 'failed';
    metadata?: any;
  }) {
    const { data, error } = await supabase
      .from('payments')
      .insert({
        user_id: paymentData.userId,
        subscription_id: paymentData.subscriptionId,
        amount: paymentData.amount,
        currency: paymentData.currency,
        payment_method: paymentData.paymentMethod,
        payment_provider: paymentData.paymentProvider,
        provider_payment_id: paymentData.providerPaymentId,
        status: paymentData.status,
        metadata: paymentData.metadata
      })
      .select()
      .single();

    return { data, error };
  }

  async getPaymentHistory(userId: string, limit = 50) {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        subscriptions (
          plan_type
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    return { data, error };
  }

  // Crypto Payment Methods
  async createCryptoPayment(amount: number, currency: string = 'USDT') {
    // Generate unique payment address or use static address
    const paymentAddress = this.generateCryptoAddress();
    const paymentId = this.generatePaymentId();

    return {
      paymentId,
      address: paymentAddress,
      amount,
      currency,
      network: 'BEP20', // Binance Smart Chain
      qrCode: this.generateQRCode(paymentAddress, amount, currency)
    };
  }

  async verifyCryptoPayment(paymentId: string, txHash: string) {
    // In production, verify transaction on blockchain
    // For demo, simulate verification
    const isValid = await this.verifyTransactionOnChain(txHash);
    
    if (isValid) {
      // Update payment status
      await supabase
        .from('payments')
        .update({
          status: 'completed',
          provider_payment_id: txHash,
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId);
    }

    return isValid;
  }

  // Private Methods
  private async createStripeSubscription(userId: string, planType: string, price: number) {
    // Create subscription record
    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan_type: planType as any,
        price_paid: price,
        payment_method: 'stripe',
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    // Create payment record
    await this.recordPayment({
      userId,
      subscriptionId: subscription.id,
      amount: price,
      currency: 'USD',
      paymentMethod: 'card',
      paymentProvider: 'stripe',
      status: 'pending'
    });

    return { data: subscription, error: null };
  }

  private async createCryptoSubscription(userId: string, planType: string, price: number) {
    // Create subscription record
    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan_type: planType as any,
        price_paid: price,
        payment_method: 'crypto',
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    // Create crypto payment
    const cryptoPayment = await this.createCryptoPayment(price, 'USDT');

    // Create payment record
    await this.recordPayment({
      userId,
      subscriptionId: subscription.id,
      amount: price,
      currency: 'USDT',
      paymentMethod: 'crypto',
      paymentProvider: 'blockchain',
      status: 'pending',
      metadata: cryptoPayment
    });

    return { data: { subscription, cryptoPayment }, error: null };
  }

  private async cancelStripeSubscription(stripeSubscriptionId: string) {
    // Cancel Stripe subscription via API
    const response = await fetch('/api/cancel-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ subscriptionId: stripeSubscriptionId }),
    });

    return response.json();
  }

  private generateCryptoAddress(): string {
    // In production, generate unique address or use static address
    return '0x742d35Cc6634C0532925a3b8D4C2A8e1A8F2a8f2';
  }

  private generatePaymentId(): string {
    return 'pay_' + Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  private generateQRCode(address: string, amount: number, currency: string): string {
    // Generate QR code for crypto payment
    const paymentString = `${currency}:${address}?amount=${amount}`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentString)}`;
  }

  private async verifyTransactionOnChain(txHash: string): Promise<boolean> {
    // In production, verify transaction on blockchain
    // For demo, simulate verification after delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    return Math.random() > 0.1; // 90% success rate
  }
}

export const paymentService = PaymentService.getInstance();