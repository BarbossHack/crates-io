import {
    Diagnostic,
    DiagnosticCollection,
    DiagnosticSeverity,
    Position,
    Range,
    TextDocument,
    Uri,
    languages,
} from "vscode";
import Dependency from "../core/Dependency";

const DEP_TABLE_HEADER = /^\s*\[(?:.+\.)?(?:dev-)?dependencies(?:\.([^.\]]+))?\]\s*$/;
const INLINE_DEP = /^\s*([^\s=]+)\s*=\s*\{(.+)\}\s*$/;

export const featureDiagnosticsCollection: DiagnosticCollection =
    languages.createDiagnosticCollection("crates-io-features");

function extractSelectedFeatures(arrayText: string): string[] {
    const matches = arrayText.matchAll(/["']([^"']+)["']/g);
    return [...new Set(Array.from(matches, (match) => match[1]))];
}

type FeatureUsage = {
    crate: string;
    version?: string;
    selected: string[];
    range: Range;
};

function collectArrayTextUntilClose(document: TextDocument, line: number, startIdx: number): {
    arrayText: string;
    endLine: number;
    endChar: number;
} | undefined {
    let arrayText = document.lineAt(line).text.slice(startIdx);
    const sameLineClose = arrayText.indexOf("]");
    if (sameLineClose >= 0) {
        return {
            arrayText: arrayText.slice(0, sameLineClose),
            endLine: line,
            endChar: startIdx + sameLineClose,
        };
    }

    for (let i = line + 1; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        const closeIdx = text.indexOf("]");
        if (closeIdx >= 0) {
            return {
                arrayText: arrayText + "\n" + text.slice(0, closeIdx),
                endLine: i,
                endChar: closeIdx,
            };
        }
        arrayText += "\n" + text;
    }

    return undefined;
}

function collectFeatureUsages(document: TextDocument): FeatureUsage[] {
    const usages: FeatureUsage[] = [];
    let currentTableCrate: string | undefined;
    let currentTableVersion: string | undefined;

    for (let line = 0; line < document.lineCount; line++) {
        const text = document.lineAt(line).text;

        const tableHeader = text.match(DEP_TABLE_HEADER);
        if (tableHeader) {
            currentTableCrate = tableHeader[1];
            currentTableVersion = undefined;
            continue;
        }

        if (/^\s*\[.+\]\s*$/.test(text)) {
            currentTableCrate = undefined;
            currentTableVersion = undefined;
            continue;
        }

        const inlineDep = text.match(INLINE_DEP);
        if (inlineDep) {
            const crate = inlineDep[1].replace(/^"|"$/g, "");
            const body = inlineDep[2];
            const featuresMatch = body.match(/features\s*=\s*\[(.*?)\]/);
            if (featuresMatch) {
                const versionMatch = body.match(/version\s*=\s*["']([^"']+)["']/);
                usages.push({
                    crate,
                    version: versionMatch?.[1],
                    selected: extractSelectedFeatures(featuresMatch[1]),
                    range: new Range(new Position(line, 0), new Position(line, text.length)),
                });
            }
            continue;
        }

        if (currentTableCrate) {
            const versionMatch = text.match(/^\s*version\s*=\s*["']([^"']+)["']/);
            if (versionMatch) {
                currentTableVersion = versionMatch[1];
            }

            const featuresStartMatch = text.match(/^\s*features\s*=\s*\[/);
            if (featuresStartMatch) {
                const start = featuresStartMatch.index! + featuresStartMatch[0].length;
                const arrayData = collectArrayTextUntilClose(document, line, start);
                if (!arrayData) continue;

                usages.push({
                    crate: currentTableCrate,
                    version: currentTableVersion,
                    selected: extractSelectedFeatures(arrayData.arrayText),
                    range: new Range(new Position(line, 0), new Position(arrayData.endLine, arrayData.endChar)),
                });

                line = arrayData.endLine;
            }
        }
    }

    return usages;
}

function findDependencyForCrate(
    document: TextDocument,
    fetchedDepsMap: Map<string, Dependency[]>,
    crate: string,
    usageOffset: number
): Dependency | undefined {
    const deps = fetchedDepsMap.get(crate);
    if (!deps || deps.length === 0) return undefined;
    if (deps.length === 1) return deps[0];

    for (const dep of deps) {
        const depRange = new Range(
            document.positionAt(dep.item.start),
            document.positionAt(dep.item.end)
        );
        if (depRange.contains(document.positionAt(usageOffset))) {
            return dep;
        }
    }

    return deps[0];
}

function resolveAvailableFeatures(dep: Dependency): string[] {
    return dep.features ?? [];
}

export function findUnknownFeatures(selected: string[], available: string[]): string[] {
    const availableSet = new Set(available);
    return selected.filter((feature) => !availableSet.has(feature));
}

export function updateFeatureDiagnostics(
    document: TextDocument,
    fetchedDepsMap: Map<string, Dependency[]>
): void {
    const diagnostics: Diagnostic[] = [];
    const usages = collectFeatureUsages(document);

    usages.forEach((usage) => {
        const usageOffset = document.offsetAt(usage.range.start);
        const dep = findDependencyForCrate(document, fetchedDepsMap, usage.crate, usageOffset);
        if (!dep) return;
        if (dep.error) return;

        const available = resolveAvailableFeatures(dep);
        const unknown = findUnknownFeatures(usage.selected, available);

        if (unknown.length > 0) {
            diagnostics.push(
                new Diagnostic(
                    usage.range,
                    `Unknown feature(s) for ${usage.crate}: ${unknown.join(", ")}`,
                    DiagnosticSeverity.Warning
                )
            );
        }
    });

    featureDiagnosticsCollection.set(document.uri as Uri, diagnostics);
}
