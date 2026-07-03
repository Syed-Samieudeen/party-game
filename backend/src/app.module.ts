import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoomModule } from './room/room.module';
import { PrismaService } from './prisma/prisma.service';
import { EventsGateway } from './events/events.gateway';



@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RoomModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService, EventsGateway],
})
export class AppModule {}
