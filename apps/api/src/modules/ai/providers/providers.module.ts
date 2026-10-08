import { Module } from '@nestjs/common';
import { ProviderFactory } from './provider.factory';

// Split out from AiModule so both AiModule (RealityCapture AI) and
// AiConnectionsModule (BYO AI) can depend on ProviderFactory without a
// circular import between them -- AiService needs AiConnectionsService to
// resolve a user's BYO provider, and AiConnectionsService needs
// ProviderFactory to build/validate one, so ProviderFactory can't live
// inside either of the modules that need to reference it from the other
// side.
@Module({
  providers: [ProviderFactory],
  exports: [ProviderFactory],
})
export class ProvidersModule {}
