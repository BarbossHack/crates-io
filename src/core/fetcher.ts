import Item from "./Item";
import Dependency from "./Dependency";
import { StatusBar } from "../ui/status-bar";
import {
  sparseIndexServerURL,
  versions as sparseVersions
} from "../api/sparse-index-server";
import compareVersions from "../semver/compareVersions";
import { CompletionItem, CompletionItemKind, CompletionList, workspace } from "vscode";
import { sortText } from "../providers/autoCompletion";
import { CrateMetadatas } from "../api/crateMetadatas";
import { AlternateRegistry } from "./AlternateRegistry";
import { prerelease } from "semver";
import { isLocalFeatureSourceDependency, resolveFeaturesForDependency } from "./featureSources";

export async function fetchCrateVersions(
  dependencies: Item[],
  alternateRegistries?: AlternateRegistry[],
  cargoTomlPath?: string
): Promise<[Promise<Dependency[]>, Map<string, Dependency[]>]> {
  // load config
  const config = workspace.getConfiguration("");
  const shouldListPreRels = !!config.get("crates.listPreReleases");
  var indexServerURL = config.get<string>("crates.indexServerURL") ?? sparseIndexServerURL;

  StatusBar.setText("Loading", "👀 Fetching " + indexServerURL.replace(/^https?:\/\//, ''));

  let transformer = transformServerResponse(sparseVersions, shouldListPreRels, indexServerURL, alternateRegistries, cargoTomlPath);
  const responses = dependencies.map(transformer);
  const resolvedResponses = await Promise.all(responses);
  const responsesMap = indexDependenciesByKey(resolvedResponses);
  return [Promise.resolve(resolvedResponses), responsesMap];
}

export function indexDependenciesByKey(dependencies: Dependency[]): Map<string, Dependency[]> {
  const map: Map<string, Dependency[]> = new Map();

  dependencies.forEach((dependency) => {
    const key = dependency.item.key;
    const existing = map.get(key) ?? [];
    existing.push(dependency);
    map.set(key, existing);
  });

  return map;
}


function transformServerResponse(
  versions: (
    name: string,
    indexServerURL?: string,
    registryToken?: string,
    versionRequirement?: string,
    shouldListPreRels?: boolean
  ) => Promise<CrateMetadatas>,
  shouldListPreRels: boolean,
  indexServerURL: string,
  alternateRegistries?: AlternateRegistry[],
  cargoTomlPath?: string
): (i: Item) => Promise<Dependency> {
  return async function (item: Item): Promise<Dependency> {
    if (cargoTomlPath && isLocalFeatureSourceDependency(item)) {
      const localFeatures = await resolveFeaturesForDependency(item, cargoTomlPath);
      if (localFeatures) {
        return {
          item,
          versions: localFeatures.versions,
          features: localFeatures.features,
          versionCompletionItems: new CompletionList([], true),
        };
      }
    }

    // Use the sparse index if (and only if) the crate does not use an alternate registry
    const alternateRegistry = alternateRegistries?.find((registry) => item.registry == registry.name);
    var thisCrateRegistry = item.registry !== undefined ? alternateRegistry?.index : indexServerURL;
    var thisCrateToken = item.registry !== undefined ? alternateRegistry?.token : undefined;
    return versions(item.key, thisCrateRegistry, thisCrateToken, item.value, shouldListPreRels).then((crate: any) => {
      const versions = crate.versions.reduce((result: any[], item: string) => {
        const isPreRelease = !shouldListPreRels && prerelease(item);
        if (!isPreRelease)
          result.push(item);
        return result;
      }, [])
        .sort(compareVersions)
        .reverse();

      let i = 0;
      const versionCompletionItems = new CompletionList(
        versions.map((version: string) => {
          const completionItem = new CompletionItem(
            version,
            CompletionItemKind.Class
          );
          completionItem.preselect = i === 0;
          completionItem.sortText = sortText(i++);
          return completionItem;
        }),
        true
      );

      return {
        item,
        versions,
        features: crate.features,
        versionCompletionItems,
      };
    }).catch((error: Error) => {
      console.error(error);
      return {
        item,
        error: item.key + ": " + error,
      };
    });
  };
};