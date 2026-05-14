import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const xlsxDir = path.join(rootDir, 'xlsx');
const imagesDir = path.join(rootDir, 'images');
const dataDir = path.join(rootDir, 'data');
const outputFile = path.join(dataDir, 'index.json');

const warnings = [];

function warn(message) {
  warnings.push(message);
  console.warn(`WARN ${message}`);
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return normalize(value).toLowerCase();
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseAttributes(fragment) {
  const attrs = {};
  const attrRe = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(fragment))) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function extractText(fragment) {
  const texts = [];
  const textRe = /<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let match;
  while ((match = textRe.exec(fragment))) {
    texts.push(decodeXml(match[1]));
  }
  return texts.join('');
}

function parseSharedStrings(xml) {
  const shared = [];
  const siRe = /<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si>/g;
  let match;
  while ((match = siRe.exec(xml))) {
    shared.push(extractText(match[0]));
  }
  return shared;
}

function colToIndex(ref) {
  const letters = String(ref ?? '').match(/[A-Z]+/i)?.[0] ?? '';
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index > 0 ? index - 1 : -1;
}

function cellText(cellXml, sharedStrings) {
  const attrsMatch = cellXml.match(/^<(?:\w+:)?c\b([^>]*)>/);
  const attrs = attrsMatch ? parseAttributes(attrsMatch[1]) : {};
  const type = attrs.t || '';
  const value = cellXml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? '';

  if (type === 's') {
    return sharedStrings[Number.parseInt(decodeXml(value), 10)] ?? '';
  }
  if (type === 'inlineStr') {
    return extractText(cellXml);
  }
  if (type === 'str') {
    return decodeXml(value);
  }
  if (value) {
    return decodeXml(value);
  }
  const inline = cellXml.match(/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/)?.[1];
  return inline ? extractText(inline) : '';
}

function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowAttrs = parseAttributes(rowMatch[1]);
    const rowIndex = Number.parseInt(rowAttrs.r || String(rows.length + 1), 10);
    const rowXml = rowMatch[2];
    const cells = [];
    const cellRe = /<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowXml))) {
      const cellAttrs = parseAttributes(cellMatch[1]);
      const index = colToIndex(cellAttrs.r || '');
      if (index >= 0) {
        cells[index] = cellText(`<c${cellMatch[1]}>${cellMatch[2]}</c>`, sharedStrings);
      }
    }
    rows.push({ rowIndex, cells });
  }
  return rows;
}

function parseWorkbookXml(extractedDir) {
  const workbookXml = fs.readFileSync(path.join(extractedDir, 'xl', 'workbook.xml'), 'utf8');
  const workbookRelsPath = path.join(extractedDir, 'xl', '_rels', 'workbook.xml.rels');
  const sharedStringsPath = path.join(extractedDir, 'xl', 'sharedStrings.xml');
  const workbookRels = fs.existsSync(workbookRelsPath) ? fs.readFileSync(workbookRelsPath, 'utf8') : '';
  const sharedStrings = fs.existsSync(sharedStringsPath) ? parseSharedStrings(fs.readFileSync(sharedStringsPath, 'utf8')) : [];

  const relMap = new Map();
  for (const match of workbookRels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = parseAttributes(match[1]);
    if (attrs.Id && attrs.Target) {
      relMap.set(attrs.Id, attrs.Target);
    }
  }

  const sheets = [];
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/>/g)) {
    const attrs = parseAttributes(match[1]);
    const relId = attrs['r:id'];
    const target = relId ? relMap.get(relId) : '';
    if (!attrs.name || !target) {
      continue;
    }
    const normalizedTarget = target.replace(/^\/+/, '');
    const resolvedPath = normalizedTarget.startsWith('xl/')
      ? path.join(extractedDir, normalizedTarget)
      : path.join(extractedDir, 'xl', normalizedTarget);
    sheets.push({
      name: attrs.name,
      path: resolvedPath,
    });
  }

  return { sharedStrings, sheets };
}

function extractWorkbook(xlsxPath, destDir) {
  const source = String(xlsxPath).replace(/'/g, "''");
  const dest = String(destDir).replace(/'/g, "''");
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${source}', '${dest}')`,
    ],
    { stdio: 'ignore' },
  );
}

