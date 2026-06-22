import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { EventTeamController } from './event-team.controller';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [PermissionsModule],
  controllers: [EventTeamController, TeamController],
  providers: [TeamService],
})
export class TeamModule {}
