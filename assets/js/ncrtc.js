/* NCRTC D01 MCQ module — topic-wise tests for Supervisor-I (Operations).
   Data: assets/data/ncrtc/index.json (manifest) + one JSON per test.
   Self-contained: renders inside #view-ncrtc, stores best scores in localStorage. */
(function(){
"use strict";
var DATA_BASE="assets/data/ncrtc/";
var manifest=null, manifestLoading=false;
var cur=null; /* {test, data, answers:[], idx, submitted, score} */
var BEST_KEY="ncrtcBestV1";

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function loadBest(){ try{ return JSON.parse(localStorage.getItem(BEST_KEY)||"{}"); }catch(e){ return {}; } }
function saveBest(id,score,total){
  var b=loadBest(), prev=b[id];
  if(!prev || score>prev.score || (score===prev.score && total>=prev.total)){
    b[id]={score:score,total:total,ts:Date.now()};
    try{ localStorage.setItem(BEST_KEY,JSON.stringify(b)); }catch(e){}
  }
}
function bestBadge(id){
  var b=loadBest()[id];
  if(!b) return "";
  var pct=Math.round(100*b.score/b.total);
  return '<span class="ncBest">Best: '+b.score+"/"+b.total+" ("+pct+"%)</span>";
}

function ncrtcInit(){
  if(manifest || manifestLoading) { if(manifest) renderLanding(); return; }
  manifestLoading=true;
  fetch(DATA_BASE+"index.json").then(function(r){ return r.json(); }).then(function(m){
    manifest=m; manifestLoading=false; renderLanding();
  }).catch(function(){
    manifestLoading=false;
    var body=el("ncBody"); if(body) body.innerHTML='<div class="card"><p>Could not load the test list. Check your connection and reopen this section.</p></div>';
  });
}

var CAT_TITLES={technical:"Technical — Subject Knowledge (60 marks)",gs:"General Studies — most-probable MCQs",ca:"Current Affairs — month-wise"};
var CAT_ORDER=["technical","gs","ca"];

function renderLanding(){
  var body=el("ncBody"); if(!body||!manifest) return;
  el("ncRunner").style.display="none";
  el("ncResult").style.display="none";
  body.style.display="";
  var best=loadBest();
  var doneCount=Object.keys(best).length;
  var html='<p class="sub">Topic-wise MCQ tests built from your NCRTC book — every question has an explanation after you submit. '+
    (doneCount? "Tests attempted so far: <strong>"+doneCount+"</strong>.":"")+'</p>';
  CAT_ORDER.forEach(function(cat){
    var tests=manifest.tests.filter(function(t){ return t.category===cat; });
    if(!tests.length) return;
    html+='<h2 class="ncCatHead">'+esc(CAT_TITLES[cat]||cat)+"</h2>";
    var groups=[], byGroup={};
    tests.forEach(function(t){ if(!byGroup[t.group]){ byGroup[t.group]=[]; groups.push(t.group); } byGroup[t.group].push(t); });
    groups.forEach(function(g){
      html+='<h3 class="ncGroupHead">'+esc(g)+"</h3>";
      html+='<div class="ncGrid">';
      byGroup[g].forEach(function(t){
        html+='<div class="card ncCard"><div class="ncCardTop"><strong>'+esc(t.title)+'</strong></div>'+
          '<div class="ncMeta"><span>'+t.count+' questions</span>'+bestBadge(t.id)+"</div>"+
          '<div class="ncCardBtns">'+
          (t.pdf? '<a class="pill ncPdfBtn" href="'+esc(t.pdf)+'" target="_blank" rel="noopener">Read PDF</a>' : "")+
          '<button class="btn ncStartBtn" type="button" data-nc-start="'+esc(t.id)+'">Start test</button>'+
          "</div></div>";
      });
      html+="</div>";
    });
  });
  body.innerHTML=html;
  body.querySelectorAll("[data-nc-start]").forEach(function(b){
    b.addEventListener("click",function(){ startTest(b.getAttribute("data-nc-start")); });
  });
}

function startTest(id){
  var meta=null;
  manifest.tests.forEach(function(t){ if(t.id===id) meta=t; });
  if(!meta) return;
  var body=el("ncBody"); body.innerHTML='<p class="sub">Loading questions…</p>';
  fetch(DATA_BASE+id+".json").then(function(r){ return r.json(); }).then(function(data){
    cur={test:meta,data:data,answers:new Array(data.questions.length).fill(null),idx:0,submitted:false,score:0};
    body.style.display="none";
    el("ncResult").style.display="none";
    el("ncRunner").style.display="";
    renderQuestion();
  }).catch(function(){
    body.innerHTML='<div class="card"><p>Could not load this test. Check your connection and try again.</p></div>';
  });
}

function renderQuestion(){
  if(!cur) return;
  var qs=cur.data.questions, i=cur.idx, q=qs[i];
  el("ncTestTitle").textContent=cur.test.title;
  el("ncProgress").textContent="Question "+(i+1)+" of "+qs.length+" · Attempted "+cur.answers.filter(function(a){return a!==null;}).length;
  el("ncQText").textContent=(i+1)+". "+q.q;
  var opts=el("ncOpts"); opts.innerHTML="";
  q.options.forEach(function(op,oi){
    var b=document.createElement("button");
    b.type="button";
    b.className="ncOpt"+(cur.answers[i]===oi?" sel":"");
    b.innerHTML='<span class="ncOptKey">'+("ABCD"[oi])+"</span><span>"+esc(op)+"</span>";
    b.addEventListener("click",function(){ cur.answers[i]=oi; renderQuestion(); });
    opts.appendChild(b);
  });
  el("ncPrevBtn").disabled=(i===0);
  el("ncNextBtn").disabled=(i===qs.length-1);
  var pal=el("ncPalette"); pal.innerHTML="";
  qs.forEach(function(_,pi){
    var p=document.createElement("button");
    p.type="button";
    p.className="ncPalBtn"+(cur.answers[pi]!==null?" done":"")+(pi===i?" now":"");
    p.textContent=pi+1;
    p.setAttribute("aria-label","Go to question "+(pi+1));
    p.addEventListener("click",function(){ cur.idx=pi; renderQuestion(); });
    pal.appendChild(p);
  });
  var un=cur.answers.filter(function(a){return a===null;}).length;
  el("ncPalSummary").textContent="Attempted "+(qs.length-un)+" · Left "+un;
}

function ncConfirm(msg){
  return new Promise(function(resolve){
    var ov=document.createElement("div");
    ov.className="ncModalOv";
    ov.innerHTML='<div class="card ncModal"><p>'+esc(msg).replace(/\n/g,"<br>")+'</p>'+
      '<div class="ncCardBtns"><button class="btn" type="button" data-nc="ok">Yes, continue</button>'+
      '<button class="pill" type="button" data-nc="cancel">Cancel</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click",function(e){
      var b=e.target.closest? e.target.closest("[data-nc]"):null;
      if(!b && e.target!==ov) return;
      var ok=b? b.getAttribute("data-nc")==="ok" : false;
      ov.remove(); resolve(ok);
    });
  });
}

