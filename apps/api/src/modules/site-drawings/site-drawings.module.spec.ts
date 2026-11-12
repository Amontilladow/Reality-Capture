import { SiteDrawingsModule } from './site-drawings.module';
import { SiteDrawingsController } from './site-drawings.controller';
import { SiteDrawingImportController } from './site-drawing-import.controller';

// Confirmed by hand against a real failure: GET .../site-drawings/import-batches
// was 500ing with `invalid input syntax for type uuid: "import-batches"`.
// SiteDrawingsController's own `@Controller('projects/:projectId/site-drawings')`
// + `@Get(':id')` matches that request (":id" = "import-batches") before
// Nest/Express ever tries SiteDrawingImportController's more specific
// `@Controller('projects/:projectId/site-drawings/import-batches')`, because
// controllers are matched in the order they're registered on the module.
// Reading the module's own `@Module()` metadata (not a full Nest app --
// no DB/storage/AI providers to mock) catches a reordering regression the
// same way the real bug happened: silently, with no type error.
describe('SiteDrawingsModule controller registration order', () => {
  it('registers SiteDrawingImportController before SiteDrawingsController', () => {
    const controllers: unknown[] = Reflect.getMetadata('controllers', SiteDrawingsModule) ?? [];
    const importIndex = controllers.indexOf(SiteDrawingImportController);
    const drawingsIndex = controllers.indexOf(SiteDrawingsController);

    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(drawingsIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeLessThan(drawingsIndex);
  });
});
