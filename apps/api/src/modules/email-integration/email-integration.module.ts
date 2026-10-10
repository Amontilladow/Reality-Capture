import { Module } from '@nestjs/common';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { EmailTokenStore } from './email-token-store.service';

// Phase 3B: the shared, provider-agnostic infrastructure only -- no
// controller here (there is nothing provider-agnostic to route to yet) and
// no HttpModule import (no outbound HTTP calls happen at this layer; each
// provider's own client does that, added in Phase 3C/3D). OutlookModule and
// GmailModule will each import this module to get EmailTokenStore.
@Module({
  imports: [CryptoModule],
  providers: [EmailTokenStore],
  exports: [EmailTokenStore],
})
export class EmailIntegrationModule {}
