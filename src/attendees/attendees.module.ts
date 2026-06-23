import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { AttendeesController } from './attendees.controller';
import { EventAttendeesController } from './event-attendees.controller';
import { AttendeesService } from './attendees.service';

@Module({
  imports: [PermissionsModule],
  controllers: [EventAttendeesController, AttendeesController],
  providers: [AttendeesService],
  exports: [AttendeesService],
})
export class AttendeesModule {}
