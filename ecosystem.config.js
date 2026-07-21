// PM2 config. Xem README phần "Chạy bằng PM2".
module.exports = {
  apps: [
    {
      // 1) Realtime: server + worker poll dữ liệu mới.
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
      },
    },
    {
      // 2) Backfill quá khứ: chạy từng tháng, mới -> cũ, tự resume nhờ backfill-cursor.json.
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
        BACKFILL_FROM: '2022-07-01',
        BACKFILL_TO: '2025-06-30',
        BACKFILL_UPLOAD: 'true',
        BACKFILL_FORCE: 'false',
      },
    },
  ],
};
