// ============================================================
//  WORLD CUP FANTASY 2026 — Google Apps Script Backend  (v2)
// ============================================================
//
//  v2 CHANGE: state JSON is stored in CHUNKS down column A
//  (A1, A2, A3, ...) instead of only in A1. A single Sheets
//  cell caps at 50,000 characters and the state outgrew it
//  during the knockouts ("Your input contains more than the
//  maximum of 50000 characters in a single cell").
//  Reads concatenate all non-empty cells in column A, so the
//  existing single-cell A1 data loads unchanged.
//
//  SETUP INSTRUCTIONS:
//  1. Open the "Fantasy Worldcup" project at script.google.com
//  2. Paste this entire file, replacing any existing code
//  3. Save, then Deploy → Manage Deployments → pencil →
//     New version → Deploy   (edits do NOT go live without this)
//     - Execute as: Me
//     - Who has access: Anyone
//  4. The Web App URL stays the same — no frontend change needed
// ============================================================

const SHEET_NAME = "WCF2026_Data";
const CHUNK_SIZE = 45000; // safety margin under the 50,000-char cell cap
const MAX_CHUNKS = 40;    // rows used for storage (~1.8 MB ceiling)

function emptyState() {
  return { managers: ["", "", "", "", "", ""], picks: {}, results: [], biggestUpsetUsed: false };
}

function getOrCreateSheet() {
  const files = DriveApp.getFilesByName(SHEET_NAME);
  let ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(SHEET_NAME);
    writeState(ss.getActiveSheet(), emptyState());
  }
  return ss.getActiveSheet();
}

// Concatenate non-empty cells down column A, then parse.
// Empty sheet → fresh empty state. Corrupt JSON → throws
// (callers report the error; we never silently reset data).
function readState(sheet) {
  const values = sheet.getRange(1, 1, MAX_CHUNKS, 1).getValues();
  let json = "";
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (v === "" || v === null) break;
    json += String(v);
  }
  if (!json) return emptyState();
  return JSON.parse(json);
}

// Split state JSON into <50k chunks and write A1..An, blanking
// the unused rows below so stale tails can't corrupt a read.
function writeState(sheet, state) {
  const json = JSON.stringify(state);
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) {
    chunks.push(json.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length > MAX_CHUNKS) {
    throw new Error("State too large to store: " + json.length + " chars > " + (CHUNK_SIZE * MAX_CHUNKS));
  }
  const rows = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    rows.push([i < chunks.length ? chunks[i] : ""]);
  }
  sheet.getRange(1, 1, MAX_CHUNKS, 1).setValues(rows);
  console.log("writeState: %s chars across %s cell(s)", json.length, chunks.length);
}

function buildJsonp(callback, data) {
  // JSONP response wraps JSON in a callback function call
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(data) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function buildJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function processAction(body, state) {
  const action = body.action;
  console.log("processAction: %s", action);

  if (action === "saveManagers") {
    state.managers = body.managers;
    body.managers.forEach(function(n) {
      if (n && !state.picks[n]) state.picks[n] = [];
    });

  } else if (action === "makePick") {
    const manager = body.manager;
    const team = body.team;
    if (!state.picks[manager]) state.picks[manager] = [];
    const allPicked = Object.keys(state.picks).reduce(function(acc, k) {
      return acc.concat(state.picks[k]);
    }, []);
    if (allPicked.indexOf(team) !== -1) {
      return { ok: false, error: "Team already drafted" };
    }
    state.picks[manager].push(team);

  } else if (action === "logResult") {
    const result = body.result;
    result.id = Date.now();
    if (result.biggestUpset) {
      if (state.biggestUpsetUsed) {
        return { ok: false, error: "Biggest Upset already awarded!" };
      }
      state.biggestUpsetUsed = true;
    }
    state.results.push(result);

  } else if (action === "deleteResult") {
    state.results = state.results.filter(function(r) { return r.id !== body.id; });

  } else if (action === "resetAll") {
    state.managers = ["","","","","",""];
    state.picks = {};
    state.results = [];
    state.biggestUpsetUsed = false;
  }

  return { ok: true, data: state };
}

function doGet(e) {
  const callback = e && e.parameter ? e.parameter.callback : null;
  try {
    const sheet = getOrCreateSheet();
    const state = readState(sheet);

    // If there's a data param it's a write-via-GET (from JSONP-era api() calls)
    if (e.parameter.data) {
      const body = JSON.parse(decodeURIComponent(e.parameter.data));
      const result = processAction(body, state);
      if (result.ok) {
        writeState(sheet, result.data);
      }
      if (callback) return buildJsonp(callback, result);
      return buildJson(result);
    }

    // Plain GET = load state
    const response = { ok: true, data: state };
    if (callback) return buildJsonp(callback, response);
    return buildJson(response);

  } catch (err) {
    console.error("doGet failed: " + err + (err && err.stack ? "\n" + err.stack : ""));
    const errResult = { ok: false, error: err.toString() };
    if (callback) return buildJsonp(callback, errResult);
    return buildJson(errResult);
  }
}

function doPost(e) {
  try {
    const sheet = getOrCreateSheet();
    const state = readState(sheet);
    const body = JSON.parse(e.postData.contents);
    const result = processAction(body, state);
    if (result.ok) {
      writeState(sheet, result.data);
    }
    return buildJson(result);
  } catch (err) {
    console.error("doPost failed: " + err + (err && err.stack ? "\n" + err.stack : ""));
    return buildJson({ ok: false, error: err.toString() });
  }
}

// Run manually in the editor to sanity-check chunked storage:
// reads current state, rewrites it, re-reads, and compares.
function testChunkRoundtrip() {
  const sheet = getOrCreateSheet();
  const before = JSON.stringify(readState(sheet));
  writeState(sheet, JSON.parse(before));
  const after = JSON.stringify(readState(sheet));
  console.log("roundtrip ok: %s (%s chars, results: %s)",
    before === after, after.length, JSON.parse(after).results.length);
  if (before !== after) throw new Error("Roundtrip mismatch!");
}
