import {
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionItemKind,
  CompletionItemProvider,
  CompletionList,
  Position,
  ProviderResult,
  Range,
  TextDocument,
} from "vscode";

import { fetchedDepsMap, getFetchedDependency } from "../core/listener";

import { RE_VERSION, findCrate, findCrateAndVersion } from "../toml/parser";

const alphabet = "abcdefghijklmnopqrstuvwxyz";
export function sortText(i: number): string {
  // This function generates an appropriate alphabetic sortText for the given number.
  const columns = Math.floor(i / alphabet.length);
  const letter = alphabet[i % alphabet.length];
  return "z".repeat(columns) + letter;
}

function sortFeaturesForCompletion(features: string[]): string[] {
  return [...features].sort((a, b) => {
    if (a === "default" && b !== "default") return -1;
    if (b === "default" && a !== "default") return 1;

    const aUnderscore = a.startsWith("_");
    const bUnderscore = b.startsWith("_");

    if (aUnderscore && !bUnderscore) return 1;
    if (!aUnderscore && bUnderscore) return -1;

    return a.localeCompare(b);
  });
}

function filterSelectedFeatures(candidates: string[], selected: string[]): string[] {
  const selectedSet = new Set(selected);
  return candidates.filter((feature) => !selectedSet.has(feature));
}

function extractSelectedFeatures(arrayText: string): string[] {
  const selected = new Set<string>();
  const regex = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(arrayText)) !== null) {
    selected.add(match[1]);
  }
  return [...selected];
}

function selectFeatureCandidates(params: {
  features?: string[];
  selected?: string[];
}): string[] {
  const {
    features = [],
    selected = [],
  } = params;

  const sorted = sortFeaturesForCompletion(features);
  return filterSelectedFeatures(sorted, selected);
}

export class VersionCompletions implements CompletionItemProvider {
  provideCompletionItems(
    document: TextDocument,
    position: Position,
    _token: CancellationToken,
    _context: CompletionContext
  ): ProviderResult<CompletionItem[] | CompletionList> {
    if (!fetchedDepsMap) return;

    const match = document
      .lineAt(position)
      .text.match(RE_VERSION);
    if (match) {
      const crate = match[1] === "version" ? findCrate(document, position.line) : match[1];
      if (!crate) return;

      const version = match[7] ?? match[5];

      const fetchedDep = getFetchedDependency(document, crate, position);
      if (!fetchedDep || !fetchedDep.versions) return;

      const versionStart = match[1].length + match[2].length + (match[3]?.length ?? 0) + 1;
      const versionEnd = versionStart + version.length;

      if (
        !new Range(
          new Position(position.line, versionStart),
          new Position(position.line, versionEnd)
        ).contains(position)
      )
        return;

      if (version.trim().length !== 0) {
        const filterVersion = version
          .substr(0, versionStart - position.character)
          .toLowerCase();

        const range = new Range(
          new Position(position.line, versionStart),
          new Position(position.line, versionEnd)
        );

        let i = 0;
        return new CompletionList(
          (filterVersion.length > 0
            ? fetchedDep.versions.filter((version) =>
              version.toLowerCase().startsWith(filterVersion)
            )
            : fetchedDep.versions
          ).map((version) => {
            const item = new CompletionItem(version, CompletionItemKind.Class);
            item.range = range;
            item.preselect = i === 0;
            item.sortText = sortText(i++);
            return item;
          }),
          true
        );
      } else if (position.character !== versionEnd + 1) {
        // Fixes the edge case where auto completion comes up for `version = ""|`
        return fetchedDep.versionCompletionItems;
      }
    }
  }
}

export class FeaturesCompletions implements CompletionItemProvider {
  private getTokenRange(document: TextDocument, position: Position): Range {
    const lineText = document.lineAt(position.line).text;
    let start = position.character;
    let end = position.character;

    while (start > 0 && /[A-Za-z0-9_-]/.test(lineText[start - 1])) {
      start--;
    }
    while (end < lineText.length && /[A-Za-z0-9_-]/.test(lineText[end])) {
      end++;
    }

    return new Range(new Position(position.line, start), new Position(position.line, end));
  }

