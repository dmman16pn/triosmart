// pm2 — 4 tiến trình TRIOSMART trên VPS (spec §2: receiver/worker/scheduler/api)
module.exports = {
  apps: [
    { name: 'trio-api',       script: 'src/api/server.js' },
    { name: 'trio-receiver',  script: 'src/receiver/server.js' },
    { name: 'trio-worker',    script: 'src/worker/index.js' },
    { name: 'trio-scheduler', script: 'src/scheduler/index.js' },
  ].map(a => ({
    ...a,
    cwd: '/root/triosmart/app',
    max_memory_restart: '400M',
    autorestart: true,
    max_restarts: 50,
    restart_delay: 3000,
    env: { NODE_ENV: 'production' },
  })),
}
