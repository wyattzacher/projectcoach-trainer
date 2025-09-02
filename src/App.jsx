// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import { parseCSV, shuffle, toCSV, download } from "./lib/trainerUtils";

const DOMAINS = ["People", "Process", "Business", "Agile"];

function isV21(q) {
  return q && typeof q === "object" && ("item_type" in q || "correct_index" in q);
}

export default function App() {
  const [allQuestions, setAllQuestions] = useState([]);
  const [selectedDomains, setSelectedDomains] = useState({
    People: true, Process: true, Business: true, Agile: true,
  });
  const [mode, setMode] = useState("practice"); // "practice" | "exam"
  const [sessionSize, setSessionSize] = useState(40);
  const [seed, setSeed] = useState(42);

  const [sessionQs, setSessionQs] = useState([]);
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  const [eliminated, setEliminated] = useState({});
  const [chosenHistory, setChosenHistory] = useState([]);
  const [firstTryCorrect, setFirstTryCorrect] = useState(null);
  const [results, setResults] = useState({});
  const [flagged, setFlagged] = useState({});
  const [questionStart, setQuestionStart] = useState(null);

  // Load default bank: /questions.json -> /questions.csv
  useEffect(() => {
    (async () => {
      try {
        const rj = await fetch("/questions.json", { cache: "no-store" });
        if (rj.ok) {
          const data = await rj.json();
          if (Array.isArray(data) && data.length) { setAllQuestions(data); return; }
        }
      } catch {}
      try {
        const rc = await fetch("/questions.csv", { cache: "no-store" });
        if (rc.ok) {
          const text = await rc.text();
          const qs = parseCSV(text);
          if (qs.length) setAllQuestions(qs);
        }
      } catch {}
    })();
  }, []);

  const filtered = useMemo(
    () => allQuestions.filter(q => q && q.domain && selectedDomains[q.domain]),
    [allQuestions, selectedDomains]
  );

  function startSession() {
    const pool = shuffle(filtered, seed);
    const pick = pool.slice(0, Math.min(sessionSize, pool.length));
    setSessionQs(pick);
    setIdx(0);
    setStarted(true);
    setFinished(false);
    setResults({});
    setEliminated({});
    setChosenHistory([]);
    setFirstTryCorrect(null);
    setQuestionStart(Date.now());
  }

  const q = sessionQs[idx];
  const progressPct = started ? Math.round((idx / Math.max(1, sessionQs.length)) * 100) : 0;

  function correctIndex(question) {
    return isV21(question) ? (question.correct_index ?? 0) : question.answerIndex;
  }

  function recordResult(isCorrect) {
    const question = q;
    if (!question) return;
    const tries = Math.max(1, chosenHistory.length || 1);
    setResults(prev => ({
      ...prev,
      [question.id]: {
        id: question.id,
        firstTryCorrect: !!(isCorrect && tries === 1),
        tries,
        timeMs: questionStart ? Date.now() - questionStart : 0,
        chosenHistory: [...chosenHistory],
      }
    }));
  }

  function onChoice(choiceIdx) {
    const correct = correctIndex(q);
    if (mode === "practice") {
      if (choiceIdx === correct) {
        setChosenHistory(prev => [...prev, choiceIdx]);
        recordResult(true);
        setFirstTryCorrect(chosenHistory.length === 0);
        setTimeout(nextQuestion, 220);
      } else {
        setEliminated(prev => ({ ...prev, [choiceIdx]: true }));
        setChosenHistory(prev => [...prev, choiceIdx]);
        setFirstTryCorrect(false);
      }
    } else {
      setChosenHistory([choiceIdx]);
      recordResult(choiceIdx === correct);
      nextQuestion();
    }
  }

  function nextQuestion() {
    const atEnd = idx + 1 >= sessionQs.length;
    if (atEnd) { setStarted(false); setFinished(true); return; }
    setIdx(i => i + 1);
    setEliminated({});
    setChosenHistory([]);
    setFirstTryCorrect(null);
    setQuestionStart(Date.now());
  }

  function toggleFlag() {
    if (!q) return;
    setFlagged(prev => ({ ...prev, [q.id]: !prev[q.id] }));
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
        alert("Could not parse file.");
      }
    };
    reader.readAsText(file);
  }

  function exportSummary() {
    const rows = [["id","domain","first_try_correct","tries","time_ms","chosen","question","correct","explanation"]];
    sessionQs.forEach((question) => {
      const r = results[question.id];
      const stem = isV21(question) ? (question.question || question.prompt || "") : question.question;
      const cIdx = correctIndex(question);
      const correct = question?.choices?.[cIdx] ?? "";
      rows.push([
        question.id,
        question.domain || "",
        r ? String(r.firstTryCorrect) : "",
        r ? String(r.tries) : "",
        r ? String(r.timeMs) : "",
        r ? r.chosenHistory.join("|") : "",
        stem || "",
        correct || "",
        question.explanation || ""
      ]);
    });
    download(`pmp_session_${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows));
  }

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">PMP Practice Trainer</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={exportSummary}
              className="text-sm px-3 py-1.5 rounded-md bg-neutral-900 text-white hover:opacity-90 disabled:opacity-40"
              disabled={!finished && !started}
            >
              Export
            </button>
          </div>
        </div>
        {started && (
          <div className="h-1 w-full bg-neutral-200">
            <div className="h-1 bg-blue-600 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {/* Setup */}
        {!started && !finished && (
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="block text-sm font-medium">Question source</label>
                <input type="file" accept=".csv,.json" onChange={handleUpload} className="block w-full text-sm" />
                <div className="text-xs text-neutral-600">
                  Loaded: <strong>{allQuestions.length}</strong> • Filtered: <strong>{filtered.length}</strong>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium">Mode</label>
                  <select value={mode} onChange={e=>setMode(e.target.value)} className="w-full border rounded-md px-2 py-1.5">
                    <option value="practice">Practice (instant)</option>
                    <option value="exam">Exam (review at end)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">Session size</label>
                  <input
                    type="number"
                    value={sessionSize}
                    min={10}
                    max={allQuestions.length || 9999}
                    onChange={e=>setSessionSize(Number(e.target.value))}
                    className="w-full border rounded-md px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">Shuffle seed</label>
                  <input
                    type="number"
                    value={seed}
                    onChange={e=>setSeed(Number(e.target.value))}
                    className="w-full border rounded-md px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">Domains</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {DOMAINS.map(d => (
                      <button
                        key={d}
                        onClick={()=>setSelectedDomains(s => ({ ...s, [d]: !s[d] }))}
                        className={`px-3 py-1.5 rounded-full border text-sm ${
                          selectedDomains[d] ? "bg-neutral-900 text-white" : "bg-white"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-6">
              <button
                onClick={startSession}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:opacity-90 disabled:opacity-40"
                disabled={filtered.length === 0}
              >
                Start
              </button>
            </div>
          </section>
        )}

        {/* Question */}
        {started && q && (
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between text-sm text-neutral-600 mb-4">
              <div>Q <strong>{idx + 1}</strong> / {sessionQs.length} • <strong>{q.domain}</strong></div>
              <div>
                First-try correct:{" "}
                <strong>{Object.values(results).filter(r=>r.firstTryCorrect).length}</strong>
              </div>
            </div>

            <h2 className="text-xl font-semibold mb-5 leading-snug">
              {isV21(q) ? (q.question || q.prompt) : q.question}
            </h2>

            <div className="grid gap-3">
              {(q.choices || []).map((opt, i) => {
                const disabled = !!eliminated[i];
                return (
                  <button
                    key={i}
                    onClick={() => onChoice(i)}
                    disabled={disabled}
                    className={`text-left border rounded-xl px-4 py-3 hover:bg-neutral-50 transition ${
                      disabled ? "opacity-50 line-through" : ""
                    }`}
                  >
                    <span className="font-semibold mr-2">{String.fromCharCode(65 + i)}.</span>
                    {opt}
                  </button>
                );
              })}
            </div>

            {mode === "practice" && firstTryCorrect === false && (
              <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-800">
                Not quite. Try another option.
              </div>
            )}

            {mode === "practice" && firstTryCorrect === true && (
              <div className="mt-4 p-3 rounded-md bg-green-50 border border-green-200 text-green-800">
                Correct. {q.explanation ? <span className="text-neutral-800"> {q.explanation}</span> : null}
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button onClick={toggleFlag} className="px-3 py-1.5 rounded-md border">
                {flagged[q.id] ? "Unflag" : "Flag for review"}
              </button>
              <button onClick={nextQuestion} className="px-3 py-1.5 rounded-md border">
                Next
              </button>
            </div>
          </section>
        )}

        {/* Summary */}
        {finished && (
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-3">Session summary</h2>
            <div className="grid md:grid-cols-3 gap-4 mb-6">
              <Stat label="Questions" value={String(sessionQs.length)} />
              <Stat
                label="First-try correct"
                value={String(Object.values(results).filter(r => r.firstTryCorrect).length)}
              />
              <Stat
                label="Accuracy (first try)"
                value={
                  sessionQs.length
                    ? `${Math.round((Object.values(results).filter(r=>r.firstTryCorrect).length / sessionQs.length) * 100)}%`
                    : "0%"
                }
              />
            </div>

            {mode === "exam" && (
              <div className="border rounded-lg p-3">
                <h3 className="font-medium mb-2">Review answers</h3>
                <ul className="space-y-2">
                  {sessionQs.map((q,i) => {
                    const r = results[q.id];
                    const cIdx = correctIndex(q);
                    return (
                      <li key={q.id} className="p-3 rounded-md border">
                        <div className="text-xs text-neutral-600 mb-1">Q{i+1} • {q.domain}</div>
                        <div className="font-medium mb-1">{isV21(q) ? (q.question || q.prompt) : q.question}</div>
                        <div className="text-sm">
                          Correct: <strong>{q?.choices?.[cIdx] ?? ""}</strong>
                        </div>
                        {q.explanation && <div className="text-sm mt-1 text-neutral-700">{q.explanation}</div>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button onClick={exportSummary} className="px-4 py-2 rounded-xl bg-neutral-900 text-white hover:opacity-90">
                Export summary CSV
              </button>
              <button onClick={() => { setFinished(false); setStarted(false); }} className="px-4 py-2 rounded-xl border">
                Back to settings
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="p-4 rounded-xl border bg-neutral-50">
      <div className="text-xs text-neutral-600">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
