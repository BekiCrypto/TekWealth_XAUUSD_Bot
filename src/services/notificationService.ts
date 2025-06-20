import { supabase } from '../lib/supabase';
import { Database } from '../types/database';

type Notification = Database['public']['Tables']['notifications']['Row'];

export class NotificationService {
  private static instance: NotificationService;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // Create Notifications
  async createNotification(notificationData: {
    userId: string;
    type: 'trade_alert' | 'daily_report' | 'system_update' | 'price_alert' | 'payment';
    title: string;
    message: string;
  }) {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: notificationData.userId,
        type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message
      })
      .select()
      .single();

    if (!error && data) {
      // Send email and telegram notifications
      await this.sendEmailNotification(data);
      await this.sendTelegramNotification(data);
    }

    return { data, error };
  }

  async getUserNotifications(userId: string, limit = 50) {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    return { data, error };
  }

  async markAsRead(notificationId: string) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .select()
      .single();

    return { data, error };
  }

  async markAllAsRead(userId: string) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    return { data, error };
  }

  async getUnreadCount(userId: string) {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    return { count: count || 0, error };
  }

  // Bulk Notifications
  async createBulkNotification(notificationData: {
    userIds: string[];
    type: 'trade_alert' | 'daily_report' | 'system_update' | 'price_alert' | 'payment';
    title: string;
    message: string;
  }) {
    const notifications = notificationData.userIds.map(userId => ({
      user_id: userId,
      type: notificationData.type,
      title: notificationData.title,
      message: notificationData.message
    }));

    const { data, error } = await supabase
      .from('notifications')
      .insert(notifications)
      .select();

    if (!error && data) {
      // Send bulk email and telegram notifications
      await Promise.all(data.map(notification => 
        Promise.all([
          this.sendEmailNotification(notification),
          this.sendTelegramNotification(notification)
        ])
      ));
    }

    return { data, error };
  }

  async sendSystemAlert(title: string, message: string) {
    // Get all active users
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'subscriber');

    if (error || !profiles) return { data: null, error };

    const userIds = profiles.map(profile => profile.id);
    
    return await this.createBulkNotification({
      userIds,
      type: 'system_update',
      title,
      message
    });
  }

  // Daily Reports
  async sendDailyReports() {
    // Get all active subscribers
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'subscriber');

    if (error || !profiles) return;

    for (const profile of profiles) {
      await this.generateDailyReport(profile.id);
    }
  }

  private async generateDailyReport(userId: string) {
    // Get user's trading data for today
    const today = new Date().toISOString().split('T')[0];
    
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', today + 'T00:00:00.000Z')
      .lt('created_at', today + 'T23:59:59.999Z');

    if (error) return;

    const totalTrades = trades?.length || 0;
    const profitableTrades = trades?.filter(t => (t.profit_loss || 0) > 0).length || 0;
    const totalProfit = trades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;

    const title = 'Daily Trading Report';
    const message = `Today's Summary:
    • Total Trades: ${totalTrades}
    • Profitable Trades: ${profitableTrades}
    • Win Rate: ${totalTrades > 0 ? ((profitableTrades / totalTrades) * 100).toFixed(1) : 0}%
    • Total P&L: $${totalProfit.toFixed(2)}`;

    await this.createNotification({
      userId,
      type: 'daily_report',
      title,
      message
    });
  }

  // External Notification Services
  private async sendEmailNotification(notification: Notification) {
    try {
      // Get user profile for email
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', notification.user_id)
        .single();

      if (!profile) return;

      // Send email via SendGrid or similar service
      const emailData = {
        to: profile.email,
        subject: notification.title,
        html: this.generateEmailTemplate(notification, profile.full_name),
      };

      // In production, integrate with SendGrid
      console.log('Sending email:', emailData);

      // Update notification as sent
      await supabase
        .from('notifications')
        .update({ email_sent: true })
        .eq('id', notification.id);

    } catch (error) {
      console.error('Error sending email notification:', error);
    }
  }

  private async sendTelegramNotification(notification: Notification) {
    try {
      // Get user's Telegram chat ID (would be stored in profile)
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', notification.user_id)
        .single();

      if (!profile) return;

      // Send Telegram message
      const telegramMessage = `🤖 *${notification.title}*\n\n${notification.message}`;
      
      // In production, send via Telegram Bot API
      console.log('Sending Telegram message:', telegramMessage);

      // Update notification as sent
      await supabase
        .from('notifications')
        .update({ telegram_sent: true })
        .eq('id', notification.id);

    } catch (error) {
      console.error('Error sending Telegram notification:', error);
    }
  }

  private generateEmailTemplate(notification: Notification, userName?: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${notification.title}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 20px; }
          .footer { background: #333; color: white; padding: 10px; text-align: center; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏆 GoldBot Pro</h1>
          </div>
          <div class="content">
            <h2>Hello ${userName || 'Trader'}!</h2>
            <h3>${notification.title}</h3>
            <p>${notification.message.replace(/\n/g, '<br>')}</p>
            <p>Best regards,<br>The GoldBot Pro Team</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 GoldBot Pro. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

export const notificationService = NotificationService.getInstance();