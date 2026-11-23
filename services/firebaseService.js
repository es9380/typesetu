/* services/firebaseService.js — Firebase MODULAR SDK implementation of the
   CURRENT app's behaviour (inventory §2). Same project, same Firestore
   paths/fields/merge rules/sync triggers, same local shapes. This module is
   loaded lazily (dynamic import from app.js): if the CDN or network is
   unavailable, init fails soft and the app keeps working fully offline /
   as guest — Firebase must never break the app.

   Importmap (index.html) pins:
     firebase/app, firebase/auth, firebase/firestore → 10.12.2 (the version
     the current site ships as compat builds). */

import { initializeApp } from "firebase/app";
import {
  getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile
} from "firebase/auth";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp
} from "firebase/firestore";

import {
  loadHist, saveHist, loadBest, saveBest, sortBestArr,
  acctNameCacheGet, acctNameCacheSet, SETTINGS, LEGACY_PLACEHOLDER_NAME
} from "../core/storage.js";
import { RateLimit, rateLimited } from "../core/rateLimit.js";
import { setUser, appState, emit } from "../core/state.js";
import { registerCloud } from "./cloudBridge.js";

/* Same config object as the current site (firebaseConfig in core.js). */
const firebaseConfig = {apiKey:"AIzaSyASWcvoXRp0fr9IOTfBKq8RHaUCjrDcMpE",authDomain:"typesetu.firebaseapp.com",projectId:"typesetu",storageBucket:"typesetu.firebasestorage.app",messagingSenderId:"292627114357",appId:"1:292627114357:web:1aa278a61708cd173acb3c"};

let auth = null, db = null;
let syncState = "local";            // local | syncing | synced | failed | limited
let revisionSyncHook = null;        // Stage 3 registers the revCloudSync merge

export function getDb() { return db; }
export function getAuthInstance() { return auth; }
export function currentUser() { return appState.user; }
export function getSyncState() { return syncState; }
export function registerRevisionSync(fn) { revisionSyncHook = fn; }

function setSync(state, silent) {
  syncState = state;
  if (!silent) emit("sync", state);
}

/* ---------- error text (verbatim from the current core.js) ---------- */
export function friendlyAuthError(e) {
  const c = e && e.code ? e.code : "";
  if (c === "auth/wrong-password") return "Wrong password — please try again, or use Forgot password.";
  if (c === "auth/user-not-found") return "No account found for that email — tap Create account first.";
  if (c === "auth/email-already-in-use") return "That email already has an account — tap Log in instead.";
  if (c === "auth/weak-password") return "Password is too weak — use at least 6 characters.";
  if (c === "auth/invalid-email") return "That email address does not look valid — please check it.";
  if (c === "auth/invalid-credential") return "Email or password is incorrect — please try again.";
  if (c === "auth/too-many-requests") return "Too many attempts — please wait a few minutes and try again.";
  if (c === "auth/network-request-failed") return "No connection — check your internet and try again.";
  if (c === "auth/missing-password") return "Enter your password.";
  return "Something went wrong — please try again.";
}
export function validEmail(em) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em || ""); }

