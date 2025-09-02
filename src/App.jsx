// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";

/**
 * PMP Interactive Practice Exam — v2.1 (JSX build)
 * - JSON-first loading; CSV fallback
 * - Robust CSV parser (quotes, commas, CRLF, newlines-in-fields)
 * - Single / Multi / Matching
 * - Per-option rationales + explanations
 * - Practice & Exam modes; export summary CSV
 * - Self-tests for the CSV parser (dev aid)
 */

const CONFIG = {
  requireEmail: false,
  emailWebhook: "",
  reviewWebhook: "",
};

// ---------- Utils ----------
function shuffle(arr, seed) {
  const a = [...arr];
  let s = seed ?? Math.floor(Math.random() * 1e9);
  const rand = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toCSV(rows) {
  return rows
    .map(r => r
      .map(cell => /[",\n]/.test(String(cell)) ? '"' + String(cell).replace(/"/g,'""') + '"' : String(cell))
      .join(",")
    )
    .join("\n");
}

function download(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---------- Robust CSV parsing ----------
function parseCSVStream(text) {
  const rows = [];
  const len = text.length;
  let i = 0, row = [], cur = "", inQ = false;
  while (i < len) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && i + 1 < len && text[i + 1] === '"') { cur += '"'; i += 2; continue; }
      inQ = !inQ; i++; continue;
    }
    if (!inQ && ch === ',') { row.push(cur); cur = ""; i++; continue; }
    if (!inQ && (ch === '\n' || ch === '\r')) {
      row.push(cur); cur = "";
      if (row.length && row.some(c => c !== "")) rows.push(row);
      row = [];
      if (ch === '\r' && i + 1 < len && text[i + 1] === '\n') i += 2; else i++;
      continue;
    }
    cur += ch; i++;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.length && row.some(c => c !== "")) rows.push(row);
  }
  return rows;
}

function parseCSV(text) {
  const table = parseCSVStream(text);
  if (!table.length) return [];
  const header = table[0].map(h => h.trim().toLowerCase());
  const idxOf = (name) => header.indexOf(name);
  const qi = idxOf("id"), di = idxOf("domain"), qq = idxOf("question"), ai = idxOf("a"), bi = idxOf("b"),
        ci = idxOf("c"), dd = idxOf("d"), co = idxOf("correct"), ex = idxOf("explanation"), rf = idxOf("reference");
  const required = [di, qq, ai, bi, ci, dd, co];
  if (required.some(i => i < 0)) { console.warn("CSV header missing required columns", header); return []; }
  const allowedDomains = new Set(["People","Process","Business","Agile"]);
  const letterToIndex = (s) => {
    const m = { a:0, b:1, c:2, d:3 };
    const t = String(s).trim().toLowerCase();
    if (t in m) return m[t];
    if (/^[0-3]$/.test(t)) return Number(t);
  };
  const out = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!row || row.every(c => !c || !String(c).trim())) continue;
    const ans = letterToIndex(row[co] || "");
    const dom = (row[di] || "").trim();
    if (ans === undefined || !allowedDomains.has(dom)) { console.warn(`Row ${r+1} skipped (bad answer/domain)`); continue; }
    out.push({
      id: ((qi >= 0 ? (row[qi] || "").trim() : "").replace(/\s+/g, "")) || `U${r}`,
      domain: dom,
      question: (row[qq] || "").trim(),
      choices: [(row[ai]||"").trim(), (row[bi]||"").trim(), (row[ci]||"").trim(), (row[dd]||"").trim()],
      answerIndex: ans,
      explanation: ex >= 0 ? (row[ex] || "") : "",
      reference: rf >= 0 ? (row[rf] || "") : "",
    });
  }
  return out;
}

function scoreMulti(selection, correct) {
  const selSet = new Set(selection);
  const corSet = new Set(correct);
  const wrongPicked = [...selSet].filter(i => !corSet.has(i));
  const missed = [...corSet].filter(i => !selSet.has(i));
  const ok = wrongPicked.length === 0 && missed.length === 0;
  const msg = ok ? "Correct" : `Keep trying: ${wrongPicked.length?"remove wrong choices":"select remaining correct choices"}.`;
  return { correct: ok, msg };
}

