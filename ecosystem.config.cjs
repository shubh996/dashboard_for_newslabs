/**
 * PM2 process file — Hetzner VPS (always-on API + momentum loop).
 *
 * Install once:  npm i -g pm2
 * Start:         pm2 start ecosystem.config.cjs
 * Boot:          pm2 save && pm2 startup
 * Logs:          pm2 logs dashboard-api
 * Restart:       pm2 restart dashboard-api
 */
module.exports = {
  apps: [
    {
      name: 'dashboard-api',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // Momentum engine is in-process — never cluster this app
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        API_PORT: 3001,
        API_HOST: '0.0.0.0',
      },
      // Load secrets from .env.local on the server (dotenv in server/index.js)
      // Keep .env.local mode 600; never commit it.
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      time: true,
    },
  ],
}
