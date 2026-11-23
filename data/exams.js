/* Exam specifications (EXAM_SPECS) for all 4 exams — carried over byte-identical (values) from the live build
   (typesetu-ncrtc @ 284090d). Only the ES-module wrapper is new.
   Do not hand-edit content values: mock numbering is positional. */
import { PASSAGE_BATCH, flowText } from "./passages.js";
import { EXAM_SPECS, specOf } from "./examSpecs.js";
export { EXAM_SPECS, specOf };


export function fmtNum(n){ return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,","); }
export function dispErrPct(x){ return Math.min(100, Math.max(0, +x||0)); }

/* batchTests — verbatim logic from the current exams.js. Display names are
   POSITIONAL: the i-th passage of an exam is "<Short> Mock " + (i+1). */
export function batchTests(examId){
  var sp = specOf(examId); var raw = PASSAGE_BATCH[examId] || [];
  return raw.map(function(p, i){
    return { id: p.tid, num: i + 1, name: (examId === "hcm" ? "HCM" : sp.short) + " Mock " + (i + 1), text: flowText(p.text), diff: p.diff, topic: p.topic, isNew: !!p.isNew };
  });
}
export function hcmTests(){ return batchTests("hcm"); }
export function testsOf(examId){ return batchTests(examId); }
