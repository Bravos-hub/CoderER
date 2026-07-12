import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { InvestigationCitation, PatchFile, PatchHunk } from '@codeer/contracts';

export interface ParsedPatch {
  files: PatchFile[];
  changedFiles: number;
  addedLines: number;
  deletedLines: number;
  patchDigest: string;
}

export interface PatchProvenance {
  treatmentPlanStep: number;
  citations: InvestigationCitation[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;
const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;

function normalizePatchPath(value: string): string {
  const candidate = value.replace(/^"|"$/g, '').replace(/\\/g, '/');
  if (!candidate || candidate === '/dev/null') return candidate;
  if (candidate.includes('\0') || candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate)) {
    throw new Error('Patch contains an absolute or invalid path.');
  }
  const normalized = path.posix.normalize(candidate);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Patch path traversal is not allowed.');
  }
  if (normalized.startsWith('.git/') || normalized === '.git') {
    throw new Error('Patches may not modify Git metadata.');
  }
  return normalized;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseUnifiedDiff(
  unifiedDiff: string,
  provenanceByFile: Readonly<Record<string, PatchProvenance>>,
): ParsedPatch {
  if (!unifiedDiff.trim()) throw new Error('Patch must not be empty.');
  if (unifiedDiff.includes('GIT binary patch') || unifiedDiff.includes('Binary files ')) {
    throw new Error('Binary patches are not allowed.');
  }
  if (unifiedDiff.includes('\u0000')) throw new Error('Patch contains binary data.');

  const lines = unifiedDiff.replace(/\r\n/g, '\n').split('\n');
  const files: PatchFile[] = [];
  let index = 0;
  let totalAdded = 0;
  let totalDeleted = 0;

  while (index < lines.length) {
    const header = lines[index] ?? '';
    if (!header) {
      index += 1;
      continue;
    }
    const match = DIFF_HEADER.exec(header);
    if (!match)
      throw new Error(`Unexpected patch line outside file section: ${header.slice(0, 120)}`);
    const headerOld = normalizePatchPath(match[1] ?? '');
    const headerNew = normalizePatchPath(match[2] ?? '');
    index += 1;

    let oldPath: string | null = headerOld;
    let newPath: string | null = headerNew;
    let newFile = false;
    let deletedFile = false;
    let renameFrom: string | null = null;
    let renameTo: string | null = null;

    while (
      index < lines.length &&
      !(lines[index] ?? '').startsWith('@@ ') &&
      !(lines[index] ?? '').startsWith('diff --git ')
    ) {
      const line = lines[index] ?? '';
      if (line.startsWith('new file mode ')) newFile = true;
      if (line.startsWith('deleted file mode ')) deletedFile = true;
      if (line.startsWith('rename from ')) renameFrom = normalizePatchPath(line.slice(12));
      if (line.startsWith('rename to ')) renameTo = normalizePatchPath(line.slice(10));
      if (line.startsWith('--- ')) {
        const value = line.slice(4).replace(/^a\//, '');
        oldPath = value === '/dev/null' ? null : normalizePatchPath(value);
      }
      if (line.startsWith('+++ ')) {
        const value = line.slice(4).replace(/^b\//, '');
        newPath = value === '/dev/null' ? null : normalizePatchPath(value);
      }
      index += 1;
    }

    if (renameFrom) oldPath = renameFrom;
    if (renameTo) newPath = renameTo;
    if (newFile) oldPath = null;
    if (deletedFile) newPath = null;
    const effectivePath = newPath ?? oldPath;
    if (!effectivePath) throw new Error('Patch file section has no usable path.');
    const provenance = provenanceByFile[effectivePath];
    if (!provenance || provenance.citations.length === 0) {
      throw new Error(`Patch file lacks treatment-plan provenance: ${effectivePath}`);
    }

    const fileId = randomUUID();
    const hunks: PatchHunk[] = [];
    let fileAdded = 0;
    let fileDeleted = 0;
    let hunkSequence = 0;

    while (index < lines.length && !(lines[index] ?? '').startsWith('diff --git ')) {
      const hunkHeader = lines[index] ?? '';
      if (!hunkHeader) {
        index += 1;
        continue;
      }
      const hunkMatch = HUNK_HEADER.exec(hunkHeader);
      if (!hunkMatch) throw new Error(`Malformed hunk header: ${hunkHeader.slice(0, 200)}`);
      const oldStart = Number(hunkMatch[1]);
      const oldLines = Number(hunkMatch[2] ?? 1);
      const newStart = Number(hunkMatch[3]);
      const newLines = Number(hunkMatch[4] ?? 1);
      const contentLines = [hunkHeader];
      let observedOld = 0;
      let observedNew = 0;
      let added = 0;
      let deleted = 0;
      index += 1;

      while (
        index < lines.length &&
        !(lines[index] ?? '').startsWith('@@ ') &&
        !(lines[index] ?? '').startsWith('diff --git ')
      ) {
        const line = lines[index] ?? '';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          observedNew += 1;
          added += 1;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          observedOld += 1;
          deleted += 1;
        } else if (line.startsWith(' ')) {
          observedOld += 1;
          observedNew += 1;
        } else if (line === '\\ No newline at end of file' || line === '') {
          // Empty line is a valid context line only when prefixed. A trailing split entry is ignored.
          if (line === '' && index === lines.length - 1) {
            index += 1;
            break;
          }
        } else {
          throw new Error(`Invalid hunk content line: ${line.slice(0, 120)}`);
        }
        contentLines.push(line);
        index += 1;
      }

      if (observedOld !== oldLines || observedNew !== newLines) {
        throw new Error(`Hunk line counts do not match header for ${effectivePath}.`);
      }
      hunkSequence += 1;
      fileAdded += added;
      fileDeleted += deleted;
      const content = contentLines.join('\n');
      hunks.push({
        id: randomUUID(),
        fileId,
        sequence: hunkSequence,
        oldStart,
        oldLines,
        newStart,
        newLines,
        header: hunkHeader,
        content,
        addedLines: added,
        deletedLines: deleted,
        treatmentPlanStep: provenance.treatmentPlanStep,
        evidenceCitations: provenance.citations,
        contentHash: digest(content),
      });
    }

    if (hunks.length === 0 && !renameFrom) {
      throw new Error(`Patch file has no hunks: ${effectivePath}`);
    }
    const changeType =
      oldPath === null ? 'ADD' : newPath === null ? 'DELETE' : renameFrom ? 'RENAME' : 'MODIFY';
    files.push({
      id: fileId,
      patchId: randomUUID(),
      oldPath,
      newPath,
      changeType,
      oldDigest: null,
      newDigest: null,
      addedLines: fileAdded,
      deletedLines: fileDeleted,
      binary: false,
      generated: false,
      sensitive: false,
      hunks,
    });
    totalAdded += fileAdded;
    totalDeleted += fileDeleted;
  }

  if (files.length === 0) throw new Error('Patch contains no file changes.');
  return {
    files,
    changedFiles: files.length,
    addedLines: totalAdded,
    deletedLines: totalDeleted,
    patchDigest: digest(unifiedDiff.replace(/\r\n/g, '\n')),
  };
}
