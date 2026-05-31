import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  webServer: [
    {
      command: 'cmd /c "cd /d .. && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'cmd /c "npm run build && npm run preview:e2e"',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
