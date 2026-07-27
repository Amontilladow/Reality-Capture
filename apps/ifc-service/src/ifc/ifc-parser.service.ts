import { Injectable, Logger } from '@nestjs/common';
import * as WebIFC from 'web-ifc';
import { unwrapIfcValue, unwrapIfcRef, unwrapIfcRefList, extractQuantityValue } from './ifc-value.util';
import type {
  IfcSpatialNodeInput,
  IfcElementInput,
  IfcQuantityInput,
  IfcMaterialInput,
  IfcElementMaterialInput,
  IfcClassificationInput,
  IfcRelationshipInput,
} from '@engineeringos/types';

const SPATIAL_TYPES = new Set(['IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE']);

export interface WalkResult {
  spatialNodes: IfcSpatialNodeInput[];
  // GUID -> expressID, needed by every later stage to resolve tree/rel
  // references back to the stable identity we persist.
  guidByExpressId: Map<number, string>;
  // expressID -> nearest ancestor spatial node GUID (site/building/storey/space)
  spatialNodeGuidByElement: Map<number, string>;
  // Leaf (non-spatial) expressIDs to process for properties/materials/quantities,
  // in tree order — NOT materialized further than the ID + type + name +
  // parent, so the batch loop can page through them without holding every
  // element's full property data at once.
  elementSkeletons: Array<{ expressId: number; guid: string; ifcType: string; parentElementGuid: string | null }>;
  aggregatesRelationships: IfcRelationshipInput[];
  containedInStructureRelationships: IfcRelationshipInput[];
}

interface TreeNode {
  expressID: number;
  type: string;
  children: TreeNode[];
}

@Injectable()
export class IfcParserService {
  private readonly logger = new Logger(IfcParserService.name);
  private api: WebIFC.IfcAPI | null = null;
  private initialized = false;

  private async ensureInitialized(): Promise<WebIFC.IfcAPI> {
    if (!this.initialized) {
      this.api = new WebIFC.IfcAPI();
      await this.api.Init();
      this.initialized = true;
    }
    return this.api!;
  }

  // Opens a model from raw bytes. Throws a descriptive error (caller stores
  // it as processing_error) rather than letting web-ifc's -1 sentinel model
  // ID silently propagate into later calls, which is a real failure mode
  // for malformed/non-IFC input.
  async openModel(data: Uint8Array): Promise<{ api: WebIFC.IfcAPI; modelId: number; schema: string }> {
    const api = await this.ensureInitialized();
    let modelId: number;
    try {
      modelId = api.OpenModel(data);
    } catch (error) {
      throw new Error(`web-ifc failed to open the file (${error instanceof Error ? error.message : String(error)}). The file may not be valid STEP/IFC.`);
    }
    if (modelId === -1 || modelId === undefined || modelId === null) {
      throw new Error('web-ifc rejected the file — it is not a well-formed IFC/STEP file.');
    }
    let schema: string;
    try {
      schema = api.GetModelSchema(modelId);
    } catch {
      schema = 'UNKNOWN';
    }
    return { api, modelId, schema };
  }

