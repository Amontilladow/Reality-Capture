import { Injectable, Logger } from '@nestjs/common';
import { IfcImporter } from '@thatopen/fragments';
import * as path from 'path';

@Injectable()
export class IfcFragmentsService {
  private readonly logger = new Logger(IfcFragmentsService.name);

  async generate(data: Uint8Array): Promise<Uint8Array> {
    const importer = new IfcImporter();
    // web-ifc ships its own WASM binaries; @thatopen/fragments needs to be
    // pointed at wherever `web-ifc` resolved in node_modules, since it runs
    // its own internal web-ifc instance for geometry extraction.
    const wasmDir = path.dirname(require.resolve('web-ifc/web-ifc-node.wasm'));
    importer.wasm = { path: `${wasmDir}/`, absolute: true };

    try {
      return await importer.process({ bytes: data });
    } catch (error) {
      // Fragments generation failing doesn't have to fail the whole job —
      // the model's data (hierarchy/properties/quantities/etc.) is still
      // valuable without a viewer-ready geometry file. The processor
      // decides whether to treat this as a warning or a hard failure.
      this.logger.error(`Fragments generation failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