/* ---------- cloud field mapping (verbatim entryToCloud / cloudToEntry) ---------- */
export function entryToCloud(x) {
  return {
    clientId: x.clientId, clientTime: x.ts || new Date().toISOString(), date: x.d, title: x.name,
    part: x.part || x.name, durationSec: x.durSec || ((x.min || 0) * 60), durationMin: x.min || 0,
    grossWPM: x.gross, netWPM: x.net, accuracy: x.acc, totalErrors: x.errs,
    errorBreakdown: x.errCat || { spelling: x.errs || 0, capital: 0, punct: 0, spacing: 0, other: 0 },
    marks: x.marks || 0, characters: x.chars || 0, words: x.words || 0, telemetry: x.telemetry || null,
    weakestKeys: x.weakKeys || {}, weakestWords: x.weakWords || {}, examId: x.examId || "", testId: x.testId || "",
    category: x.category || "", engine: x.engine || "", fullMistakes: x.full != null ? x.full : 0,
    halfMistakes: x.half != null ? x.half : 0, errorPct: x.errorPct != null ? x.errorPct : null,
    verdict: x.verdict || "", mistakeDetail: x.mistakeDetail || null, timestamp: serverTimestamp()
  };
}
export function cloudToEntry(docSnap) {
  const v = docSnap.data();
  const en = {
    clientId: v.clientId || docSnap.id, ts: v.clientTime || new Date().toISOString(),
    d: v.date || new Date(v.clientTime || Date.now()).toLocaleString("en-IN"), name: v.title || "Test",
    part: v.part || v.title || "", gross: v.grossWPM || 0, net: v.netWPM || 0, acc: v.accuracy || 0,
    errs: v.totalErrors || 0, marks: v.marks || 0, min: v.durationMin || Math.round((v.durationSec || 0) / 60) || 5,
    durSec: v.durationSec || 0, chars: v.characters || 0, words: v.words || 0, errCat: v.errorBreakdown || {},
    weakKeys: v.weakestKeys || {}, weakWords: v.weakestWords || {}, examId: v.examId || "", testId: v.testId || "",
    category: v.category || "", engine: v.engine || "", full: v.fullMistakes || 0, half: v.halfMistakes || 0,
    errorPct: v.errorPct != null ? v.errorPct : null, verdict: v.verdict || "", synced: true
  };
  if (v.telemetry) en.telemetry = v.telemetry;
  if (v.mistakeDetail) en.mistakeDetail = v.mistakeDetail;
  return en;
}

/* ---------- results sync (saveResultToCloud / mergeCloud semantics) ---------- */
export function saveResultToCloud(entry, isBackfill) {
  if (!db || !appState.user) return Promise.resolve(false);
  if (!isBackfill && rateLimited("cloudWrite")) { setSync("limited"); return Promise.resolve(false); }
  const uid = appState.user.uid;
  return setDoc(doc(db, "users", uid, "results", entry.clientId), entryToCloud(entry), { merge: true }).then(function () {
    const h = loadHist();
    h.forEach(function (x) { if (x.clientId === entry.clientId) x.synced = true; });
    saveHist(h);
    setSync("synced");
    return true;
  }).catch(function (e) { console.warn("Cloud save failed", e); return false; });
}

let mergeCloudBusyFor = null;
export function mergeCloud() {
  if (!db || !appState.user) return Promise.resolve(false);
  if (mergeCloudBusyFor === appState.user.uid) return Promise.resolve(false);
  mergeCloudBusyFor = appState.user.uid;
  const uid = appState.user.uid;
  setSync("syncing");
  return getDocs(collection(db, "users", uid, "results")).then(function (snap) {
    const cloudEntries = [];
    snap.forEach(function (d) { cloudEntries.push(cloudToEntry(d)); });
    const local = loadHist();
    const byId = {};
    cloudEntries.forEach(function (x) { byId[x.clientId] = x; });
    const toUpload = [];
    local.forEach(function (x) { if (byId[x.clientId]) { x.synced = true; } else { toUpload.push(x); } });
    const combined = cloudEntries.concat(toUpload.map(function (x) { const y = Object.assign({}, x); y.synced = false; return y; }));
    combined.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
    saveHist(combined);
    const uploads = toUpload.slice(0, 200).map(function (x) { return saveResultToCloud(x, true); });
    return Promise.all(uploads);
  }).then(function () {
    setSync("synced");
    mergeCloudBusyFor = null;
    emit("data");
    return true;
  }).catch(function (e) {
    console.warn("Sync failed", e);
    mergeCloudBusyFor = null;
    setSync("failed");
    return false;
  });
}

/* ---------- lesson bests sync (saveBestToCloud / mergeBestFromCloud) ---------- */
const CLOUD_BEST_COL = "lessons";
export function saveBestToCloud(lessonId) {
  try {
    if (!db || !appState.user || !lessonId) return Promise.resolve(false);
    if (rateLimited("cloudWrite")) return Promise.resolve(false);
    const map = loadBest();
    const arr = Array.isArray(map[lessonId]) ? sortBestArr(map[lessonId]).slice(0, 10) : [];
    return setDoc(doc(db, "users", appState.user.uid, CLOUD_BEST_COL, lessonId), { entries: arr }, { merge: true })
      .then(function () { return true; })
      .catch(function (e) { console.warn("Cloud best save failed", e); return false; });
  } catch (e) { console.warn("Cloud best save failed", e); return Promise.resolve(false); }
}