  closeModel(api: WebIFC.IfcAPI, modelId: number): void {
    try {
      api.CloseModel(modelId);
    } catch (error) {
      this.logger.warn(`Failed to close model ${modelId} cleanly: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Walks IfcProject's spatial structure tree once. This is the single
  // source of truth for hierarchy (Site→Building→Storey→Space→Elements)
  // AND for aggregates/contained-in-structure relationships — both are
  // literally encoded in the same tree, so deriving them from one walk
  // instead of separate raw relationship queries is both simpler and
  // guaranteed consistent with the hierarchy itself.
  async walkHierarchy(api: WebIFC.IfcAPI, modelId: number): Promise<WalkResult> {
    const tree = (await api.properties.getSpatialStructure(modelId, false)) as unknown as TreeNode;

    const spatialNodes: IfcSpatialNodeInput[] = [];
    const guidByExpressId = new Map<number, string>();
    const spatialNodeGuidByElement = new Map<number, string>();
    const elementSkeletons: WalkResult['elementSkeletons'] = [];
    const aggregatesRelationships: IfcRelationshipInput[] = [];
    const containedInStructureRelationships: IfcRelationshipInput[] = [];

    const guidOf = (expressId: number): string => {
      const cached = guidByExpressId.get(expressId);
      if (cached) return cached;
      const line = api.GetLine(modelId, expressId, false) as Record<string, unknown>;
      const guid = (unwrapIfcValue(line.GlobalId) as string) ?? `NO_GUID_${expressId}`;
      guidByExpressId.set(expressId, guid);
      return guid;
    };

    // Recursive walk. IFC spatial trees are shallow (5-6 levels) even for
    // huge buildings, so recursion depth is never a real concern here —
    // it's the per-node WORK (property/quantity extraction) that has to be
    // batched, which happens later, not during this lightweight tree walk.
    const visit = (node: TreeNode, parentSpatialGuid: string | null, parentElementGuid: string | null) => {
      const type = node.type.toUpperCase();
      const guid = guidOf(node.expressID);

      if (type === 'IFCPROJECT') {
        for (const child of node.children ?? []) visit(child, null, null);
        return;
      }

      if (SPATIAL_TYPES.has(type)) {
        let name: string | undefined;
        let elevation: number | undefined;
        try {
          const line = api.GetLine(modelId, node.expressID, false) as Record<string, unknown>;
          name = (unwrapIfcValue(line.Name) as string) ?? undefined;
          elevation = type === 'IFCBUILDINGSTOREY' ? ((unwrapIfcValue(line.Elevation) as number) ?? undefined) : undefined;
        } catch {
          // Non-fatal — the node still gets recorded with just its GUID/type.
        }
        spatialNodes.push({
          ifcGuid: guid,
          ifcType: type as IfcSpatialNodeInput['ifcType'],
          name,
          elevation,
          parentGuid: parentSpatialGuid ?? undefined,
        });
        for (const child of node.children ?? []) visit(child, guid, null);
        return;
      }

      // Anything else is an element (walls, doors, roofs, MEP, and any
      // nested element like slabs aggregated under a roof).
      elementSkeletons.push({ expressId: node.expressID, guid, ifcType: type, parentElementGuid });
      if (parentSpatialGuid) {
        spatialNodeGuidByElement.set(node.expressID, parentSpatialGuid);
        containedInStructureRelationships.push({
          relationshipType: 'contained_in_structure',
          relatingGuid: parentSpatialGuid,
          relatedGuid: guid,
        });
      }
      if (parentElementGuid) {
        aggregatesRelationships.push({
          relationshipType: 'aggregates',
          relatingGuid: parentElementGuid,
          relatedGuid: guid,
        });
      }
      for (const child of node.children ?? []) visit(child, parentSpatialGuid, guid);
    };

    visit(tree, null, null);

    return { spatialNodes, guidByExpressId, spatialNodeGuidByElement, elementSkeletons, aggregatesRelationships, containedInStructureRelationships };
  }

  // Global (not per-element) queries — both relationship kinds here are
  // typically far fewer rows than the element count, so holding them all
  // in memory at once is bounded and cheap, unlike per-element property
  // data.
  async getVoidsAndFills(api: WebIFC.IfcAPI, modelId: number): Promise<IfcRelationshipInput[]> {
    const results: IfcRelationshipInput[] = [];
    const guidCache = new Map<number, string>();
    const guidOf = (id: number) => {
      const cached = guidCache.get(id);
      if (cached) return cached;
      const line = api.GetLine(modelId, id, false) as Record<string, unknown>;
      const guid = (unwrapIfcValue(line.GlobalId) as string) ?? `NO_GUID_${id}`;
      guidCache.set(id, guid);
      return guid;
    };

    const voidIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELVOIDSELEMENT);
    for (let i = 0; i < voidIds.size(); i++) {
      const line = api.GetLine(modelId, voidIds.get(i), false) as Record<string, unknown>;
      const relatingId = unwrapIfcRef(line.RelatingBuildingElement);
      const relatedId = unwrapIfcRef(line.RelatedOpeningElement);
      if (relatingId !== null && relatedId !== null) {
        results.push({ relationshipType: 'voids', relatingGuid: guidOf(relatingId), relatedGuid: guidOf(relatedId) });
      }
    }

    const fillIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELFILLSELEMENT);
    for (let i = 0; i < fillIds.size(); i++) {
      const line = api.GetLine(modelId, fillIds.get(i), false) as Record<string, unknown>;
      const relatingId = unwrapIfcRef(line.RelatingOpeningElement);
      const relatedId = unwrapIfcRef(line.RelatedBuildingElement);
      if (relatingId !== null && relatedId !== null) {
        results.push({ relationshipType: 'fills', relatingGuid: guidOf(relatingId), relatedGuid: guidOf(relatedId) });
      }
    }

    return results;
  }

  async getClassifications(api: WebIFC.IfcAPI, modelId: number, guidByExpressId: Map<number, string>): Promise<IfcClassificationInput[]> {
    const results: IfcClassificationInput[] = [];
    const relIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELASSOCIATESCLASSIFICATION);

    for (let i = 0; i < relIds.size(); i++) {
      try {
        const rel = api.GetLine(modelId, relIds.get(i), false) as Record<string, unknown>;
        const relatedIds = unwrapIfcRefList(rel.RelatedObjects);
        const classificationRefId = unwrapIfcRef(rel.RelatingClassification);
        if (classificationRefId === null) continue;

        const ref = api.GetLine(modelId, classificationRefId, true) as Record<string, unknown>;
        const code = (unwrapIfcValue(ref.Identification) as string) ?? undefined;
        const name = (unwrapIfcValue(ref.Name) as string) ?? undefined;
        const source = ref.ReferencedSource as Record<string, unknown> | null | undefined;
        const system = (source ? (unwrapIfcValue(source.Name) as string) : undefined) ?? name ?? 'Unclassified';

        for (const elementId of relatedIds) {
          const guid = guidByExpressId.get(elementId);
          if (guid) results.push({ elementGuid: guid, system, code, name });
        }
      } catch (error) {
        this.logger.warn(`Skipping malformed classification relationship: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return results;
  }

  // Extracts everything for ONE element: basic attrs, property sets,
  // quantities, and materials. Called per-element inside the batch loop —
  // never accumulated for the whole model at once.
  async extractElement(
    api: WebIFC.IfcAPI,
    modelId: number,
    skeleton: WalkResult['elementSkeletons'][number],
    spatialNodeGuidByElement: Map<number, string>,
  ): Promise<{ element: IfcElementInput; quantities: IfcQuantityInput[]; materials: IfcMaterialInput[]; elementMaterials: IfcElementMaterialInput[] }> {
    const { expressId, guid, ifcType } = skeleton;
    const quantities: IfcQuantityInput[] = [];
    const materials: IfcMaterialInput[] = [];
    const elementMaterials: IfcElementMaterialInput[] = [];
    const properties: Record<string, unknown> = {};

    try {
      const basic = api.GetLine(modelId, expressId, false) as Record<string, unknown>;
      properties.name = unwrapIfcValue(basic.Name);
      properties.description = unwrapIfcValue(basic.Description);
      properties.objectType = unwrapIfcValue(basic.ObjectType);
    } catch (error) {
      this.logger.warn(`Failed to read basic attributes for element ${guid} (${ifcType}): ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const psetLike = await api.properties.getPropertySets(modelId, expressId, true);
      for (const set of psetLike as Array<Record<string, unknown>>) {
        const setName = (unwrapIfcValue(set.Name) as string) ?? 'Unnamed';
        if (Array.isArray(set.Quantities)) {
          for (const q of set.Quantities as Array<Record<string, unknown>>) {
            const { quantityType, value } = extractQuantityValue(q);
            quantities.push({
              elementGuid: guid,
              quantitySet: setName,
              name: (unwrapIfcValue(q.Name) as string) ?? 'Unnamed',
              quantityType: quantityType ?? undefined,
              value: value ?? undefined,
            });
          }
        } else if (Array.isArray(set.HasProperties)) {
          for (const p of set.HasProperties as Array<Record<string, unknown>>) {
            const propName = (unwrapIfcValue(p.Name) as string) ?? 'Unnamed';
            properties[`${setName}.${propName}`] = unwrapIfcValue(p.NominalValue);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to read property/quantity sets for element ${guid} (${ifcType}): ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const matResults = await api.properties.getMaterialsProperties(modelId, expressId, true);
      for (const mat of matResults as Array<Record<string, unknown>>) {
        collectMaterialNames(mat).forEach((name) => {
          materials.push({ name, category: undefined });
          elementMaterials.push({ elementGuid: guid, materialName: name });
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to read materials for element ${guid} (${ifcType}): ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      element: {
        ifcGuid: guid,
        ifcType,
        ifcName: properties.name as string | undefined,
        ifcDescription: properties.description as string | undefined,
        spatialNodeGuid: spatialNodeGuidByElement.get(expressId),
        properties,
      },
      quantities,
      materials,
      elementMaterials,
    };
  }
}

// IfcRelAssociatesMaterial's RelatingMaterial can be a plain IfcMaterial, an
// IfcMaterialLayerSet(Usage), an IfcMaterialList, or an IfcMaterialProfileSet
// — this defensively pulls names out of whichever shape is present.
function collectMaterialNames(mat: Record<string, unknown>): string[] {
  const names: string[] = [];
  const direct = unwrapIfcValue(mat.Name);
  if (typeof direct === 'string') names.push(direct);

  const forLayerSet = mat.ForLayerSet as Record<string, unknown> | undefined;
  const layers = (forLayerSet?.MaterialLayers ?? mat.MaterialLayers) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      const layerMat = layer.Material as Record<string, unknown> | undefined;
      const layerName = layerMat ? unwrapIfcValue(layerMat.Name) : null;
      if (typeof layerName === 'string') names.push(layerName);
    }
  }

  if (Array.isArray(mat.Materials)) {
    for (const m of mat.Materials as Array<Record<string, unknown>>) {
      const n = unwrapIfcValue(m.Name);
      if (typeof n === 'string') names.push(n);
    }
  }

  return [...new Set(names)];
}
