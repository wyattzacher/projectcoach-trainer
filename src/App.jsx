import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * If you already have your own quiz data/logic, replace ONLY the places marked with
 *  // TODO: hook into your existing logic
 * and keep the JSX/styling.
 */

// ---- Sample data (safe fallback). Replace with your loader/parsing if you have one. ----
const SAMPLE_QUESTIONS = [
  {
    id: "q1",
    question: "A project is behind schedule due to unexpected vendor delays. What should the PM do first?",
    choices: [
      "Crash the schedule by adding more resources immediately",
      "Update the risk register and evaluate response options",
      "Escalate to the sponsor for a decision",
      "Re-baseline without consulting stakeholders",
    ],
    answerIndex: 1,
    domain: "Risk",
  },
  {
    id: "q2",
    question: "Which artifact best tracks benefits realization after project closure?",
    choices: [
      "Stakeholder register",
      "Benefits management plan",
      "Project charter",
      "Issue log",
    ],
    answerIndex: 1,
    domain: "Business Value",
  },
];

// ---- Helpers ----
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function useQuizEngine(initial = SAMPLE_QUESTIONS) {
  // TODO: hook into your existing parser/loader if you already load from CSV/XLSX
  const [questions, setQuestions] = useState(initial);
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState(null); // "practice" | "exam"
  const [answers, setAnswers] = useState({}); // id -> choiceIndex
  const [eliminated, setEliminated] = useState({}); // id -> Set(choiceIndex)

  const current = questions[idx] ?? null;
  const total = questions.length;
  const correctCount = useMemo(
    () =>
      Object.entries(answers).reduce((acc, [qid, choiceIndex]) => {
        const q = questions.find(q => q.id === qid);
        return acc + (q && q.answerIndex === choiceIndex ? 1 : 0);
      }, 0),
    [answers, questions]
  );

  const progressPercent = total ? Math.round(((idx + 1) / total) * 100) : 0;

  function startPractice() {
    setMode("practice");
    setStarted(true);
  }
  function startExam() {
    setMode("exam");
    setStarted(true);
  }
  function resetAll() {
    setMode(null);
    setStarted(false);
    setIdx(0);
    setAnswers({});
    setEliminated({});
  }

  function toggleEliminate(choiceIndex) {
    if (!current) return;
    setEliminated(prev => {
      const set = new Set(prev[current.id] || []);
      if (set.has(choiceIndex)) set.delete(choiceIndex);
      else set.add(choiceIndex);
      return { ...prev, [current.id]: Array.from(set) };
    });
  }

  function choose(choiceIndex) {
    if (!current) return;
    setAnswers(a => ({ ...a, [current.id]: choiceIndex }));
    if (mode === "exam") {
      // auto-advance on exam mode if not last
      setTimeout(() => {
        setIdx(i => clamp(i + 1, 0, total - 1));
      }, 150);
    }
  }

  function next() { setIdx(i => clamp(i + 1, 0, total - 1)); }
  function prev() { setIdx(i => clamp(i - 1, 0, total - 1)); }

  function exportCSV() {
    // TODO: if you already had an exportSummary, call that instead
    const header = ["Question", "Chosen", "Correct", "IsCorrect", "Domain"];
    const rows = questions.map(q => {
      const chosen = answers[q.id] ?? "";
      const chosenText = chosen !== "" ? q.choices[chosen] : "";
      const correctText = q.choices[q.answerIndex];
      const isCorrect = chosen !== "" ? (chosen === q.answerIndex ? "Yes" : "No") : "";
      return [q.question, chosenText, correctText, isCorrect, q.domain ?? ""];
    });
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pmp_practice_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return {
    state: {
      started, mode, current, idx, total, answers, eliminated,
      correctCount, progressPercent, questions
    },
    actions: {
      startPractice, startExam, resetAll, toggleEliminate, choose, next, prev, exportCSV
    }
  };
}

export default function App() {
  const { state, actions } = useQuizEngine();
  const { started, mode, current, idx, total, answers, eliminated, correctCount, progressPercent } = state;

  // Keep any AdSense tags in index.html; this component doesn’t touch them.
  const percent = progressPercent;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur glass">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">PMP Practice Trainer</h1>
          <div className="flex items-center gap-2">
            <button className="btn-ghost btn" onClick={actions.exportCSV}>Export CSV</button>
            <button className="btn btn-danger" onClick={actions.resetAll} title="Reset">Reset</button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-4xl px-4 py-6">
        {/* Intro / Controls */}
        {!started && (
          <section className="card p-5">
            <h2 className="text-lg font-semibold">Get started</h2>
            <p className="text-sm text-gray-600 mt-1">
              Use sample questions or load your own. Ads remain enabled from <code>index.html</code>.
            </p>

            {/* TODO: hook your own file upload/parse if you have it */}
            <div className="mt-4">
              <label className="block text-sm font-medium">Question source</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn btn-ghost">Use sample</button>
                {/* <input type="file" className="hidden" /> */}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={actions.startPractice}>Start Practice</button>
              <button className="btn btn-ghost" onClick={actions.startExam}>Start Exam</button>
            </div>
          </section>
        )}

        {/* Progress */}
        {started && (
          <div className="mt-6">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
              <span>Question {Math.min(idx + 1, total)} of {total || "—"}</span>
              <span>{correctCount} correct</span>
            </div>
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {/* Question Card */}
        {started && current && (
          <section className="card p-5 mt-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-base sm:text-lg font-semibold leading-snug">{current.question}</h2>
              {current.domain && (
                <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 text-xs font-medium px-2 py-1 border border-blue-200">
                  {current.domain}
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-2">
              {current.choices.map((c, i) => {
                const chosen = answers[current.id];
                const isEliminated = (eliminated[current.id] || []).includes(i);
                const isChosen = chosen === i;
                const isCorrect = chosen !== undefined && i === current.answerIndex;
                const wasChosenWrong = chosen !== undefined && isChosen && i !== current.answerIndex;

                return (
                  <div
                    key={i}
                    className={[
                      "choice",
                      isEliminated ? "choice--disabled" : "",
                      isCorrect ? "choice--correct" : "",
                      wasChosenWrong ? "choice--wrong" : ""
                    ].join(" ").trim()}
                  >
                    <button
                      className="btn btn-ghost px-2 py-1"
                      title={isEliminated ? "Restore choice" : "Eliminate choice"}
                      onClick={() => actions.toggleEliminate(i)}
                    >
                      {isEliminated ? "↺" : "✕"}
                    </button>
                    <button
                      className="flex-1 text-left"
                      onClick={() => actions.choose(i)}
                      disabled={isEliminated}
                    >
                      <span className="font-medium mr-2">{String.fromCharCode(65 + i)}.</span>
                      <span>{c}</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                {mode === "practice" && answers[current.id] !== undefined && (
                  <span>
                    {answers[current.id] === current.answerIndex ? (
                      <span className="text-green-600 font-medium">Correct</span>
                    ) : (
                      <span className="text-red-600 font-medium">Incorrect</span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button className="btn btn-ghost" onClick={actions.prev} disabled={idx === 0}>Previous</button>
                <button className="btn btn-primary" onClick={actions.next} disabled={idx >= total - 1}>Next</button>
              </div>
            </div>
          </section>
        )}

        {/* Empty state when out of questions */}
        {started && !current && (
          <section className="card p-5 mt-6 text-center">
            <h3 className="text-lg font-semibold">All done!</h3>
            <p className="text-gray-600 mt-1">You answered {correctCount} out of {total} correctly.</p>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn btn-primary" onClick={actions.exportCSV}>Export CSV</button>
              <button className="btn btn-ghost" onClick={actions.resetAll}>Restart</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