export function mergeBestFromCloud() {
  try {
    if (!db || !appState.user) return Promise.resolve(false);
    const uid = appState.user.uid;
    return getDocs(collection(db, "users", uid, CLOUD_BEST_COL)).then(function (snap) {
      const local = loadBest();
      let changed = false;
      const uploads = [];
      const cloudIds = {};
      snap.forEach(function (d) {
        cloudIds[d.id] = true;
        const v = d.data() || {};
        const carr = Array.isArray(v.entries) ? v.entries : [];
        const larr = Array.isArray(local[d.id]) ? local[d.id] : [];
        const seen = {}, merged = [];
        carr.concat(larr).forEach(function (en) {
          if (!en) return;
          const k = [en.ts || "", en.gross || 0, en.net || 0, en.acc || 0, en.errs || 0].join("|");
          if (seen[k]) return;
          seen[k] = 1; merged.push(en);
        });
        const top = sortBestArr(merged).slice(0, 10);
        if (JSON.stringify(top) !== JSON.stringify(larr)) {
          local[d.id] = top; changed = true;
          if (JSON.stringify(top) !== JSON.stringify(carr)) uploads.push(d.id);
        }
      });
      Object.keys(local).forEach(function (id) { if (!cloudIds[id]) uploads.push(id); });
      if (changed) saveBest(local);
      return Promise.all(uploads.map(function (id) { return saveBestToCloud(id); })).then(function () {
        if (changed) emit("data");
        return true;
      });
    }).catch(function (e) { console.warn("Cloud best merge failed", e); return false; });
  } catch (e) { console.warn("Cloud best merge failed", e); return Promise.resolve(false); }
}

export function clearBestFromCloud() {
  if (!db || !appState.user) return Promise.resolve(false);
  const uid = appState.user.uid;
  return getDocs(collection(db, "users", uid, CLOUD_BEST_COL)).then(function (snap) {
    const dels = [];
    snap.forEach(function (d) { dels.push(deleteDoc(doc(db, "users", uid, CLOUD_BEST_COL, d.id))); });
    return Promise.all(dels);
  }).then(function () { return true; }).catch(function () { return false; });
}

/* ---------- account name (fetchAccountName / saveNameToCloud semantics) ---------- */
export function accountNameFromProfileData(dd) {
  if (typeof dd.name === "string" && dd.name.trim() && dd.name.trim() !== LEGACY_PLACEHOLDER_NAME) return dd.name.trim();
  if (typeof dd.siteName === "string" && dd.siteName.trim() && dd.siteName.trim() !== LEGACY_PLACEHOLDER_NAME) return dd.siteName.trim();
  if (typeof dd.displayName === "string" && dd.displayName.trim() && dd.displayName.trim() !== LEGACY_PLACEHOLDER_NAME) return dd.displayName.trim();
  return null;
}
export function fetchAccountName() {
  if (!appState.user || !db) return Promise.resolve(null);
  const uid = appState.user.uid;
  return getDoc(doc(db, "users", uid)).then(function (snap) {
    const cn = accountNameFromProfileData(snap.data() || {});
    if (cn !== null) {
      acctNameCacheSet(uid, cn);
      setUser(appState.user, cn);
    }
    return cn;
  }).catch(function () { return null; });
}
export function saveNameToCloud() {
  try {
    if (!db || !appState.user) return;
    const n = SETTINGS.name || "";
    setUser(appState.user, n.trim());
    acctNameCacheSet(appState.user.uid, n);
    const uid = appState.user.uid;
    RateLimit.debounce("nameSave", 1500, function () {
      setDoc(doc(db, "users", uid), { name: n, siteName: n, displayName: n }, { merge: true })
        .catch(function (e) { console.warn("Name cloud save failed", e); });
    });
  } catch (e) { console.warn("Name cloud save failed", e); }
}

