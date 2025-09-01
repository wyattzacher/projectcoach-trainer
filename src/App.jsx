import React, { useEffect, useState } from 'react';

/**
 * ProjectCoach Trainer application.
 *
 * This app loads a default question bank from `/questions.csv` on start. If
 * `CONFIG.requireEmail` is true the user must provide an email address and
 * give consent before taking the practice exam. The exam supports both
 * practice mode (with instant feedback) and exam mode (feedback at the end).
 * Optional ad slots and an interstitial appear every 10 questions when
 * `CONFIG.adsEnabled` is true. At the end of a session learners can leave a
 * rating and comment which can be sent to a webhook. Session results can be
 * downloaded as a CSV file for review.
 */

// Application configuration. Adjust these values before building.
const CONFIG = {
  requireEmail: true,
  emailWebhook: '',
  reviewWebhook: '',
  adsEnabled: true,
};

// Helper to parse a simple CSV string into an array of question objects.
// This parser assumes each line of the CSV has the following columns:
// id,domain,question,a,b,c,d,correct,explanation,reference
function parseCSV(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const rows = lines.slice(1);
  return rows
    .map((line) => {
      const parts = line.split(',');
      if (parts.length < 9) return null;
      const [id, domain, question, a, b, c, d, correct, explanation, reference] = parts;
      const choices = [a, b, c, d];
      const answerIndex = { A: 0, B: 1, C: 2, D: 3 }[correct?.trim().toUpperCase()] ?? 0;
      return {
        id: id.trim(),
        domain: domain.trim(),
        question: question.trim(),
        choices: choices.map((t) => t.trim()),
        answerIndex,
        explanation: explanation ? explanation.trim() : '',
        reference: reference ? reference.trim() : '',
      };
    })
    .filter(Boolean);
}

// Fisher–Yates shuffle. When a seed is provided a linear congruential generator
// is used for deterministic shuffling.
function shuffle(array, seed) {
  const arr = array.slice();
  let m = arr.length;
  let i;
  let rand = seed;
  const random = () => {
    rand = (rand * 16807) % 2147483647;
    return rand / 2147483647;
  };
  while (m) {
    i = Math.floor((seed ? random() : Math.random()) * m--);
    [arr[m], arr[i]] = [arr[i], arr[m]];
  }
  return arr;
}

// Simplified results to CSV: no quoting or escaping of commas.
function resultsToCSV(results, questions) {
  const header = ['id','question','yourAnswer','correctAnswer','firstTry','explanation'];
  const csvLines = [header.join(',')];
  questions.forEach((q) => {
    const res = results[q.id] || {};
    const yourAnswer = res.selected != null ? ['A','B','C','D'][res.selected] : '';
    const correctAnswer = ['A','B','C','D'][q.answerIndex];
    const firstTry = res.firstTry === true ? 'Yes' : res.firstTry === false ? 'No' : '';
    const row = [q.id, q.question, yourAnswer, correctAnswer, firstTry, q.explanation].join(',');
    csvLines.push(row);
  });
  return new Blob([csvLines.join('\n')], { type:'text/csv' });
}

