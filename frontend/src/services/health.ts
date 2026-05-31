import { request } from './request';
import type { HealthStatus } from '../types/api';

export function getHealthStatus() {
  return request<HealthStatus>('/api/health');
}