/* ---------- revision cloud primitives (merge policy lands in Stage 3) ---------- */
export function writeRevisionCloud(bank) {
  if (!db || !appState.user) return Promise.resolve(false);
  return setDoc(doc(db, "users", appState.user.uid, "data", "revision"),
    { words: (bank.words || []).slice(0, 5000), updatedAt: bank.updatedAt || null }, { merge: true })
    .then(function () { return true; }).catch(function () { return false; });
}
export function readRevisionCloud() {
  if (!db || !appState.user) return Promise.resolve(null);
  return getDoc(doc(db, "users", appState.user.uid, "data", "revision"))
    .then(function (snap) { return snap.exists() ? snap.data() : null; })
    .catch(function () { return null; });
}

/* ---------- auth actions (views.js flows, modular SDK) ---------- */
export function signIn(email, pw) {
  if (!auth) return Promise.reject(new Error("auth-unavailable"));
  const limited = rateLimited("login");
  if (limited) return Promise.reject(Object.assign(new Error(limited), { friendly: limited }));
  return signInWithEmailAndPassword(auth, email, pw).then(function (cred) {
    RateLimit.reset("login");
    return cred;
  });
}
export function signUp(name, email, pw) {
  if (!auth) return Promise.reject(new Error("auth-unavailable"));
  const limited = rateLimited("signup");
  if (limited) return Promise.reject(Object.assign(new Error(limited), { friendly: limited }));
  const nm = (name || "").trim().slice(0, 40);
  return createUserWithEmailAndPassword(auth, email, pw).then(function (cred) {
    const u = cred.user;
    setUser(u, nm);
    if (u) {
      acctNameCacheSet(u.uid, nm);
      if (nm) { try { updateProfile(u, { displayName: nm }).catch(function () {}); } catch (e) {} }
      if (db) {
        setDoc(doc(db, "users", u.uid),
          { name: nm, siteName: nm, displayName: nm, email: email, lastLogin: serverTimestamp() }, { merge: true })
          .catch(function () {});
      }
    }
    return cred;
  });
}
export function resetPassword(email) {
  if (!auth) return Promise.reject(new Error("auth-unavailable"));
  const limited = rateLimited("passwordReset");
  if (limited) return Promise.reject(Object.assign(new Error(limited), { friendly: limited }));
  return sendPasswordResetEmail(auth, email);
}
export function signOutUser() {
  if (!auth) return Promise.resolve();
  return signOut(auth);
}

/* ---------- init + auth state (initFirebase / onAuthStateChanged flow) ---------- */
export function initFirebaseService() {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    setPersistence(auth, browserLocalPersistence).catch(function () {});
    registerCloud({
      saveResult: function (entry, isBackfill) { return saveResultToCloud(entry, isBackfill); },
      saveBest: function (id) { return saveBestToCloud(id); },
      clearBests: function () { return clearBestFromCloud(); },
      syncRevision: function () { return revisionSyncHook ? revisionSyncHook() : Promise.resolve(false); },
      saveName: function () { saveNameToCloud(); return Promise.resolve(true); }
    });
    onAuthStateChanged(auth, function (user) {
      if (user) {
        const dn = (user.displayName || "").trim();
        const name = dn || acctNameCacheGet(user.uid) || "";
        if (dn) acctNameCacheSet(user.uid, dn);
        setUser(user, name);
        setDoc(doc(db, "users", user.uid), { email: user.email || "", lastLogin: serverTimestamp() }, { merge: true }).catch(function () {});
        fetchAccountName();
        mergeCloud();
        if (revisionSyncHook) { try { revisionSyncHook(); } catch (e) { console.warn("Revision sync failed", e); } }
        try {
          mergeBestFromCloud().then(function () { emit("data"); });
        } catch (e) { console.warn("Cloud best merge failed", e); }
      } else {
        setUser(null, "");
        setSync("local", true);
        emit("sync", "local");
      }
    });
    appState.cloudReady = true;
    return true;
  } catch (e) {
    console.warn("Firebase init failed — continuing offline", e);
    appState.cloudReady = true;
    setSync("failed", true);
    return false;
  }
}
