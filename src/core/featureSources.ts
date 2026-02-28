import path from "node:path";
import { promises as fs } from "node:fs";
import Item from "./Item";
import { parse } from "../toml/parser";

export const LOCAL_FEATURES_VERSION = "__local__";

export type FeatureSourceResult = {
    versions: string[];
    features: string[];
};

function toFeatureSourceResult(features: string[]): FeatureSourceResult {
    return {
        versions: [LOCAL_FEATURES_VERSION],
        features,
    };
}

export function parseManifestFeatureData(manifestContent: string): FeatureSourceResult {
    const parsed = parse(manifestContent);
    const featuresTable = parsed.values.find((item) => item.key === "features");

    if (!featuresTable) {
        return toFeatureSourceResult([]);
    }

    const features = featuresTable.values.map((featureItem) => {
        return featureItem.key;
    });

    return toFeatureSourceResult(features);
}

function resolveManifestPath(baseCargoTomlPath: string, relativeOrFilePath: string): string {
    const absPath = path.resolve(path.dirname(baseCargoTomlPath), relativeOrFilePath);
    if (path.basename(absPath).toLowerCase() === "cargo.toml") {
        return absPath;
    }
    return path.join(absPath, "Cargo.toml");
}

async function findWorkspaceCargo(startCargoTomlPath: string): Promise<string | undefined> {
    let currentDir = path.dirname(startCargoTomlPath);

    while (true) {
        const candidate = path.join(currentDir, "Cargo.toml");
        try {
            const content = await fs.readFile(candidate, "utf-8");
            const parsed = parse(content);
            const hasWorkspace = parsed.values.some((item) => item.key === "workspace" || item.key.startsWith("workspace."));
            if (hasWorkspace) {
                return candidate;
            }
        } catch {
            // ignore and continue walking upward
        }

        const parent = path.dirname(currentDir);
        if (parent === currentDir) return undefined;
        currentDir = parent;
    }
}

function findWorkspaceDependencyItem(workspaceManifestContent: string, crateName: string): Item | undefined {
    const parsed = parse(workspaceManifestContent);

    const direct = parsed.values.find((value) => value.key === `workspace.dependencies.${crateName}`);
    if (direct) return direct;

    const workspaceDepsTable = parsed.values.find((value) => value.key === "workspace.dependencies");
    if (!workspaceDepsTable) return undefined;

    return workspaceDepsTable.values.find((value) => value.key === crateName);
}

function extractPathFromInlineTable(inline: string): string | undefined {
    const match = inline.match(/path\s*=\s*["']([^"']+)["']/);
    return match?.[1];
}

function findWorkspaceDependencyPathByText(workspaceManifestContent: string, crateName: string): string | undefined {
    const lines = workspaceManifestContent.split(/\r?\n/);

    // [workspace.dependencies] with inline entries
    let inWorkspaceDependencies = false;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith("[") && line.endsWith("]")) {
            inWorkspaceDependencies = line === "[workspace.dependencies]";
            continue;
        }

        if (!inWorkspaceDependencies) continue;
        if (line.startsWith("#") || line.length === 0) continue;

        const inlineMatch = line.match(new RegExp(`^${crateName}\\s*=\\s*\\{(.+)\\}$`));
        if (inlineMatch) {
            const parsedPath = extractPathFromInlineTable(inlineMatch[1]);
            if (parsedPath) return parsedPath;
        }
    }

    // [workspace.dependencies.<crate>] table form
    const tableHeader = `[workspace.dependencies.${crateName}]`;
    let inCrateTable = false;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith("[") && line.endsWith("]")) {
            inCrateTable = line === tableHeader;
            continue;
        }

        if (!inCrateTable) continue;
        if (line.startsWith("#") || line.length === 0) continue;

        const pathMatch = line.match(/^path\s*=\s*["']([^"']+)["']/);
        if (pathMatch) return pathMatch[1];
    }

    return undefined;
}

function readDependencyPath(item: Item | undefined): string | undefined {
    if (!item) return undefined;

    if (item.values.length > 0) {
        return item.values.find((value) => value.key === "path")?.value;
    }

    return undefined;
}

export async function resolveFeaturesForDependency(
    dependency: Item,
    currentCargoTomlPath: string
): Promise<FeatureSourceResult | undefined> {
    try {
        let targetManifestPath: string | undefined;

        if (dependency.path) {
            targetManifestPath = resolveManifestPath(currentCargoTomlPath, dependency.path);
        } else if (dependency.workspace === true) {
            const workspaceCargo = await findWorkspaceCargo(currentCargoTomlPath);
            if (!workspaceCargo) return undefined;

            const workspaceContent = await fs.readFile(workspaceCargo, "utf-8");
            const workspaceDepItem = findWorkspaceDependencyItem(workspaceContent, dependency.key);
            const workspaceDepPath = readDependencyPath(workspaceDepItem) ?? findWorkspaceDependencyPathByText(workspaceContent, dependency.key);
            if (!workspaceDepPath) return undefined;

            targetManifestPath = resolveManifestPath(workspaceCargo, workspaceDepPath);
        }

        if (!targetManifestPath) return undefined;

        const targetContent = await fs.readFile(targetManifestPath, "utf-8");
        return parseManifestFeatureData(targetContent);
    } catch {
        return undefined;
    }
}
