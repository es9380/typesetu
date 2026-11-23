/* data/counts.js — tiny, static counts shown on the Home page.
   WHY: home.js used to import drills.js (~96 KB), warmups.js (~750 KB) and the
   NCRTC manifest just to display a few numbers, so every first visit downloaded
   ~850 KB of JS before the hero could paint. These constants replace that.
   If you add/remove drills, warm-ups, NCRTC tests or exam mock passages,
   update the numbers here (a quick `node scripts/check-counts.mjs` is
   described in MUSE_HANDOFF.md). */
export const COUNTS = {
  texts: 192,          // FLAT_TEXTS.length (drills + paragraphs + sessions)
  drills: 76,
  warmups: 6,          // WARMUPS.length
  ncrtcTests: 52,      // NCRTC_MANIFEST.tests.length
  ncrtcQuestions: 2040,
  mocks: { hcm: 116, chsl: 24, cgl: 24, rrb: 24 }  // testsOf(id).length per exam (data/exams.js)
};
