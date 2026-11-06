import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController, DocumentsPublicController } from './documents.controller';

@Module({
  controllers: [DocumentsController, DocumentsPublicController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}