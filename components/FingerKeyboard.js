/* components/FingerKeyboard.js — the finger keyboard diagram.
   Verbatim port of the current app's keyboard builder (rows + finger
   classes) and its legend. Shown from the command bar's ⚙ More menu when
   SETTINGS.kb is on (the same persisted setting the old site used). */

export function fingerKeyboardHtml() {
  const F = { p: "fp", r: "fr", m: "fm", i: "fi" };
  const rows = [
    { keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], f: ["p", "r", "m", "i", "i", "i", "i", "m", "r", "p"] },
    { keys: ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"], f: ["p", "r", "m", "i", "i", "i", "i", "m", "r", "p"] },
    { keys: ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";"], f: ["p", "r", "m", "i", "i", "i", "i", "m", "r", "p"], home: true },
    { keys: ["Z", "X", "C", "V", "B", "N", "M", ",", "."], f: ["p", "r", "m", "i", "i", "i", "m", "r"] }
  ];
  let html = '<div class="kb-legend">' +
    '<span><span class="dot" style="background:rgba(219,39,119,.55)"></span>Little finger</span>' +
    '<span><span class="dot" style="background:rgba(234,88,12,.6)"></span>Ring finger</span>' +
    '<span><span class="dot" style="background:rgba(202,138,4,.65)"></span>Middle finger</span>' +
    '<span><span class="dot" style="background:rgba(37,99,235,.55)"></span>Index finger</span>' +
    '<span>Outlined = home row (F and J are your anchors)</span></div>';
  rows.forEach(function (r) {
    html += '<div class="kbRow">';
    r.keys.forEach(function (k, ki) { html += '<div class="key ' + (F[r.f[ki]] || "") + ((r.home) ? " homeKey" : "") + '">' + k + '</div>'; });
    html += '</div>';
  });
  html += '<div class="kbRow"><div class="key wide">Shift</div><div class="key space">SPACE — both thumbs</div><div class="key wide">Shift</div></div>';
  return html;
}
