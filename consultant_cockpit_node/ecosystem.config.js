/**
 * PM2 生态系统配置
 *
 * 使用方法：
 *   pm2 start ecosystem.config.js
 *   pm2 stop consultant-cockpit
 *   pm2 restart consultant-cockpit
 *   pm2 logs consultant-cockpit
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      name: 'consultant-cockpit',
      script: 'server.js',

      // 实例数量（集群模式）
      instances: 1,

      // 自动重启
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',

      // 环境变量
      env: {
        NODE_ENV: 'production',
        PORT: 8501,
        LOG_LEVEL: 'info'
      },

      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug'
      },

      // 日志配置
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // 重启策略
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,

      // 进程管理
      kill_timeout: 5000,
      listen_timeout: 3000,
      wait_ready: false
    }
  ]
};
