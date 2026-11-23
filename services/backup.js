/* services/backup.js — JSON backup export/import + CSV history export.
   Formats are BYTE-COMPATIBLE with the current app (inventory §2):
   backup file "hcm-typing-backup.json", CSV file "hcm-typing-history.csv"
   with the exact column set and DQ rule. Import REPLACES history /
   drillsDone / lessonBest wholesale, as the current import does. */

import {
  loadHist, saveHist, loadDone, saveDone, loadBest, saveBest, sortBestArr,
  SETTINGS, persistSettings, autoSubmitOn, LEGACY_PLACEHOLDER_NAME
} from "../core/storage.js";
import { cloud } from "./cloudBridge.js";

export function downloadFile(name, content, type) {
  const b = new Blob([content], { type: type });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 400);
}

export function buildBackup() {
  return {
    app: "Delhi Police HCM Typing Practice", version: 1, exported: new Date().toISOString(),
    profileName: SETTINGS.name || "",
    settings: {
      autoSubmit: autoSubmitOn(),
      highlight: typeof SETTINGS.highlight === "boolean" ? SETTINGS.highlight : null,
      name: SETTINGS.name || ""
    },
    history: loadHist(),
    drillsDone: loadDone(),
    lessonBest: (function () {
      const m = loadBest(), o = {};
      Object.keys(m).forEach(function (k) { o[k] = sortBestArr(Array.isArray(m[k]) ? m[k] : []).slice(0, 10); });
      return o;
    })()
  };
}

export function exportBackupJson() {
  downloadFile("hcm-typing-backup.json", JSON.stringify(buildBackup(), null, 2), "application/json");
}

export function exportHistoryCsv() {
  const h = loadHist();
  const rows = [["Date", "Text", "Duration (min)", "Gross WPM", "Net WPM", "Accuracy %", "Errors", "Marks"]];
  h.forEach(function (x) { rows.push([x.d, x.name, x.min, x.gross, x.net, x.acc, x.errs, x.net >= 30 ? x.marks : "DQ"]); });
  const csv = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
  }).join("\n");
  downloadFile("hcm-typing-history.csv", csv, "text/csv");
}

/* Returns {ok, count} or {ok:false}. Mirrors the current import handler:
   validates d.history is an array, replaces the three stores wholesale,
   restores profileName + the three settings, saves the name to cloud. */
export function importBackupObject(d) {
  if (!d || !Array.isArray(d.history)) return { ok: false };
  saveHist(d.history);
  if (d.drillsDone) saveDone(d.drillsDone);
  if (d.lessonBest && typeof d.lessonBest === "object" && !Array.isArray(d.lessonBest)) {
    const nb = {};
    Object.keys(d.lessonBest).forEach(function (k) {
      const a = Array.isArray(d.lessonBest[k]) ? d.lessonBest[k] : [];
      nb[k] = sortBestArr(a).slice(0, 10);
    });
    saveBest(nb);
  }
  if (d.profileName && String(d.profileName).trim() && String(d.profileName).trim() !== LEGACY_PLACEHOLDER_NAME) {
    SETTINGS.name = String(d.profileName).trim();
    persistSettings();
  }
  if (d.settings && typeof d.settings === "object" && !Array.isArray(d.settings)) {
    if (typeof d.settings.autoSubmit === "boolean") SETTINGS.autoSubmit = d.settings.autoSubmit;
    if (typeof d.settings.highlight === "boolean" || d.settings.highlight === null) SETTINGS.highlight = d.settings.highlight;
    if (typeof d.settings.name === "string") SETTINGS.name = d.settings.name.trim() === LEGACY_PLACEHOLDER_NAME ? "" : d.settings.name.trim();
    else if (typeof d.settings.siteName === "string") SETTINGS.name = d.settings.siteName.trim() === LEGACY_PLACEHOLDER_NAME ? "" : d.settings.siteName.trim();
    persistSettings();
    cloud.saveName();
  }
  return { ok: true, count: d.history.length };
}

export function importBackupFile(file) {
  return new Promise(function (resolve) {
    const r = new FileReader();
    r.onload = function () {
      try { resolve(importBackupObject(JSON.parse(r.result))); }
      catch (err) { resolve({ ok: false }); }
    };
    r.onerror = function () { resolve({ ok: false }); };
    r.readAsText(file);
  });
}
