import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  async getHealth() {
    const result = await this.healthService.check();
    if (!result.ok) throw new ServiceUnavailableException(result);
    return result;
  }
}

