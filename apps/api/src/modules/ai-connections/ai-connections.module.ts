import { Module } from '@nestjs/common';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { ProvidersModule } from '../ai/providers/providers.module';
import { AiConnectionsController } from './ai-connections.controller';
import { AiConnectionsService } from './ai-connections.service';

@Module({
  imports: [CryptoModule, ProvidersModule],
  controllers: [AiConnectionsController],
  providers: [AiConnectionsService],
  exports: [AiConnectionsService],
})
export class AiConnectionsModule {}
