# TekWealth_XAUUSD_Bot (goldbot-pro)

TekWealth_XAUUSD_Bot is a sophisticated trading bot designed for automated trading of XAU/USD (Gold/US Dollar) pair. It leverages modern web technologies and a robust backend to provide users with a seamless and efficient trading experience.

## Features

- **Automated Trading:** Executes trades based on predefined strategies or user configurations.
- **Real-time Market Data:** Integrates with market data providers to display real-time XAU/USD prices and charts.
- **User Authentication:** Secure user registration and login functionality.
- **Dashboard:** User-friendly dashboard to monitor trading activity, performance, and account status.
- **Admin Panel:** For administrative control, user management, and system configuration.
- **Payment Integration:** Uses Stripe for subscription management or other payment-related services.
- **Notifications:** Provides users with timely notifications via email (SendGrid) and Telegram about trades, market alerts, or account activity.
- **Trading Engine Control:** Allows users or admins to start, stop, or configure the trading engine.

## Technologies Used

**Frontend:**

- React
- Vite
- TypeScript
- Tailwind CSS
- Zustand (State Management)
- React Query (Data Fetching)
- Recharts (Charting)
- Framer Motion (Animations)
- `lucide-react` (Icons)

**Backend/Platform:**

- Supabase (Backend-as-a-Service: Database, Auth, Functions)
- Node.js (for Supabase functions)
- Stripe (Payment Processing)
- Socket.io (Real-time communication)
- SendGrid (Email notifications)
- Telegram Bot API (Telegram notifications)

**Development:**

- ESLint (Linting)
- PostCSS & Autoprefixer (CSS processing)

## Getting Started

### Prerequisites

- Node.js (check `package.json` for specific version compatibility if listed, otherwise latest LTS)
- npm or yarn
- Supabase account and project setup
- Stripe account and API keys
- SendGrid account and API key
- Telegram Bot Token

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd goldbot-pro
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    # or
    # yarn install
    ```

3.  **Set up environment variables:**
    Create a `.env` file by copying `.env.example`. Fill in the required environment variables:
    ```env
    # Supabase
    VITE_SUPABASE_URL=your_supabase_url
    VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

    # Stripe
    VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
    # Add any other backend Stripe keys if needed for serverless functions, e.g., STRIPE_SECRET_KEY

    # SendGrid
    SENDGRID_API_KEY=your_sendgrid_api_key

    # Telegram
    TELEGRAM_BOT_TOKEN=your_telegram_bot_token

    # Other configurations
    # e.g., API endpoints for trading services if they are external
    ```
    *Note: For production, ensure these variables are set securely in your deployment environment.*

4.  **Supabase Setup:**
    - Set up your Supabase database schema. Migrations are located in the `supabase/migrations` directory. You can apply them using the Supabase CLI or through the Supabase dashboard.
      ```bash
      # Example using Supabase CLI (ensure you are logged in and project is linked)
      supabase db push
      ```
    - Configure Supabase Authentication according to your needs.
    - Deploy Supabase functions located in `supabase/functions/`.
      ```bash
      # Example using Supabase CLI
      supabase functions deploy stripe-webhook
      supabase functions deploy trading-engine
      # Deploy any other relevant functions (e.g., for SendGrid or Telegram notifications if handled via Supabase Functions)
      ```

5.  **Stripe Setup:**
    - Configure your Stripe account with the necessary products, prices, and webhook endpoints.
    - The `stripe-webhook` function (`supabase/functions/stripe-webhook/index.ts`) needs to be configured as a webhook endpoint in your Stripe dashboard.

6.  **SendGrid Setup:**
    - Configure your SendGrid account, including sender authentication and any necessary templates.

7.  **Telegram Setup:**
    - Create a Telegram bot using BotFather to obtain your `TELEGRAM_BOT_TOKEN`.
    - Implement the bot logic to handle incoming messages or send notifications. This might be part of your backend services or Supabase Functions.

### Running the Application

-   **Development Mode:**
    ```bash
    npm run dev
    ```
    This will start the Vite development server, typically on `http://localhost:5173`.

-   **Production Build:**
    ```bash
    npm run build
    ```
    This command compiles the application into static assets in the `dist` folder, ready for deployment.

-   **Linting:**
    ```bash
    npm run lint
    ```
    Checks the codebase for linting errors using ESLint.

## Usage

After setting up and running the application:

1.  Navigate to the application URL in your browser.
2.  Sign up for a new account or log in if you already have one.
3.  Explore the dashboard to view market data and trading options.
4.  Configure your trading bot settings as per your strategy.
5.  Set up your notification preferences (e.g., email, Telegram).
6.  Monitor your trading activity and performance.

For administrators:
1. Access the admin dashboard to manage users, system settings, and monitor overall bot performance.

## Production Readiness Considerations

-   **Security:**
    -   Ensure all API keys and sensitive credentials are stored securely using environment variables and not hardcoded.
    -   Regularly update dependencies to patch security vulnerabilities.
    -   Implement proper input validation and output encoding.
    -   Secure Supabase row-level security (RLS) policies must be in place for database access.
    -   Protect against common web vulnerabilities (XSS, CSRF, etc.).
    -   Securely manage user sessions and authentication tokens.
-   **Error Handling:**
    -   Implement comprehensive error handling on both client-side and server-side (Supabase functions, backend services).
    -   Provide user-friendly error messages.
    -   Use logging services (e.g., Supabase logs, external logging platforms) to track and debug errors in production.
-   **Performance:**
    -   Optimize frontend bundle size (code splitting, lazy loading).
    -   Efficient data fetching and state management.
    -   Optimize Supabase queries and database schema (indexing, query analysis).
    -   Consider pagination for large datasets in dashboards and reports.
    -   Monitor application performance and identify bottlenecks.
-   **Configuration:**
    -   Use environment variables for all environment-specific configurations (URLs, API keys, feature flags).
    -   Ensure Supabase functions, Stripe webhooks, SendGrid settings, and Telegram bot configurations are correctly set up for the production environment.
-   **Logging:**
    -   Implement structured logging in Supabase functions and any other backend services for easier debugging and monitoring.
    -   Monitor client-side errors using appropriate tools (e.g., Sentry, LogRocket).
-   **Scalability:**
    -   Ensure Supabase resources and backend services can scale with user load.
    -   Design trading engine and notification systems to handle potential peaks in activity.
-   **Backups and Recovery:**
    -   Regularly back up your Supabase database.
    -   Have a disaster recovery plan in place.

## Contributing

If you wish to contribute to the project, please:

1.  Fork the repository.
2.  Create a new branch for your feature or bug fix: `git checkout -b feature/your-feature-name` or `bugfix/issue-description`.
3.  Make your changes and commit them with clear, descriptive messages.
4.  Push your changes to your fork: `git push origin feature/your-feature-name`.
5.  Create a pull request to the main repository.

Please ensure your code adheres to the existing coding style and passes linting checks.

## License

This project is currently private. If a license is chosen in the future, it will be updated here. (Placeholder - update as needed, e.g., MIT, Apache 2.0)
