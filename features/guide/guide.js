/* features/guide — Exam Guide & 30-Day Plan route.
   Content is carried over verbatim from the current guide view
   (guideContent.js); only the shell around it is new. */

import { GUIDE_HTML } from "./guideContent.js";

export function mount(container) {
  container.innerHTML =
    '<section class="arena-head"><h1>Exam Guide &amp; 30-Day Plan</h1>' +
    '<p>How marks are calculated, how to diagnose your errors, exam-hall technique — and the 30-day plan.</p></section>' +
    '<div class="guide-body">' + GUIDE_HTML + '</div>';
  return { destroy: function () {} };
}
