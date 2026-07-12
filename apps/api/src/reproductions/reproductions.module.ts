import { Module } from '@nestjs/common';
import { ReproductionsController } from './reproductions.controller.js';
import { ReproductionsService } from './reproductions.service.js';

@Module({
  controllers: [ReproductionsController],
  providers: [ReproductionsService],
})
export class ReproductionsModule {}
