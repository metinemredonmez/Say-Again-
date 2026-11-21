import { Controller, Get } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  // Liveness only, with no dependency details in the answer (OPS-01). A readiness check for the
  // database is added together with the database in stage 2.
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([]);
  }
}
