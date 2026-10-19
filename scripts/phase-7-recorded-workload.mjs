// Offline preparation of a bounded, deidentified CC0 Lichess archive sample.
// The benchmark never downloads data or contacts a provider.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const apiRequire = createRequire(new URL('../packages/chess-domain/package.json', import.meta.url));
const { Chess } = apiRequire('chess.js');
export const RECORDED_CONTROLS = ['60+0', '60+1', '180+0', '180+2', '600+0', '600+5'];
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function prepareRecordedWorkload(pgnText, sourceUrl) {
  if (typeof pgnText !== 'string' || Buffer.byteLength(pgnText) > 100_000_000
      || !/^https:\/\/database\.lichess\.org\/standard\/lichess_db_standard_rated_\d{4}-\d{2}\.pgn\.zst$/.test(sourceUrl)) {
    throw new Error('Expected a bounded CC0 standard-game archive prefix and its archive URL.');
  }
  const games = [];
  const occupied = new Set();
  let scanned = 0;
  // Ignore a possibly truncated final game in a decompressed archive prefix.
  const blocks = pgnText.split(/(?=\[Event ")/).filter((x) => x.trim());
  for (const block of blocks.slice(0, -1)) {
    scanned++;
    const headers = Object.fromEntries([...block.matchAll(/^\[(\w+) "([^"\r\n]*)"\]$/gm)].map((m) => [m[1], m[2]]));
    const control = headers.TimeControl;
    if (!RECORDED_CONTROLS.includes(control) || !['1-0', '0-1', '1/2-1/2'].includes(headers.Result)) continue;
    let chess;
    try { chess = new Chess(); chess.loadPgn(block); } catch { continue; }
    const moves = chess.history();
    const band = moves.length >= 20 && moves.length <= 40 ? 'short'
      : moves.length <= 80 && moves.length > 40 ? 'medium'
      : moves.length <= 160 && moves.length > 80 ? 'long' : null;
    const slot = control + ':' + band;
    if (!band || occupied.has(slot)) continue;
    const clockMatches = [...block.matchAll(/\[%clk (\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/g)];
    // Keep only genuinely complete recorded clocks. No fabricated alignment.
    if (clockMatches.length !== moves.length) continue;
    const clocks = clockMatches.map((m) => Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 100));
    const timestamp = Date.parse(`${headers.UTCDate?.replaceAll('.', '-')}T${headers.UTCTime}Z`);
    if (!Number.isFinite(timestamp)) continue;
    const [initial, increment] = control.split('+').map(Number);
    const duration = initial + 40 * increment;
    const replay = new Chess();
    for (const move of moves) replay.move(move);
    replay.header('Event', 'CC0 recorded benchmark', 'Site', 'Offline archive sample',
      'White', 'BenchmarkUser', 'Black', 'BenchmarkOpponent', 'Result', headers.Result,
      'TimeControl', control, 'Date', headers.UTCDate);
    games.push({
      key: `recorded_${control.replace('+', '_')}_${band}`,
      sourceOrdinal: scanned, sourcePgnSha256: hash(block),
      control, speed: duration < 180 ? 'bullet' : duration < 480 ? 'blitz' : 'rapid',
      lengthBand: band, plies: moves.length, pgn: replay.pgn(), clocks,
      clockPrecision: 'ARCHIVE_SECONDS', createdAt: timestamp,
      // PGN Termination="Normal" does not distinguish resignation/checkmate.
      status: chess.isCheckmate() ? 'mate' : headers.Termination === 'Time forfeit' ? 'outoftime' : 'unknownFinish',
      result: headers.Result,
      whiteRating: /^\d+$/.test(headers.WhiteElo) ? Number(headers.WhiteElo) : null,
      blackRating: /^\d+$/.test(headers.BlackElo) ? Number(headers.BlackElo) : null,
    });
    occupied.add(slot);
    if (games.length === RECORDED_CONTROLS.length * 3) break;
  }
  if (games.length !== 18) throw new Error(`Archive prefix did not fill all 18 exact-control/length slots (found ${games.length}).`);
  return {
    schemaVersion: 'phase-7-recorded-workload-v1',
    source: { url: sourceUrl, license: 'CC0-1.0', licenseUrl: 'https://database.lichess.org/',
      prefixSha256: hash(pgnText), scannedGames: scanned,
      selection: 'FIRST_COMPLETE_CLOCK_GAME_PER_EXACT_CONTROL_AND_20_40_41_80_81_160_PLY_BAND',
      limitations: 'Chronological archive prefix; quota sample, not random or population-representative. Unrelated players pooled under a benchmark identity. Archive clocks have second precision; no API centisecond fidelity claim.' },
    games,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, sourceUrl, output] = process.argv.slice(2);
  if (!input || !sourceUrl || !output) throw new Error('Usage: node scripts/phase-7-recorded-workload.mjs prefix.pgn ARCHIVE_URL output.json');
  const fixture = prepareRecordedWorkload(await readFile(input, 'utf8'), sourceUrl);
  await writeFile(output, JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx' });
  console.info(`Prepared ${fixture.games.length} deidentified recorded games; ${fixture.games.reduce((n, g) => n + g.plies, 0)} plies.`);
}