  private isInsideQuote(document: TextDocument, position: Position): boolean {
    const lineText = document.lineAt(position.line).text.slice(0, position.character);
    const doubleQuotes = (lineText.match(/(?<!\\)"/g) ?? []).length;
    const singleQuotes = (lineText.match(/(?<!\\)'/g) ?? []).length;
    return doubleQuotes % 2 === 1 || singleQuotes % 2 === 1;
  }

  private findFeatureArrayContext(document: TextDocument, position: Position): { range: Range; selected: string[] } | undefined {
    const headerRegex = /^\s*\[.+\]\s*$/;
    const startRegex = /features\s*=\s*\[/;

    let startLine = -1;
    let startCharacter = -1;

    for (let line = position.line; line >= Math.max(0, position.line - 80); line--) {
      const text = document.lineAt(line).text;

      if (line !== position.line && headerRegex.test(text)) {
        break;
      }

      const startMatch = text.match(startRegex);
      if (startMatch) {
        startLine = line;
        startCharacter = startMatch.index! + startMatch[0].length;
        break;
      }
    }

    if (startLine < 0 || startCharacter < 0) return;

    let endLine = startLine;
    let endCharacter = -1;
    let fullArrayText = document.lineAt(startLine).text.slice(startCharacter);

    const sameLineEnd = fullArrayText.indexOf("]");
    if (sameLineEnd >= 0) {
      endCharacter = startCharacter + sameLineEnd;
      fullArrayText = fullArrayText.slice(0, sameLineEnd);
    } else {
      for (let line = startLine + 1; line < Math.min(document.lineCount, startLine + 120); line++) {
        const text = document.lineAt(line).text;
        const closeIdx = text.indexOf("]");
        if (closeIdx >= 0) {
          endLine = line;
          endCharacter = closeIdx;
          fullArrayText += "\n" + text.slice(0, closeIdx);
          break;
        }
        fullArrayText += "\n" + text;
      }
    }

    if (endCharacter < 0) return;

    const range = new Range(
      new Position(startLine, startCharacter),
      new Position(endLine, endCharacter)
    );
    if (!range.contains(position)) return;

    return {
      range,
      selected: extractSelectedFeatures(fullArrayText),
    };
  }

  provideCompletionItems(
    document: TextDocument,
    position: Position,
    _token: CancellationToken,
    _context: CompletionContext
  ): ProviderResult<CompletionItem[] | CompletionList> {
    if (!fetchedDepsMap) return;

    const context = this.findFeatureArrayContext(document, position);
    if (!context) return;

    let crate: string | undefined;
    const versionMatch = document.lineAt(position).text.match(RE_VERSION);
    if (versionMatch) {
      crate = versionMatch[1] === "version" ? findCrate(document, position.line + 1) : versionMatch[1];
    } else {
      const match = findCrateAndVersion(document, position.line);
      if (match) {
        [crate] = match;
      } else {
        crate = findCrate(document, position.line + 1);
      }
    }

    if (!crate) return;

    const fetchedDep = getFetchedDependency(document, crate, position);
    if (!fetchedDep || !fetchedDep.features) return;

    const candidates = selectFeatureCandidates({
      features: fetchedDep.features,
      selected: context.selected,
    });

    const tokenRange = this.getTokenRange(document, position);
    const insideQuote = this.isInsideQuote(document, position);

    let i = 0;
    return new CompletionList(
      candidates.map((candidate) => {
        const item = new CompletionItem(candidate, CompletionItemKind.Field);
        item.sortText = sortText(i++);
        item.range = tokenRange;
        item.insertText = insideQuote ? candidate : `"${candidate}"`;
        return item;
      }),
      true
    );
  }
}
