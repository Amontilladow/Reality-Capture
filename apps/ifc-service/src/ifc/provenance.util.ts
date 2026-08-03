import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface FileDigest {
  sha256: string;
  sizeBytes: number;
}

export function digest(bytes: Uint8Array): FileDigest {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  };
}

export interface GenerationVersions {
  nodeVersion: string;
  fragmentsVersion: string;
  webIfcVersion: string;
  gitCommit: string | null;
}

// require(`${pkgName}/package.json`) would be simpler, but both
// @thatopen/fragments and web-ifc restrict their `exports` field to not
// include package.json, so that throws ERR_PACKAGE_PATH_NOT_EXPORTED.
// Walking require.resolve.paths() and reading the file directly sidesteps
// the exports gate (which only governs subpath imports of the package,
// not fs access to a file we've located ourselves).
function readInstalledVersion(pkgName: string): string {
  const dirs = require.resolve.paths(pkgName) ?? [];
  const dir = dirs.find((p) => fs.existsSync(path.join(p, pkgName, 'package.json')));
  if (!dir) throw new Error(`Could not resolve installed version of ${pkgName}`);
  const pkgJson = JSON.parse(fs.readFileSync(path.join(dir, pkgName, 'package.json'), 'utf-8')) as { version: string };
  return pkgJson.version;
}

// Reads installed package versions at runtime rather than hardcoding them,
// so this can never silently drift from what pnpm-lock.yaml actually
// resolved. RENDER_GIT_COMMIT is the closest available substitute for a
// Docker image digest from inside the running container -- Render sets it
// automatically to the commit the current deploy was built from.
export function captureGenerationVersions(): GenerationVersions {
  return {
    nodeVersion: process.version,
    fragmentsVersion: readInstalledVersion('@thatopen/fragments'),
    webIfcVersion: readInstalledVersion('web-ifc'),
    gitCommit: process.env.RENDER_GIT_COMMIT ?? null,
  };
}