function scoreMatch(sel, pairs) {
  if (!sel.length || !pairs || !pairs.length) return false;
  return pairs.every(([l, r]) => sel[l] === r);
}

// ---------- Starter fallback ----------
const starterQuestions = [
  { id:"Q1", domain:"People", question:"Two team members are in conflict. What is the best first step?",
    choices:["Escalate immediately","Facilitate a private, interest-based talk","Replace a member","Send a broadcast email"], answerIndex:1,
    explanation:"Start with private, interest-based resolution before escalating." },
];

function isV21(q) { return q && typeof q === 'object' && 'item_type' in q; }

// ---------- Component ----------
export default function App() {
  const [allQuestions, setAllQuestions] = useState(starterQuestions);
  const [selectedDomains, setSelectedDomains] = useState({ People:true, Process:true, Business:true, Agile:true });
  const [sessionSize, setSessionSize] = useState(40);
  const [mode, setMode] = useState("practice"); // "practice" | "exam"
  const [seed, setSeed] = useState(42);

  const [sessionQs, setSessionQs] = useState([]);
  const [idx, setIdx] = useState(0);
  const [eliminated, setEliminated] = useState({}); // single only
  const [multiSel, setMultiSel] = useState([]);
  const [matchSel, setMatchSel] = useState([]); // right index per left
  const [chosenHistory, setChosenHistory] = useState([]);
  const [firstTryCorrect, setFirstTryCorrect] = useState(null);
  const [results, setResults] = useState({});
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [flagged, setFlagged] = useState({});
  const [questionStart, setQuestionStart] = useState(null);

  // Load default bank from /questions.json then fallback to /questions.csv
  useEffect(() => {
    (async () => {
      try {
        const resJ = await fetch("/questions.json", { cache: "no-store" });
        if (resJ.ok) {
          const arr = await resJ.json();
          if (Array.isArray(arr) && arr.length) { setAllQuestions(arr); return; }
        }
      } catch (e) { console.warn("/questions.json load failed", e); }
      try {
        const res = await fetch("/questions.csv", { cache: "no-store" });
        if (res.ok) {
          const text = await res.text();
          const qs = parseCSV(text);
          if (qs.length > 0) setAllQuestions(qs);
        }
      } catch (e) { console.warn("/questions.csv load failed", e); }
    })();
  }, []);

  // Filter by domain
  const filtered = useMemo(() => allQuestions.filter(q => q && q.domain && selectedDomains[q.domain]), [allQuestions, selectedDomains]);

  function beginSession() {
    const pool = shuffle(filtered, seed);
    const pickRaw = pool.slice(0, Math.min(sessionSize, pool.length));

    // Shuffle choices per question (single/multi) and keep correctness aligned
    const pick = pickRaw.map((q) => {
      if (isV21(q)) {
        if (q.item_type === "single" || q.item_type === "multi") {
          const idxs = shuffle([0,1,2,3], Math.floor(Math.random()*1e9));
          const newChoices = (q.choices || []).map((_, i) => q.choices[idxs[i]]);
          let newCorrectIndex = q.correct_index;
          let newCorrectIndices = q.correct_indices;
          if (q.item_type === "single" && typeof q.correct_index === "number") {
            newCorrectIndex = idxs.indexOf(q.correct_index);
          }
          if (q.item_type === "multi" && Array.isArray(q.correct_indices)) {
            newCorrectIndices = q.correct_indices.map(ci => idxs.indexOf(ci)).sort();
          }
          const newRats = q.rationales ? q.rationales.map((_, i) => q.rationales[idxs[i]]) : q.rationales;
          return { ...q, choices: newChoices, correct_index: newCorrectIndex, correct_indices: newCorrectIndices, rationales: newRats };
        }
        return q;
      } else {
        const idxs = shuffle([0,1,2,3], Math.floor(Math.random()*1e9));
        const newChoices = [q.choices[idxs[0]], q.choices[idxs[1]], q.choices[idxs[2]], q.choices[idxs[3]]];
        const newAnswerIndex = idxs.indexOf(q.answerIndex);
        return { ...q, choices: newChoices, answerIndex: newAnswerIndex };
      }
    });

    setSessionQs(pick);
    setIdx(0);
    setResults({});
    setFinished(false);
    setStarted(true);
    setEliminated({});
    setChosenHistory([]);
    setMultiSel([]);
    setMatchSel([]);
    setFirstTryCorrect(null);
    setQuestionStart(Date.now());
  }

  function recordResult(correct) {
    const q = sessionQs[idx] || {};
    const tries = chosenHistory.length + (multiSel.length ? 1 : 0) + (matchSel.length ? 1 : 0) || 1;
    const r = { id: q.id, firstTryCorrect: !!(correct && tries === 1), tries, chosenHistory: [...chosenHistory], timeMs: questionStart ? Date.now() - questionStart : 0, matchSelections: matchSel.length? [...matchSel] : undefined };
    setResults(prev => ({ ...prev, [q.id]: r }));
  }

  function onChoiceSingle(choiceIdx) {
    const q = sessionQs[idx];
    const correctIdx = isV21(q) ? (q.correct_index ?? 0) : q.answerIndex;
    if (mode === "practice") {
      if (choiceIdx === correctIdx) {
        setChosenHistory(prev => [...prev, choiceIdx]);
        recordResult(true);
        setFirstTryCorrect(chosenHistory.length === 0);
        setTimeout(() => nextQuestion(), 250);
      } else {
        setEliminated(prev => ({ ...prev, [choiceIdx]: true }));
        setChosenHistory(prev => [...prev, choiceIdx]);
        setFirstTryCorrect(false);
      }
    } else {
      setChosenHistory([choiceIdx]);
      recordResult(choiceIdx === correctIdx);
      nextQuestion();
    }
  }

  function onCheckMulti() {
    const q = sessionQs[idx];
    const correct = scoreMulti([...multiSel].sort(), (q.correct_indices || []).slice().sort());
    if (mode === "practice") {
      setChosenHistory(prev => [...prev, -1]);
      if (correct.correct) {
        recordResult(true);
        setFirstTryCorrect(chosenHistory.length === 0);
        setTimeout(() => nextQuestion(), 250);
      } else {
        setFirstTryCorrect(false);
      }
    } else {
      setChosenHistory(multiSel);
      recordResult(correct.correct);
      nextQuestion();
    }
  }

  function onCheckMatch() {
    const q = sessionQs[idx];
    const ok = scoreMatch(matchSel, (q.pairs || []));
    if (mode === "practice") {
      setChosenHistory(prev => [...prev, -2]);
      if (ok) {
        recordResult(true);
        setFirstTryCorrect(chosenHistory.length === 0);
        setTimeout(() => nextQuestion(), 250);
      } else {
        setFirstTryCorrect(false);
      }
    } else {
      recordResult(ok);
      nextQuestion();
    }
  }

  function nextQuestion() {
    const atEnd = idx + 1 >= sessionQs.length;
    if (atEnd) { setFinished(true); setStarted(false); return; }
    setIdx(idx + 1);
    setEliminated({});
    setChosenHistory([]);
    setMultiSel([]);
    setMatchSel([]);
    setFirstTryCorrect(null);
    setQuestionStart(Date.now());
  }

  function toggleFlag() {
    const q = sessionQs[idx]; if (!q) return;
    setFlagged(prev => ({ ...prev, [q.id]: !prev[q.id] }));
  }

  function exportSummary() {
    const rows = [["id","domain","first_try_correct","tries","time_ms","chosen","question","correct","explanation"]];
    sessionQs.forEach((q) => {
      const r = results[q.id];
      const stem = isV21(q) ? (q.question || q.prompt || "") : q.question;
      let correct = "";
      if (isV21(q)) {
        if (q.item_type === "single") correct = (q.choices?.[q.correct_index ?? 0]) || "";
        if (q.item_type === "multi") correct = (q.correct_indices || []).map(i => q.choices?.[i]).join(" | ");
        if (q.item_type === "match") correct = JSON.stringify(q.pairs || []);
      } else { correct = q.choices[q.answerIndex]; }
      rows.push([
        q.id,
        q.domain,
        r ? String(r.firstTryCorrect) : "",
        r ? String(r.tries) : "",
        r ? String(r.timeMs) : "",
        r ? r.chosenHistory.join("|") : "",
        stem,
        correct,
        (isV21(q) ? (q.explanation||"") : (q.explanation||"")),
      ]);
    });
    download(`pmp_session_${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows));
  }

  function handleUpload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        if (file.name.toLowerCase().endsWith(".json")) {
          const arr = JSON.parse(text);
          if (Array.isArray(arr)) setAllQuestions(arr);
        } else {
          const qs = parseCSV(text);
          if (qs.length) setAllQuestions(qs);
        }
      } catch (err) {
        console.error("Upload parse error", err);
        alert("Could not parse file. Check console for details.");
      }
    };
    reader.readAsText(file);
  }

  const filteredCount = filtered.length;
  const current = sessionQs[idx];
  const score = useMemo(() => {
    let correctFirst = 0; let attempted = 0;
    Object.values(results).forEach(r => { attempted++; if (r.firstTryCorrect) correctFirst++; });
    return { correctFirst, attempted };
  }, [results]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">PMP Interactive Practice Exam — v2.1</h1>
            <p className="text-sm text-gray-600">Now supports multi-select, matching, rationales, and JSON banks. Auto-loads <code>/questions.json</code>. Robust CSV parser included.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button onClick={exportSummary} className="px-3 py-1.5 rounded bg-gray-900 text-white hover:opacity-90">Export session</button>
          </div>
        </header>

        {!started && !finished && (
          <section className="bg-white shadow rounded-2xl p-4 md:p-6 mb-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium mb-1">Question source</label>
                <input type="file" accept=".csv,.json" onChange={handleUpload} className="block w-full text-sm" />
                <p className="text-xs text-gray-600 mt-2">JSON schema v2.1 with <code>item_type</code>, multi-select, and matching supported. CSV legacy still works and now tolerates quotes/commas/newlines.</p>
                <p className="text-xs text-gray-600">Loaded: <strong>{allQuestions.length}</strong> • Filtered: <strong>{filteredCount}</strong></p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Mode</label>
                  <select value={mode} onChange={e=>setMode(e.target.value)} className="w-full border rounded px-2 py-1.5">
                    <option value="practice">Practice (instant)</option>
                    <option value="exam">Exam (feedback at end)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Session size</label>
                  <input type="number" value={sessionSize} min={10} max={allQuestions.length || 9999} onChange={e=>setSessionSize(Number(e.target.value))} className="w-full border rounded px-2 py-1.5" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Shuffle seed</label>
                  <input type="number" value={seed} onChange={e=>setSeed(Number(e.target.value))} className="w-full border rounded px-2 py-1.5" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Domains</label>
                  <div className="flex flex-wrap gap-2">
                    {["People","Process","Business","Agile"].map(d => (
                      <button key={d} onClick={()=>setSelectedDomains(s=>({...s, [d]: !s[d]}))} className={`px-3 py-1.5 rounded-full border ${selectedDomains[d] ? 'bg-gray-900 text-white' : 'bg-white'}`}>{d}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={beginSession} className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:opacity-90">Start session</button>
            </div>
          </section>
        )}

        {started && current && (
          <section className="bg-white shadow rounded-2xl p-4 md:p-6">
            <div className="flex items-center justify-between mb-4 text-sm text-gray-600">
              <div>Question <strong>{idx+1}</strong> of <strong>{sessionQs.length}</strong> • Domain: <strong>{current.domain}</strong></div>
              <div>First-try score: <strong>{score.correctFirst}/{score.attempted}</strong></div>
            </div>

            {isV21(current) && current.asset_url && (
              <div className="mb-3">
                <img src={current.asset_url} alt="Question asset" className="max-w-full rounded" />
              </div>
            )}

            <h2 className="text-lg md:text-xl font-semibold mb-4">{isV21(current) ? (current.question || current.prompt) : current.question}</h2>

            {/* SINGLE */}
            {(!isV21(current) || (isV21(current) && current.item_type === "single")) && (
              <div>
                <div className="grid gap-3">
                  {(current.choices || []).map((opt, i) => (
                    <button key={i} onClick={()=>onChoiceSingle(i)} disabled={!!eliminated[i]} className={`text-left border rounded-xl px-3 py-3 hover:bg-gray-50 ${eliminated[i] ? 'opacity-50 line-through' : ''}`}>
                      <span className="font-semibold mr-2">{String.fromCharCode(65+i)}.</span>{opt}
                    </button>
                  ))}
                </div>
                {mode==='practice' && firstTryCorrect===true && (<Explain q={current} />)}
                {mode==='practice' && firstTryCorrect===false && (<div className="mt-4 p-3 rounded bg-red-50 border border-red-200 text-red-800">Not quite. Try another option.</div>)}
              </div>
            )}

            {/* MULTI */}
            {isV21(current) && current.item_type === "multi" && (
              <div>
                <div className="grid gap-3">
                  {current.choices.map((opt, i) => (
                    <label key={i} className={`flex items-center gap-2 border rounded-xl px-3 py-3 ${multiSel.includes(i)?'bg-gray-50':''}`}>
                      <input type="checkbox" checked={multiSel.includes(i)} onChange={(e)=>{ setMultiSel(s=> e.target.checked ? [...s, i] : s.filter(x=>x!==i)); }} />
                      <span className="font-semibold mr-2">{String.fromCharCode(65+i)}.</span>{opt}
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button onClick={onCheckMulti} className="px-3 py-1.5 rounded border">Check answer</button>
                </div>
                {mode==='practice' && firstTryCorrect===true && (<Explain q={current} />)}
                {mode==='practice' && firstTryCorrect===false && (<div className="mt-3 p-3 rounded bg-red-50 border border-red-200 text-red-800">Keep going—choose all that apply without extras.</div>)}
              </div>
            )}

            {/* MATCH */}
            {isV21(current) && current.item_type === "match" && (
              <div>
                <div className="grid gap-2">
                  {(current.left||[]).map((leftItem, lIdx) => (
                    <div key={lIdx} className="flex gap-2 items-center">
                      <div className="w-1/2 border rounded px-3 py-2 bg-gray-50">{leftItem}</div>
                      <select className="w-1/2 border rounded px-2 py-2" value={matchSel[lIdx] ?? ""} onChange={e=>{
                        const v = e.target.value === "" ? -1 : Number(e.target.value);
                        setMatchSel(s=>{ const n=[...s]; n[lIdx]=v; return n; });
                      }}>
                        <option value="">Select…</option>
                        {(current.right||[]).map((rItem, rIdx)=>(<option key={rIdx} value={rIdx}>{rItem}</option>))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button onClick={onCheckMatch} className="px-3 py-1.5 rounded border">Check matches</button>
                </div>
                {mode==='practice' && firstTryCorrect===true && (<Explain q={current} />)}
                {mode==='practice' && firstTryCorrect===false && (<div className="mt-3 p-3 rounded bg-red-50 border border-red-200 text-red-800">One or more pairs don’t match—adjust and try again.</div>)}
              </div>
            )}

            <div className="flex items-center gap-3 mt-4">
              <button onClick={toggleFlag} className="px-3 py-1.5 rounded border">{flagged[current.id] ? 'Unflag' : 'Flag for review'}</button>
              <button onClick={nextQuestion} className="px-3 py-1.5 rounded border">Next (N)</button>
            </div>
          </section>
        )}

        {finished && (
          <section className="bg-white shadow rounded-2xl p-4 md:p-6">
            <h2 className="text-xl font-bold mb-4">Session summary</h2>
            <div className="grid md:grid-cols-3 gap-4 mb-6">
              <Stat label="Questions" value={String(sessionQs.length)} />
              <Stat label="First-try correct" value={`${score.correctFirst}`} />
              <Stat label="Accuracy (first try)" value={`${sessionQs.length ? Math.round((score.correctFirst/sessionQs.length)*100) : 0}%`} />
            </div>
            {mode==='exam' && (
              <div className="mb-6">
                <h3 className="font-semibold mb-2">Review</h3>
                <ul className="space-y-2">
                  {sessionQs.map((q, i) => {
                    const r = results[q.id];
                    const correct = r && r.firstTryCorrect;
                    const isNew = isV21(q);
                    const isSingle = isNew ? q.item_type === 'single' : true;
                    const isMulti = isNew && q.item_type === 'multi';
                    const isMatch = isNew && q.item_type === 'match';
                    return (
                      <li key={q.id} className={`p-3 rounded border ${correct ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                        <div className="text-sm text-gray-600 mb-1">Q{i+1} • {q.domain}</div>
                        <div className="font-medium mb-1">{isNew ? (q.question || q.prompt) : q.question}</div>
                        {isSingle && (
                          <div className="text-sm">Correct: <strong>{(isNew ? q.choices?.[q.correct_index ?? 0] : q.choices[q.answerIndex])}</strong></div>
                        )}
                        {isMulti && (
                          <div className="text-sm">Correct: <strong>{(q.correct_indices || []).map(ii=> q.choices[ii]).join(" | ")}</strong></div>
                        )}
                        {isMatch && (
                          <div className="text-sm">Correct pairs: <code>{JSON.stringify(q.pairs)}</code></div>
                        )}
                        {isNew && q.rationales && (
                          <ul className="mt-2 text-sm list-disc ml-5">
                            {q.rationales.map((ra,i2)=>(<li key={i2}>{ra}</li>))}
                          </ul>
                        )}
                        {(isNew ? q.explanation : q.explanation) && (
                          <div className="text-sm mt-1 text-gray-700">{isNew ? q.explanation : q.explanation}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-3 mt-4">
              <button onClick={exportSummary} className="px-4 py-2 rounded-xl bg-gray-900 text-white hover:opacity-90">Export summary CSV</button>
              <button onClick={()=>{ setFinished(false); setStarted(false); }} className="px-4 py-2 rounded-xl border">Back to settings</button>
            </div>
          </section>
        )}

        <section className="mt-8 text-sm text-gray-600">
          <h3 className="font-semibold mb-2">How to bundle your v2.1 JSON bank</h3>
          <ol className="list-decimal ml-5 space-y-1">
            <li>Place your file at <code>public/questions.json</code>. The app will auto-load it on start.</li>
            <li>CSV still works for legacy banks, but JSON unlocks multi-select, matching, rationales, and assets.</li>
            <li>Use the upload control above to hot-swap a bank without rebuilding.</li>
          </ol>
        </section>

        {/* CSV parser self-tests (for sanity) */}
        <section className="mt-8 text-xs text-gray-500">
          <details>
            <summary>CSV parser self-tests</summary>
            <pre className="mt-2 whitespace-pre-wrap">{runCsvTests()}</pre>
          </details>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="p-4 rounded-2xl border bg-gray-50">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function Explain({ q }) {
  const isNew = q && typeof q === 'object' && 'item_type' in q;
  const exp = isNew ? q.explanation : q.explanation;
  const rats = isNew ? q.rationales : undefined;
  return (
    <div className="mt-4 p-3 rounded bg-green-50 border border-green-200 text-green-800">
      <div className="font-medium">Correct.</div>
      {rats && (
        <ul className="text-gray-800 mt-1 list-disc ml-5">
          {rats.map((r,i)=>(<li key={i}>{r}</li>))}
        </ul>
      )}
      {exp && <div className="text-gray-700 mt-1">{exp}</div>}
    </div>
  );
}

// ----------------- DEV TESTS -----------------
function runCsvTests() {
  try {
    const samples = {
      basic: "id,domain,question,a,b,c,d,correct\nQ1,People,What?,A,B,C,D,A\n",
      quotes: "id,domain,question,a,b,c,d,correct\nQ2,Process,\"A, tricky\" question,\"A,1\",B,C,D,B\n",
      escapedQuote: "id,domain,question,a,b,c,d,correct\nQ3,Business,He said \"\"Yes\"\" today,A,B,C,D,C\n",
      newlineInField: "id,domain,question,a,b,c,d,correct\nQ4,People,\"Line1\nLine2\",A,B,C,D,D\n",
      numericCorrect: "id,domain,question,a,b,c,d,correct\nU5,Agile,Numeric correct index,A,B,C,D,2\n",
      malformedUnmatched: "id,domain,question,a,b,c,d,correct\nU6,People,\"Unmatched,A,B,C,D,A\n",
    };

    const results = Object.entries(samples).map(([name, csv]) => {
      const out = parseCSV(csv);
      return `${name}: ${out.length} row(s) parsed; id=${out[0]?.id || '-'}, q=${out[0]?.question?.slice(0,20) || '-'}...`;
    }).join("\n");

    return results + "\n(All tests executed)";
  } catch (e) {
    return "CSV tests failed: " + (e && e.message ? e.message : String(e));
  }
}
