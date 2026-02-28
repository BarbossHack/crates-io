import * as https from 'https';
import * as http from 'http';
import { CrateMetadatas } from './crateMetadatas';
import NodeCache from "node-cache";
import { maxSatisfying, prerelease } from "semver";

export const sparseIndexServerURL = "https://index.crates.io";
const cache = new NodeCache({ stdTTL: 60 * 10 });

function normalizeVersionRequirement(versionRequirement?: string): string | undefined {
  if (!versionRequirement) return undefined;
  const trimmed = versionRequirement.trim();
  if (trimmed.length === 0) return undefined;
  const prefix = trimmed.charCodeAt(0);
  if (prefix > 47 && prefix < 58) return "^" + trimmed;
  return trimmed;
}

function extractFeaturesFromEntry(entry: any): string[] {
  const merged = {
    ...(entry.features ?? {}),
    ...(entry.features2 ?? {}),
  };
  return Object.keys(merged);
}

export function buildCrateMetadatasFromSparseLines(
  name: string,
  lines: string[],
  versionRequirement?: string,
  shouldListPreRels: boolean = false
): CrateMetadatas {
  const bodyArray: any[] = [];
  for (const line of lines) {
    bodyArray.push(JSON.parse(line));
  }

  const nonYanked = bodyArray.filter((e: any) => e.yanked === false);
  const allVersions = nonYanked.map((e: any) => e.vers);

  const candidateVersions = shouldListPreRels
    ? allVersions
    : allVersions.filter((version) => !prerelease(version));

  const normalizedRequirement = normalizeVersionRequirement(versionRequirement);
  let resolvedVersion: string | null = null;
  const prereleaseOptions = shouldListPreRels ? { includePrerelease: true } : undefined;
  if (normalizedRequirement) {
    resolvedVersion = maxSatisfying(candidateVersions, normalizedRequirement, prereleaseOptions);
    if (!resolvedVersion) {
      resolvedVersion = maxSatisfying(allVersions, normalizedRequirement, { includePrerelease: true });
    }
  } else {
    resolvedVersion = maxSatisfying(candidateVersions, "*", prereleaseOptions);
    if (!resolvedVersion && shouldListPreRels) {
      resolvedVersion = maxSatisfying(allVersions, "*", { includePrerelease: true });
    }
  }

  const resolvedEntry = resolvedVersion
    ? nonYanked.find((entry: any) => entry.vers === resolvedVersion)
    : undefined;

  const features = resolvedEntry ? extractFeaturesFromEntry(resolvedEntry) : [];

  return {
    name,
    versions: allVersions,
    features,
  };
}

export const versions = (
  name: string,
  indexServerURL?: string,
  registryToken?: string,
  versionRequirement?: string,
  shouldListPreRels: boolean = false
) => {
  // clean dirty names
  name = name.replace(/"/g, "");
  const cacheKey = `${name}::${versionRequirement ?? ""}::${shouldListPreRels ? "pre" : "stable"}`;

  return new Promise<CrateMetadatas>(function (resolve, reject) {
    const cached = cache.get<CrateMetadatas>(cacheKey);
    if (cached) {
      resolve(cached);
      return;
    }
    // compute sparse index prefix
    var prefix;
    var lower_name = name.toLowerCase();
    if (lower_name.length <= 2) {
      prefix = lower_name.length;
    } else if (lower_name.length == 3) {
      prefix = "3/" + lower_name.substring(0, 1);
    } else {
      prefix = lower_name.substring(0, 2) + "/" + lower_name.substring(2, 4);
    }

    // This could happen if crate have an alternate registry, but index was not found.
    // We should not default on sparse index in this case, juste ignore this crate fetch.
    if (indexServerURL === undefined) return;

    // Add a trailing '/', and parse as `URL()`
    let indexServerURLParsed: URL = new URL(`${indexServerURL.replace(/\/$/, "")}/`)
    let options = {
      hostname: indexServerURLParsed.hostname,
      port: indexServerURLParsed.port,
      path: `${indexServerURLParsed.pathname}${prefix}/${lower_name}`,
      headers: {}
    }
    if (registryToken !== undefined) {
      options.headers = {
        Authorization: registryToken
      }
    }
    const requests = indexServerURLParsed.protocol == "https:" ? https : http;
    var req = requests.get(options, function (res) {
      // reject on bad status
      if (!res.statusCode) {
        reject(new Error('statusCode=' + res.statusCode));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error('statusCode=' + res.statusCode));
      }
      // cumulate data
      var crate_metadatas: CrateMetadatas;
      var body: any = [];
      res.on('data', function (chunk) {
        body.push(chunk);
      });
      // resolve on end
      res.on('end', function () {
        try {
          var body_lines = Buffer.concat(body).toString().split('\n').filter(n => n);
          crate_metadatas = buildCrateMetadatasFromSparseLines(name, body_lines, versionRequirement, shouldListPreRels);
          cache.set(cacheKey, crate_metadatas);
        } catch (e) {
          reject(e);
        }
        resolve(crate_metadatas);
      });
    });
    // reject on request error
    req.on('error', function (err) {
      // This is not a "Second reject", just a different sort of failure
      reject(err);
    });
    // IMPORTANT
    req.end();
  });
};