function submitTest(){
  if(!cur) return;
  var un=cur.answers.filter(function(a){return a===null;}).length;
  var msg="Submit this test?"+(un? "\n\n"+un+" question(s) are still unattempted — they will score 0 (no negative marking).":"");
  ncConfirm(msg).then(function(ok){ if(ok) doSubmit(); });
}
function doSubmit(){
  var qs=cur.data.questions, score=0;
  var skipped=cur.answers.filter(function(a){return a===null;}).length;
  qs.forEach(function(q,i){ if(cur.answers[i]===q.answer) score++; });
  cur.score=score; cur.submitted=true;
  saveBest(cur.test.id,score,qs.length);
  el("ncRunner").style.display="none";
  var res=el("ncResult"); res.style.display="";
  var pct=Math.round(100*score/qs.length);
  var html='<div class="card ncScoreCard"><h2>'+esc(cur.test.title)+"</h2>"+
    '<div class="ncScoreBig">'+score+" / "+qs.length+'</div>'+
    '<div class="ncScorePct">'+pct+'% · Correct '+score+' · Wrong '+(qs.filter(function(q,i){return cur.answers[i]!==null&&cur.answers[i]!==q.answer;}).length)+' · Skipped '+skipped+"</div>"+
    '<div class="ncCardBtns"><button class="btn" type="button" id="ncRetakeBtn">Retake test</button>'+
    '<button class="pill" type="button" id="ncBackBtn">All tests</button></div></div>';
  html+='<h2 class="ncCatHead">Review — every question with explanation</h2>';
  qs.forEach(function(q,i){
    var ua=cur.answers[i], ok=(ua===q.answer);
    html+='<div class="card ncReview '+(ok?"ok":(ua===null?"skip":"bad"))+'">'+
      '<div class="ncReviewHead"><strong>Q'+(i+1)+". "+esc(q.q)+'</strong><span class="ncTag '+(ok?"ok":(ua===null?"skip":"bad"))+'">'+(ok?"Correct":(ua===null?"Skipped":"Wrong"))+"</span></div>"+
      '<div class="ncReviewOpts">';
    q.options.forEach(function(op,oi){
      var cls="ncROpt";
      if(oi===q.answer) cls+=" correct";
      if(oi===ua && ua!==q.answer) cls+=" yourWrong";
      html+='<div class="'+cls+'"><span class="ncOptKey">'+("ABCD"[oi])+"</span><span>"+esc(op)+"</span>"+
        (oi===q.answer?' <span class="ncMark">✓ correct</span>':"")+
        (oi===ua && ua!==q.answer?' <span class="ncMark">← your answer</span>':"")+
        (oi===ua && ua===q.answer?' <span class="ncMark">← your answer</span>':"")+"</div>";
    });
    html+='</div><p class="ncExplain"><strong>Why:</strong> '+esc(q.explain)+"</p></div>";
  });
  res.innerHTML=html;
  el("ncRetakeBtn").addEventListener("click",function(){ startTest(cur.test.id); });
  el("ncBackBtn").addEventListener("click",function(){ res.style.display="none"; renderLanding(); window.scrollTo(0,0); });
  window.scrollTo(0,0);
}

document.addEventListener("DOMContentLoaded",function(){
  var prev=el("ncPrevBtn"), next=el("ncNextBtn"), sub=el("ncSubmitBtn"), quit=el("ncQuitBtn");
  if(prev) prev.addEventListener("click",function(){ if(cur&&cur.idx>0){ cur.idx--; renderQuestion(); } });
  if(next) next.addEventListener("click",function(){ if(cur&&cur.idx<cur.data.questions.length-1){ cur.idx++; renderQuestion(); } });
  if(sub) sub.addEventListener("click",submitTest);
  if(quit) quit.addEventListener("click",function(){
    var leave=function(){ cur=null; el("ncRunner").style.display="none"; renderLanding(); window.scrollTo(0,0); };
    if(cur && !cur.submitted){ ncConfirm("Leave this test? Your answers in this attempt will be lost.").then(function(ok){ if(ok) leave(); }); }
    else leave();
  });
});

/* Hook into the view router (views.js showView; navigation.js wraps it later and captures this version). */
if(typeof showView==="function"){
  var __ncShowView=showView;
  showView=function(name,scrollTarget){
    __ncShowView(name,scrollTarget);
    if(name==="ncrtc") ncrtcInit();
  };
}
})();