export default function App() {
  // Question bank and loading state
  const [bank, setBank] = useState([]);
  const [loadingBank, setLoadingBank] = useState(true);
  const [error, setError] = useState('');

  // Email gating state
  const [email, setEmail] = useState(() => localStorage.getItem('projectcoach_email') || '');
  const [consent, setConsent] = useState(() => localStorage.getItem('projectcoach_consent') === 'true');
  const emailSubmitted = CONFIG.requireEmail ? email && consent : true;

  // Session configuration
  const [selectedDomain, setSelectedDomain] = useState('All');
  const [sessionSize, setSessionSize] = useState(20);
  const [practiceMode, setPracticeMode] = useState(true);
  const [seed, setSeed] = useState(() => Date.now());

  // Session state
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [sessionQuestions, setSessionQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [results, setResults] = useState({});
  const [firstTry, setFirstTry] = useState(true);
  const [disabledChoices, setDisabledChoices] = useState([]);
  const [showInterstitial, setShowInterstitial] = useState(false);

  // Review state
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewSent, setReviewSent] = useState(false);

  // Load the CSV file on mount
  useEffect(() => {
    async function loadCSV() {
      try {
        const response = await fetch('/questions.csv');
        const text = await response.text();
        const qs = parseCSV(text);
        setBank(qs);
      } catch (err) {
        console.error(err);
        setError('Failed to load questions.');
      } finally {
        setLoadingBank(false);
      }
    }
    loadCSV();
  }, []);

  // Submit email to webhook if needed
  const submitEmail = async () => {
    if (!email || !consent) return;
    try {
      localStorage.setItem('projectcoach_email', email);
      localStorage.setItem('projectcoach_consent', String(consent));
      if (CONFIG.emailWebhook) {
        await fetch(CONFIG.emailWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, consent, ts: new Date().toISOString() }),
        });
      }
    } catch (err) {
      console.error('Email submission failed', err);
    }
  };

  // Start a new session based on current configuration
  const beginSession = () => {
    if (!bank.length) return;
    let pool = bank;
    if (selectedDomain !== 'All') {
      pool = bank.filter((q) => q.domain === selectedDomain);
    }
    if (!pool.length) return;
    const shuffled = shuffle(pool, seed);
    const pick = shuffled.slice(0, Math.min(sessionSize, shuffled.length));
    // Shuffle answer choices per question
    const sessionQs = pick.map((q) => {
      const order = shuffle([0, 1, 2, 3], Math.floor(Math.random() * 2147483647));
      const newChoices = [q.choices[order[0]], q.choices[order[1]], q.choices[order[2]], q.choices[order[3]]];
      const newAnswerIndex = order.indexOf(q.answerIndex);
      return { ...q, choices: newChoices, answerIndex: newAnswerIndex };
    });
    setSessionQuestions(sessionQs);
    setResults({});
    setDisabledChoices([]);
    setFirstTry(true);
    setCurrentIdx(0);
    setStarted(true);
    setFinished(false);
    setShowInterstitial(false);
  };

  // Handle answer selection
  const handleAnswer = (choiceIdx) => {
    const q = sessionQuestions[currentIdx];
    const qid = q.id;
    if (practiceMode) {
      if (choiceIdx === q.answerIndex) {
        // correct answer
        setResults((prev) => ({
          ...prev,
          [qid]: {
            selected: choiceIdx,
            firstTry,
          },
        }));
        nextQuestion();
      } else {
        if (firstTry) setFirstTry(false);
        setDisabledChoices((prev) => [...prev, choiceIdx]);
      }
    } else {
      setResults((prev) => ({
        ...prev,
        [qid]: {
          selected: choiceIdx,
        },
      }));
      nextQuestion();
    }
  };

  // Move to next question or finish
  const nextQuestion = () => {
    const nextIndex = currentIdx + 1;
    if (nextIndex >= sessionQuestions.length) {
      setFinished(true);
      setStarted(false);
    } else {
      if (CONFIG.adsEnabled && nextIndex % 10 === 0) {
        setShowInterstitial(true);
      }
      setCurrentIdx(nextIndex);
      setFirstTry(true);
      setDisabledChoices([]);
    }
  };

  // Submit review
  const submitReview = async () => {
    try {
      if (CONFIG.reviewWebhook) {
        await fetch(CONFIG.reviewWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email || null,
            rating,
            comment,
            ts: new Date().toISOString(),
          }),
        });
      }
      setReviewSent(true);
    } catch (err) {
      console.error('Review submission failed', err);
    }
  };

  // Download results as CSV
  const downloadResults = () => {
    const blob = resultsToCSV(results, sessionQuestions);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'session_results.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Rating button class helper
  const ratingButtonClass = (n) => {
    return rating === n ? 'bg-blue-600 text-white' : 'bg-gray-100';
  };

  // Renderers
  if (loadingBank) {
    return <div className="p-6 text-center">Loading questions…</div>;
  }
  if (error) {
    return <div className="p-6 text-center text-red-600">{error}</div>;
  }
  // Email gating view
  if (!emailSubmitted) {
    return (
      <div className="flex flex-col items-center mt-12 space-y-6 px-4">
        <h1 className="text-3xl font-bold">Enter your email to begin</h1>
        <p className="max-w-md text-center text-gray-600">
          We’ll send you occasional project management tips and let you know when
          new question banks are available. You can unsubscribe at any time.
        </p>
        <div className="w-full max-w-sm">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-2 border rounded-md mb-3"
          />
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>I consent to receive emails from ProjectCoach.</span>
          </label>
          <button
            className="mt-4 w-full py-2 px-4 bg-blue-600 text-white rounded-md disabled:bg-gray-400"
            disabled={!email || !consent}
            onClick={submitEmail}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }
  // Configuration screen
  if (!started && !finished) {
    const domains = ['All', ...Array.from(new Set(bank.map((q) => q.domain)))];
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">ProjectCoach Exam Trainer</h1>
        <p className="text-gray-700">
          Select your desired domain, question count and mode then click Start
          Practice.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block mb-1 font-semibold">Domain</label>
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="w-full p-2 border rounded-md"
            >
              {domains.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-1 font-semibold">Questions per session</label>
            <input
              type="number"
              value={sessionSize}
              min={1}
              max={bank.length}
              onChange={(e) => setSessionSize(Number(e.target.value))}
              className="w-full p-2 border rounded-md"
            />
            <small className="text-gray-500">Available: {bank.length}</small>
          </div>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="mode"
                checked={practiceMode}
                onChange={() => setPracticeMode(true)}
              />
              <span>Practice</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="mode"
                checked={!practiceMode}
                onChange={() => setPracticeMode(false)}
              />
              <span>Exam</span>
            </label>
          </div>
          <button
            className="py-2 px-4 bg-green-600 text-white rounded-md"
            onClick={beginSession}
          >
            Start Practice
          </button>
        </div>
      </div>
    );
  }
  // Interstitial overlay
  const interstitial = (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-md text-center">
        <h2 className="text-xl font-bold mb-4">Advertisement</h2>
        <p className="mb-4 text-gray-700">
          Your ad could be here. Support this site by clicking through!
        </p>
        <button
          className="py-2 px-4 bg-blue-600 text-white rounded-md"
          onClick={() => setShowInterstitial(false)}
        >
          Continue
        </button>
      </div>
    </div>
  );
  // Active session view
  if (started && !finished) {
    const q = sessionQuestions[currentIdx];
    const total = sessionQuestions.length;
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6 relative">
        {CONFIG.adsEnabled && (
          <div className="mb-4 text-center py-2 bg-gray-200 rounded">
            Top Ad Placeholder
          </div>
        )}
        <div className="flex justify-between items-baseline">
          <h2 className="text-xl font-semibold">
            Question {currentIdx + 1} of {total}
          </h2>
          <span className="text-sm text-gray-600">
            {practiceMode ? 'Practice mode' : 'Exam mode'}
          </span>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="mb-4 font-medium">{q.question}</p>
          <div className="space-y-3">
            {q.choices.map((choice, idx) => (
              <button
                key={idx}
                className={`w-full text-left px-4 py-2 border rounded-md ${
                  disabledChoices.includes(idx)
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
                disabled={disabledChoices.includes(idx)}
                onClick={() => handleAnswer(idx)}
              >
                <span className="font-semibold mr-2">{String.fromCharCode(65 + idx)}.</span>
                {choice}
              </button>
            ))}
          </div>
          {practiceMode && disabledChoices.length > 0 && (
            <p className="mt-4 text-red-600">Incorrect, please try again.</p>
          )}
        </div>
        {CONFIG.adsEnabled && (
          <div className="mt-4 text-center py-2 bg-gray-200 rounded">
            Inline Ad Placeholder
          </div>
        )}
        {showInterstitial && interstitial}
      </div>
    );
  }
  // Summary view
  if (finished) {
    const total = sessionQuestions.length;
    let correctCount = 0;
    let firstTryCorrect = 0;
    sessionQuestions.forEach((q) => {
      const res = results[q.id];
      if (res && res.selected === q.answerIndex) {
        correctCount++;
        if (res.firstTry) firstTryCorrect++;
      }
    });
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Session Summary</h1>
        <p>
          You answered {correctCount} out of {total} questions correctly. First-try
          correct answers: {firstTryCorrect}.
        </p>
        {!reviewSent && (
          <div className="bg-white p-4 rounded-lg shadow space-y-4">
            <h2 className="text-lg font-semibold">Rate the question quality</h2>
            <div className="flex space-x-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={`px-3 py-1 rounded-full border ${ratingButtonClass(n)}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <textarea
              className="w-full p-2 border rounded-md"
              placeholder="Leave an optional comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button
              className="py-2 px-4 bg-green-600 text-white rounded-md"
              onClick={submitReview}
            >
              Submit Review
            </button>
          </div>
        )}
        {reviewSent && (
          <div className="p-4 bg-green-100 text-green-700 rounded-md">
            Thank you for your feedback!
          </div>
        )}
        <div>
          <h2 className="text-lg font-semibold mb-2">Question Review</h2>
          <div className="space-y-4">
            {sessionQuestions.map((q, index) => {
              const res = results[q.id] || {};
              const yourAnswer = res.selected != null ? ['A','B','C','D'][res.selected] : '-';
              const correctAnswer = ['A','B','C','D'][q.answerIndex];
              const correct = yourAnswer === correctAnswer;
              return (
                <div key={q.id} className="p-4 border rounded-md bg-white">
                  <p className="font-medium mb-1">
                    {index + 1}. {q.question}
                  </p>
                  <p className={correct ? 'text-green-600' : 'text-red-600'}>
                    Your answer: {yourAnswer} | Correct answer: {correctAnswer}
                  </p>
                  {practiceMode && (
                    <p className="text-gray-700 mt-2">
                      <strong>Explanation:</strong> {q.explanation}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex space-x-4">
          <button
            className="py-2 px-4 bg-blue-600 text-white rounded-md"
            onClick={() => {
              setFinished(false);
              setStarted(false);
              setResults({});
            }}
          >
            New Session
          </button>
          <button
            className="py-2 px-4 bg-gray-600 text-white rounded-md"
            onClick={downloadResults}
          >
            Download Results
          </button>
        </div>
      </div>
    );
  }
  return null;
}
