/*
  # Initial Database Schema for GoldBot Pro

  1. New Tables
    - `profiles` - User profile information
    - `subscriptions` - User subscription plans and status
    - `trading_accounts` - MT4/MT5 account credentials (encrypted)
    - `trades` - Trading history and performance
    - `notifications` - User notification preferences
    - `payments` - Payment history and transactions
    - `system_settings` - Global system configuration
    - `price_data` - Historical gold price data
    - `bot_sessions` - Trading bot session logs

  2. Security
    - Enable RLS on all tables
    - Add policies for user data access
    - Admin-only access for system tables
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email text UNIQUE NOT NULL,
  full_name text,
  phone text,
  timezone text DEFAULT 'UTC',
  role text DEFAULT 'subscriber' CHECK (role IN ('admin', 'subscriber')),
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  plan_type text NOT NULL CHECK (plan_type IN ('conservative', 'medium', 'risky')),
  status text DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'pending')),
  price_paid decimal(10,2) NOT NULL,
  currency text DEFAULT 'USD',
  payment_method text DEFAULT 'crypto',
  start_date timestamptz DEFAULT now(),
  end_date timestamptz,
  auto_renew boolean DEFAULT true,
  stripe_subscription_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trading accounts table (encrypted credentials)
CREATE TABLE IF NOT EXISTS trading_accounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  platform text NOT NULL CHECK (platform IN ('MT4', 'MT5')),
  server_name text NOT NULL,
  login_id text NOT NULL,
  password_encrypted text NOT NULL,
  account_balance decimal(15,2) DEFAULT 0,
  equity decimal(15,2) DEFAULT 0,
  margin decimal(15,2) DEFAULT 0,
  free_margin decimal(15,2) DEFAULT 0,
  is_active boolean DEFAULT true,
  last_sync timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  trading_account_id uuid REFERENCES trading_accounts(id) ON DELETE CASCADE NOT NULL,
  ticket_id text NOT NULL,
  symbol text DEFAULT 'XAUUSD',
  trade_type text NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
  lot_size decimal(10,3) NOT NULL,
  open_price decimal(10,5) NOT NULL,
  close_price decimal(10,5),
  stop_loss decimal(10,5),
  take_profit decimal(10,5),
  profit_loss decimal(10,2),
  commission decimal(10,2) DEFAULT 0,
  swap decimal(10,2) DEFAULT 0,
  status text DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  open_time timestamptz DEFAULT now(),
  close_time timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN ('trade_alert', 'daily_report', 'system_update', 'price_alert', 'payment')),
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  email_sent boolean DEFAULT false,
  telegram_sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount decimal(10,2) NOT NULL,
  currency text DEFAULT 'USD',
  payment_method text NOT NULL,
  payment_provider text NOT NULL,
  provider_payment_id text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- System settings table
CREATE TABLE IF NOT EXISTS system_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Price data table
CREATE TABLE IF NOT EXISTS price_data (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol text DEFAULT 'XAUUSD',
  timestamp timestamptz NOT NULL,
  open_price decimal(10,5) NOT NULL,
  high_price decimal(10,5) NOT NULL,
  low_price decimal(10,5) NOT NULL,
  close_price decimal(10,5) NOT NULL,
  volume bigint DEFAULT 0,
  timeframe text DEFAULT '1m' CHECK (timeframe IN ('1m', '5m', '15m', '30m', '1h', '4h', '1d')),
  created_at timestamptz DEFAULT now()
);

-- Bot sessions table
CREATE TABLE IF NOT EXISTS bot_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  trading_account_id uuid REFERENCES trading_accounts(id) ON DELETE CASCADE NOT NULL,
  session_start timestamptz DEFAULT now(),
  session_end timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'error')),
  risk_level text NOT NULL CHECK (risk_level IN ('conservative', 'medium', 'risky')),
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  total_profit decimal(10,2) DEFAULT 0,
  max_drawdown decimal(5,2) DEFAULT 0,
  settings jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for subscriptions
CREATE POLICY "Users can read own subscriptions"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can read all subscriptions"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for trading accounts
CREATE POLICY "Users can manage own trading accounts"
  ON trading_accounts FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for trades
CREATE POLICY "Users can read own trades"
  ON trades FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can insert trades"
  ON trades FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for notifications
CREATE POLICY "Users can manage own notifications"
  ON notifications FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for payments
CREATE POLICY "Users can read own payments"
  ON payments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for system settings (admin only)
CREATE POLICY "Admins can manage system settings"
  ON system_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for price data (read-only for authenticated users)
CREATE POLICY "Authenticated users can read price data"
  ON price_data FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policies for bot sessions
CREATE POLICY "Users can manage own bot sessions"
  ON bot_sessions FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_trading_accounts_user_id ON trading_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_open_time ON trades(open_time);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_price_data_symbol_timestamp ON price_data(symbol, timestamp);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_user_id ON bot_sessions(user_id);

-- Insert default system settings
INSERT INTO system_settings (key, value, description) VALUES
('trading_enabled', 'true', 'Global trading system status'),
('max_daily_trades', '50', 'Maximum trades per day per user'),
('default_risk_level', '"medium"', 'Default risk level for new users'),
('maintenance_mode', 'false', 'System maintenance status'),
('supported_symbols', '["XAUUSD"]', 'List of supported trading symbols'),
('price_update_interval', '5', 'Price update interval in seconds'),
('notification_settings', '{"email": true, "telegram": true}', 'Default notification settings')
ON CONFLICT (key) DO NOTHING;