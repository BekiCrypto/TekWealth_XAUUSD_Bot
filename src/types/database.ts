export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          phone: string | null;
          timezone: string;
          role: 'admin' | 'subscriber';
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          phone?: string | null;
          timezone?: string;
          role?: 'admin' | 'subscriber';
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          phone?: string | null;
          timezone?: string;
          role?: 'admin' | 'subscriber';
          avatar_url?: string | null;
          updated_at?: string;
        };
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan_type: 'conservative' | 'medium' | 'risky';
          status: 'active' | 'cancelled' | 'expired' | 'pending';
          price_paid: number;
          currency: string;
          payment_method: string;
          start_date: string;
          end_date: string | null;
          auto_renew: boolean;
          stripe_subscription_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan_type: 'conservative' | 'medium' | 'risky';
          status?: 'active' | 'cancelled' | 'expired' | 'pending';
          price_paid: number;
          currency?: string;
          payment_method?: string;
          start_date?: string;
          end_date?: string | null;
          auto_renew?: boolean;
          stripe_subscription_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: 'active' | 'cancelled' | 'expired' | 'pending';
          end_date?: string | null;
          auto_renew?: boolean;
          updated_at?: string;
        };
      };
      trading_accounts: {
        Row: {
          id: string;
          user_id: string;
          platform: 'MT4' | 'MT5';
          server_name: string;
          login_id: string;
          password_encrypted: string;
          account_balance: number;
          equity: number;
          margin: number;
          free_margin: number;
          is_active: boolean;
          last_sync: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          platform: 'MT4' | 'MT5';
          server_name: string;
          login_id: string;
          password_encrypted: string;
          account_balance?: number;
          equity?: number;
          margin?: number;
          free_margin?: number;
          is_active?: boolean;
          last_sync?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          account_balance?: number;
          equity?: number;
          margin?: number;
          free_margin?: number;
          is_active?: boolean;
          last_sync?: string | null;
          updated_at?: string;
        };
      };
      trades: {
        Row: {
          id: string;
          user_id: string;
          trading_account_id: string;
          ticket_id: string;
          symbol: string;
          trade_type: 'BUY' | 'SELL';
          lot_size: number;
          open_price: number;
          close_price: number | null;
          stop_loss: number | null;
          take_profit: number | null;
          profit_loss: number | null;
          commission: number;
          swap: number;
          status: 'open' | 'closed' | 'cancelled';
          open_time: string;
          close_time: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          trading_account_id: string;
          ticket_id: string;
          symbol?: string;
          trade_type: 'BUY' | 'SELL';
          lot_size: number;
          open_price: number;
          close_price?: number | null;
          stop_loss?: number | null;
          take_profit?: number | null;
          profit_loss?: number | null;
          commission?: number;
          swap?: number;
          status?: 'open' | 'closed' | 'cancelled';
          open_time?: string;
          close_time?: string | null;
          created_at?: string;
        };
        Update: {
          close_price?: number | null;
          profit_loss?: number | null;
          status?: 'open' | 'closed' | 'cancelled';
          close_time?: string | null;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: 'trade_alert' | 'daily_report' | 'system_update' | 'price_alert' | 'payment';
          title: string;
          message: string;
          is_read: boolean;
          email_sent: boolean;
          telegram_sent: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: 'trade_alert' | 'daily_report' | 'system_update' | 'price_alert' | 'payment';
          title: string;
          message: string;
          is_read?: boolean;
          email_sent?: boolean;
          telegram_sent?: boolean;
          created_at?: string;
        };
        Update: {
          is_read?: boolean;
          email_sent?: boolean;
          telegram_sent?: boolean;
        };
      };
      payments: {
        Row: {
          id: string;
          user_id: string;
          subscription_id: string | null;
          amount: number;
          currency: string;
          payment_method: string;
          payment_provider: string;
          provider_payment_id: string | null;
          status: 'pending' | 'completed' | 'failed' | 'refunded';
          metadata: any;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          subscription_id?: string | null;
          amount: number;
          currency?: string;
          payment_method: string;
          payment_provider: string;
          provider_payment_id?: string | null;
          status?: 'pending' | 'completed' | 'failed' | 'refunded';
          metadata?: any;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: 'pending' | 'completed' | 'failed' | 'refunded';
          provider_payment_id?: string | null;
          metadata?: any;
          updated_at?: string;
        };
      };
      system_settings: {
        Row: {
          id: string;
          key: string;
          value: any;
          description: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          value: any;
          description?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          value?: any;
          description?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
      };
      price_data: {
        Row: {
          id: string;
          symbol: string;
          timestamp: string;
          open_price: number;
          high_price: number;
          low_price: number;
          close_price: number;
          volume: number;
          timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
          created_at: string;
        };
        Insert: {
          id?: string;
          symbol?: string;
          timestamp: string;
          open_price: number;
          high_price: number;
          low_price: number;
          close_price: number;
          volume?: number;
          timeframe?: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
          created_at?: string;
        };
        Update: {
          open_price?: number;
          high_price?: number;
          low_price?: number;
          close_price?: number;
          volume?: number;
        };
      };
      bot_sessions: {
        Row: {
          id: string;
          user_id: string;
          trading_account_id: string;
          session_start: string;
          session_end: string | null;
          status: 'active' | 'stopped' | 'error';
          risk_level: 'conservative' | 'medium' | 'risky';
          total_trades: number;
          winning_trades: number;
          losing_trades: number;
          total_profit: number;
          max_drawdown: number;
          settings: any;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          trading_account_id: string;
          session_start?: string;
          session_end?: string | null;
          status?: 'active' | 'stopped' | 'error';
          risk_level: 'conservative' | 'medium' | 'risky';
          total_trades?: number;
          winning_trades?: number;
          losing_trades?: number;
          total_profit?: number;
          max_drawdown?: number;
          settings?: any;
          created_at?: string;
        };
        Update: {
          session_end?: string | null;
          status?: 'active' | 'stopped' | 'error';
          total_trades?: number;
          winning_trades?: number;
          losing_trades?: number;
          total_profit?: number;
          max_drawdown?: number;
          settings?: any;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}