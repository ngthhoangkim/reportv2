// PM2 config. Xem README phần "Chạy bằng PM2".
module.exports = {
  apps: [
    {
      // 0) SSH tunnel tới SQL Server trên AWS/bastion. Cần key SSH để chạy không hỏi password.
      name: 'reportv2-db-tunnel',
      script: 'ssh',
      args: [
        '-N',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-L', '51500:127.0.0.1:1433',
        'ubuntu@54.255.227.162',
      ],
      interpreter: 'none',
      autorestart: true,
      restart_delay: 5000,
      out_file: 'logs/pm2-db-tunnel.out.log',
      error_file: 'logs/pm2-db-tunnel.err.log',
      time: true,
    },
    {
      // 1) Server + worker dữ liệu mới. Worker dùng cursor local nên không quét lặp DB.
      name: 'reportv2',
      script: 'src/server.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '1G',
      out_file: 'logs/pm2-reportv2.out.log',
      error_file: 'logs/pm2-reportv2.err.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        WORKER_ENABLED: 'true',
        WORKER_SCHEDULE_TIMES: '02:15,14:15',
        WORKER_POLL_SECONDS: '0',
        WORKER_INITIAL_LOOKBACK_HOURS: '48',
        WORKER_CURSOR_OVERLAP_MINUTES: '15',
        WORKER_SETTLE_SECONDS: '60',
        CLEANUP_INTERVAL_SECONDS: '30',
        DB_IDLE_CLOSE_SECONDS: '30',
      },
    },
    {
      // 2) Backfill quá khứ: chạy từng ngày/tháng, mới -> cũ, tự resume nhờ backfill-cursor.json.
      //    autorestart:false BẮT BUỘC — script này kết thúc, để true là PM2 chạy lại vô hạn.
      name: 'reportv2-backfill',
      script: 'src/scripts/backfillChunked.js',
      cwd: __dirname,
      autorestart: false,
      out_file: 'logs/pm2-backfill.out.log',
      error_file: 'logs/pm2-backfill.err.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        WORKER_ENABLED: 'false',
        BACKFILL_FROM: '2026-08-01',
        BACKFILL_TO: '2026-10-06',
        BACKFILL_CHUNK: 'day',
        BACKFILL_UPLOAD: 'true',
        BACKFILL_FORCE: 'false',
      },
    },
  ],
};