function scanImages(imageRoot) {
  const groups = new Map();
  const allFiles = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (!entry.isFile() || !/\.(png|jpe?g|gif|webp)$/i.test(entry.name)) {
        continue;
      }

      const rel = path.relative(rootDir, absPath).split(path.sep).join('/');
      const stem = path.parse(entry.name).name;
      const match = stem.match(/^([a-zA-Z])-(\d+)(?:-\d+)?/);
      const group = match?.[1]?.toLowerCase() ?? path.basename(dir).toLowerCase();
      const number = match ? Number.parseInt(match[2], 10) : null;

      const record = { absPath, relPath: rel, fileName: entry.name, stem, group, number };
      allFiles.push(record);
      if (number !== null) {
        const key = `${group}-${number}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(record);
      }
    }
  }

  walk(imageRoot);
  for (const list of groups.values()) {
    list.sort((a, b) => a.relPath.localeCompare(b.relPath, 'en', { numeric: true, sensitivity: 'base' }));
  }
  allFiles.sort((a, b) => a.relPath.localeCompare(b.relPath, 'en', { numeric: true, sensitivity: 'base' }));
  return { groups, allFiles };
}

function splitRows(rows) {
  if (!rows.length) return { headerRow: null, dataRows: [] };
  return { headerRow: rows[0], dataRows: rows.slice(1) };
}

function rowToArray(row) {
  if (!row) return [];
  const maxIndex = row.cells.reduce((max, value, index) => (value !== undefined ? Math.max(max, index) : max), -1);
  const out = [];
  for (let i = 0; i <= maxIndex; i += 1) {
    out[i] = normalize(row.cells[i] ?? '');
  }
  return out;
}

function findIndexByPattern(values, patterns) {
  for (let i = 0; i < values.length; i += 1) {
    const value = normalizeHeader(values[i]);
    if (patterns.some((pattern) => pattern.test(value))) {
      return i;
    }
  }
  return null;
}

function inferColumns(headerValues, firstDataRow, group) {
  const numberIndex = findIndexByPattern(headerValues, [/^번호$/, /^no\.?$/, /^id$/])
    ?? ((normalize(firstDataRow?.cells?.[0] ?? '')).match(/^([a-zA-Z]-\d+)/) ? 0 : null);
  let titleIndex = findIndexByPattern(headerValues, [/^제목$/, /^title$/]);
  let descIndex = findIndexByPattern(headerValues, [/설명/, /description/, /note/, /메모/]);

  if (titleIndex === null) {
    if (numberIndex === 0 && headerValues.length > 1) {
      titleIndex = 1;
    } else {
      titleIndex = headerValues.findIndex((value, index) => index !== numberIndex && normalize(value));
      if (titleIndex < 0) {
        titleIndex = numberIndex === 0 ? 1 : 0;
      }
    }
  }

  if (descIndex === null) {
    descIndex = headerValues.findIndex((value, index) => index !== numberIndex && index !== titleIndex && normalize(value));
    if (descIndex < 0) {
      descIndex = Math.max(titleIndex + 1, 1);
    }
  }

  return { numberIndex, titleIndex, descIndex };
}

function parseId(value, group, fallbackSequence) {
  const text = normalize(value);
  const match = text.match(/^([a-zA-Z])-(\d+)(?:-\d+)?$/);
  if (match) {
    const number = Number.parseInt(match[2], 10);
    return { id: `${match[1].toLowerCase()}-${number}`, group: match[1].toLowerCase(), number };
  }
  if (text) {
    const numeric = Number.parseInt(text, 10);
    if (Number.isFinite(numeric)) {
      return { id: `${group}-${numeric}`, group, number: numeric };
    }
  }
  return { id: `${group}-${fallbackSequence}`, group, number: fallbackSequence };
}

function buildSearchText(parts) {
  return parts
    .flatMap((part) => normalize(part).split(/\s+/g))
    .filter(Boolean)
    .join(' ');
}

function isMemoSheet(sheetName) {
  return /메모|memo/i.test(sheetName);
}

function buildItem({
  group,
  sourceFile,
  sheetName,
  row,
  rowIndex,
  numberIndex,
  titleIndex,
  descIndex,
  fallbackSequence,
  workbookContextText,
  imageGroups,
}) {
  const rawNumber = numberIndex === null ? '' : row.cells[numberIndex];
  const rawTitle = row.cells[titleIndex] ?? '';
  const rawDesc = row.cells[descIndex] ?? '';
  const parsed = parseId(rawNumber, group, fallbackSequence);
  const relatedImages = imageGroups.get(parsed.id) ?? [];
  const imagePaths = relatedImages.map((image) => image.relPath);

  if (!imagePaths.length) {
    warn(`[${sourceFile} / ${sheetName}] missing image match for ${parsed.id} (row ${rowIndex})`);
  }

  return {
    id: parsed.id,
    group: parsed.group,
    number: parsed.number,
    title: normalize(rawTitle) || parsed.id,
    description: normalize(rawDesc),
    imagePaths,
    primaryImagePath: imagePaths[0] ?? '',
    sheetName,
    sourceFile,
    searchText: buildSearchText([
      parsed.id,
      parsed.group,
      parsed.number,
      rawTitle,
      rawDesc,
      sourceFile,
      sheetName,
      workbookContextText,
      ...imagePaths,
      ...relatedImages.map((image) => image.stem),
    ]),
  };
}

async function buildIndex() {
  await fsp.mkdir(dataDir, { recursive: true });

  const workbookFiles = (await fsp.readdir(xlsxDir))
    .filter((name) => /\.xlsx$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));

  const { groups: imageGroups, allFiles: imageFiles } = scanImages(imagesDir);
  const collectedItems = [];

  for (const workbookFile of workbookFiles) {
    const group = path.parse(workbookFile).name.toLowerCase();
    const sourceFile = path.join('xlsx', workbookFile).split(path.sep).join('/');
    const extractedDir = await fsp.mkdtemp(path.join(os.tmpdir(), `find-index-${group}-`));

    try {
      extractWorkbook(path.join(xlsxDir, workbookFile), extractedDir);
      const { sharedStrings, sheets } = parseWorkbookXml(extractedDir);
      const sheetPayloads = [];

      for (const sheet of sheets) {
        const xml = fs.existsSync(sheet.path) ? fs.readFileSync(sheet.path, 'utf8') : '';
        if (!xml) {
          warn(`[${workbookFile}] missing worksheet xml: ${path.relative(rootDir, sheet.path).split(path.sep).join('/')}`);
          continue;
        }
        const rows = parseSheetXml(xml, sharedStrings);
        sheetPayloads.push({
          sheet,
          rows,
          memoLike: isMemoSheet(sheet.name),
          contextText: rows.length ? rows.map((row) => row.cells.join(' ')).join(' ') : '',
        });
      }

      const workbookContextText = sheetPayloads
        .filter((payload) => payload.memoLike)
        .map((payload) => payload.contextText)
        .filter(Boolean)
        .join(' ');

      let fallbackSequence = 1;
      let itemCountForWorkbook = 0;

      for (const payload of sheetPayloads) {
        const { sheet, rows, memoLike } = payload;
        if (memoLike) {
          continue;
        }
        if (!rows.length) {
          warn(`[${workbookFile}] empty sheet: ${sheet.name}`);
          continue;
        }

        const { headerRow, dataRows } = splitRows(rows);
        const headerValues = rowToArray(headerRow);
        const firstDataRow = dataRows[0];
        const columns = inferColumns(headerValues, firstDataRow, group);

        let seenNumberCount = 0;
        for (const row of dataRows) {
          const rawTitle = normalize(row.cells[columns.titleIndex] ?? '');
          const rawDesc = normalize(row.cells[columns.descIndex] ?? '');
          const rawNumber = columns.numberIndex === null ? '' : normalize(row.cells[columns.numberIndex] ?? '');
          if (!rawTitle && !rawDesc && !rawNumber) {
            continue;
          }

          const item = buildItem({
            group,
            sourceFile,
            sheetName: sheet.name,
            row,
            rowIndex: row.rowIndex,
            numberIndex: columns.numberIndex,
            titleIndex: columns.titleIndex,
            descIndex: columns.descIndex,
            fallbackSequence,
            workbookContextText,
            imageGroups,
          });

          if (!item.title && !item.description) {
            continue;
          }

          collectedItems.push(item);
          fallbackSequence += 1;
          itemCountForWorkbook += 1;
          if (item.number) {
            seenNumberCount += 1;
          }
        }

        if (!itemCountForWorkbook) {
          warn(`[${workbookFile}] no item-like worksheet found`);
        }
      }
    } catch (error) {
      warn(`[${workbookFile}] failed to parse workbook: ${error.message}`);
    } finally {
      await fsp.rm(extractedDir, { recursive: true, force: true });
    }
  }

  const itemsById = new Map();
  for (const item of collectedItems) {
    if (itemsById.has(item.id)) {
      warn(`[${item.sourceFile} / ${item.sheetName}] duplicate item id ${item.id}`);
      continue;
    }
    itemsById.set(item.id, item);
  }

  for (const image of imageFiles) {
    if (image.number === null) {
      warn(`[images] unrecognized file name pattern: ${image.relPath}`);
      continue;
    }
    const key = `${image.group}-${image.number}`;
    if (!itemsById.has(key)) {
      warn(`[images] orphan image without matching item: ${image.relPath}`);
    }
  }

  const finalItems = [...itemsById.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true, sensitivity: 'base' }));
  const groupCounts = new Map();
  for (const item of finalItems) {
    groupCounts.set(item.group, (groupCounts.get(item.group) ?? 0) + 1);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    groupSummary: [...groupCounts.entries()]
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => a.group.localeCompare(b.group, 'en', { numeric: true, sensitivity: 'base' })),
    items: finalItems,
  };

  await fsp.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`built ${finalItems.length} items across ${output.groupSummary.length} groups`);
  console.log(`scanned ${imageFiles.length} image files`);
  console.log(`wrote ${path.relative(rootDir, outputFile).split(path.sep).join('/')}`);
  console.log('sample items:');
  for (const sample of finalItems.slice(0, 3)) {
    console.log(`- ${sample.id} | ${sample.title}`);
  }
  if (warnings.length) {
    console.log(`warnings: ${warnings.length}`);
  }
}

buildIndex().catch((error) => {
  console.error(`FATAL build-index failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
