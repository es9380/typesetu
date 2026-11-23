/* services/cloudBridge.js — the seam between the app and Firebase.
   Everything except firebaseService imports THIS module, never the Firebase
   SDK. Defaults are safe no-ops (guest / offline), so the app boots and
   works fully signed-out or with Firebase unreachable; firebaseService
   registers the real implementations when it initialises. Stage 2/3
   features call cloud.saveResult(entry), cloud.saveBest(id) etc. exactly
   as the current engines call their cloud helpers. */

export const cloud = {
  ready: false,
  saveResult: function () { return Promise.resolve(false); },
  saveBest: function () { return Promise.resolve(false); },
  clearBests: function () { return Promise.resolve(false); },
  syncRevision: function () { return Promise.resolve(false); },
  saveName: function () { return Promise.resolve(false); }
};

export function registerCloud(impl) {
  Object.assign(cloud, impl || {});
  cloud.ready = true;
}
