/* global React, BU_DATA, BU_METRO, BU_METRO_TEXT, BU_LESSON, BU_PROGRESS, ConceptInteractive */
// ─────────────────────────────────────────────────────────────────
// SCREEN · LESSON PAGE — the full lesson for a stop (Learn → Full lesson)
//
// Everything the ride teaches in beats, on one page and at full length:
// why it matters, the idea and its key equations, how it works, an example,
// where it's used, the common mistakes, a hands-on simulation where one
// exists, a quick check that feeds spaced repetition, and further reading.
// Content and rendering come from lesson-kit.jsx (BU_LESSON). The side
// panel is the ride itself: every stop, where you are, and the way back.
// Replaces the old Walk screen (screens/walk.jsx), which stays as a fallback.
// ─────────────────────────────────────────────────────────────────

const { useState, useEffect, useMemo } = React;

// The generated quizzes read "True/false: this statement matches the wiki
// definition of 'Raw_Id'" with a cut-off answer; ask it plainly instead.
function cleanQuiz(q, node, name) {
  if (!q || !Array.isArray(q.choices) || !q.choices.length) return null;
  const fix = t => String(t || "").split(node).join(name)
    .replace(/\s*\n\s*(\d+[.)]|[-*])?\s*$/, "").replace(/:\s*$/, "…").trim();
  const templ = /^true\/false: this statement matches the wiki definition of/i.test(q.q || "");
  return {
    q: templ ? `Which of these describes ${name}?` : fix(q.q),
    choices: q.choices.map(fix),
    correct: q.correct,
    why: templ ? `That's how the source page defines ${name}.` : fix(q.why),
  };
}

function QuickCheck({ quiz, node }) {
  const { mdInline } = BU_LESSON;
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const [card, setCard] = useState(null);
  useEffect(() => { setPicked(null); setChecked(false); setCard(null); }, [node]);
  const right = checked && picked === quiz.correct;
  const check = () => {
    setChecked(true);
    // SM-2 quality from the answer (agents/spaced_repetition.py): right → 4, wrong → 2
    if (window.BU_PROGRESS) setCard(BU_PROGRESS.rate(node, picked === quiz.correct ? 4 : 2));
  };
  return (
    <div className="metro-quiz">
      <p className="metro-quiz-q" id="metro-quiz-q">{mdInline(quiz.q, "q")}</p>
      <div role="radiogroup" aria-labelledby="metro-quiz-q" className="metro-quiz-choices">
        {quiz.choices.map((c, i) => {
          const state = !checked ? (picked === i ? " picked" : "") : i === quiz.correct ? " right" : picked === i ? " wrong" : "";
          return (
            <button key={i} type="button" role="radio" aria-checked={picked === i} disabled={checked}
                    className={"metro-choice" + state} onClick={() => setPicked(i)}>
              <span aria-hidden="true">{String.fromCharCode(65 + i)}</span>
              <span>{mdInline(c, "c" + i)}</span>
            </button>
          );
        })}
      </div>
      {!checked
        ? <button type="button" className="metro-btn dark" disabled={picked === null} onClick={check}>Check</button>
        : (
          <p className="metro-quiz-result" role="status">
            <b>{right ? "Right." : "Not quite."}</b> {mdInline(quiz.why, "w")}
            {card && <> It comes back for review {BU_METRO_TEXT.when(card)}.</>}
          </p>
        )}
    </div>
  );
}

function MetroLesson({ tour, idx, onAdvance, onJumpTo, onRide, onBranch, onSummit, onShow3D, onPapers }) {
  const { BeatBody } = BU_LESSON;
  const net = BU_METRO.network();
  const stop = tour[idx];
  const node = stop.node;
  const kit = useMemo(() => BU_LESSON.lessonKit(node), [node]);
  const { name, lesson, card } = kit;
  const nameOf = id => (net.byId[id] ? net.byId[id].name : String(id).replace(/_/g, " "));
  const line = net.lineOfCluster[stop.cluster] || (net.byId[node] && net.lineOfCluster[net.byId[node].cluster]);
  const color = line ? line.color : "#d4351c";
  const changes = net.changesAt(node).filter(c => c !== line);
  const quiz = cleanQuiz(lesson.quiz && lesson.quiz[0], node, name);
  const Sim = window.lessonExerciseFor ? window.lessonExerciseFor(node) : "generic";
  const papers = BU_METRO_TEXT.papersFor(node);
  const sources = (lesson.evidence || []).filter(e => /^wiki\//.test(e));
  const has = key => kit.beats.some(b => b.key === key);
  const last = idx >= tour.length - 1;
  const P = window.BU_PROGRESS;

  useEffect(() => { window.scrollTo(0, 0); }, [node]);

  return (
    <div className="metro metro-page metro-stack metro-lesson">
      <div className="metro-lesson-grid">
        <article className="metro-card metro-pad metro-lesson-main" aria-labelledby="lesson-title">
          <span className="metro-ride-tag">
            Stop {idx + 1} of {tour.length}
            {line && <> · <i style={{ background: color }} />{line.name} line</>}
          </span>
          <h1 id="lesson-title" className="metro-h1">{name}</h1>

          {has("why") && (
            <section className="metro-lesson-sec" aria-labelledby="lesson-why">
              <h2 id="lesson-why" className="metro-h2">Why it matters</h2>
              <BeatBody kit={kit} beat="why" />
            </section>
          )}

          <section className="metro-lesson-sec" aria-labelledby="lesson-idea">
            <h2 id="lesson-idea" className="metro-h2">The idea</h2>
            <BeatBody kit={kit} beat="idea" />
          </section>

          {has("how") && (
            <section className="metro-lesson-sec" aria-labelledby="lesson-how">
              <h2 id="lesson-how" className="metro-h2">How it works</h2>
              <BeatBody kit={kit} beat="how" />
            </section>
          )}

          {has("ideas") && (
            <section className="metro-lesson-sec" aria-labelledby="lesson-ideas">
              <h2 id="lesson-ideas" className="metro-h2">Key ideas</h2>
              <BeatBody kit={kit} beat="ideas" />
            </section>
          )}

          {Sim !== "generic" && typeof Sim === "function" && (
            <section className="metro-lesson-sec" aria-labelledby="lesson-try">
              <h2 id="lesson-try" className="metro-h2">Try it</h2>
              <div className="metro-sim">{React.createElement(Sim)}</div>
            </section>
          )}

          {has("traps") && (
            <section className="metro-lesson-sec" aria-labelledby="lesson-traps">
              <h2 id="lesson-traps" className="metro-h2">Common mistakes</h2>
              <BeatBody kit={kit} beat="traps" />
            </section>
          )}

          <section className="metro-lesson-sec" aria-labelledby="lesson-check">
            <h2 id="lesson-check" className="metro-h2">Check yourself</h2>
            <BeatBody kit={kit} beat="check" />
            {quiz && <QuickCheck quiz={quiz} node={node} />}
          </section>

          {Sim === "generic" && typeof ConceptInteractive !== "undefined" && kit.ideas.length > 0 && (
            <details className="metro-lesson-sec metro-practise">
              <summary>Practise with flashcards</summary>
              <div className="metro-sim"><ConceptInteractive lesson={lesson} /></div>
            </details>
          )}

          {(papers.length > 0 || sources.length > 0 || (card && card.related)) && (
            <section className="metro-lesson-sec" aria-labelledby="lesson-more">
              <h2 id="lesson-more" className="metro-h2">Read more</h2>
              {card && card.related && <p className="metro-note" style={{ marginBottom: 8 }}>Related ideas: {card.related.join(" · ")}</p>}
              {papers.length > 0 && (
                <ul className="metro-reading">
                  {papers.slice(0, 4).map(p => (
                    <li key={p.url}><a href={p.url} target="_blank" rel="noopener noreferrer">{p.title}</a>{p.year ? ` (${p.year})` : ""}</li>
                  ))}
                </ul>
              )}
              {papers.length > 0 && onPapers && (
                <button type="button" className="metro-linkbtn" onClick={() => onPapers(node)}>
                  {papers.length > 4 ? `${papers.length} papers mention this · open Research` : "Open these in Research"}
                </button>
              )}
              {sources.length > 0 && <p className="metro-note">Source: {sources.join(", ")}</p>}
            </section>
          )}

          <div className="metro-lesson-nav">
            <div>
              {idx > 0 && <button type="button" className="metro-btn ghost" onClick={() => onAdvance(-1)}>‹ {nameOf(tour[idx - 1].node)}</button>}
            </div>
            <div>
              <button type="button" className="metro-btn ghost" onClick={onRide}>Back to the ride</button>
              {!last && <button type="button" className="metro-btn primary" onClick={() => onAdvance(1)}>Next stop ›</button>}
              {last && onSummit && <button type="button" className="metro-btn primary" onClick={onSummit}>Finish the ride ★</button>}
            </div>
          </div>
        </article>

        <aside className="metro-card metro-pad metro-lesson-side" aria-label="Your ride">
          <h2 className="metro-h2">Your ride</h2>
          <ol className="metro-stoplist">
            {tour.map((s, i) => {
              const L = net.lineOfCluster[s.cluster], c = L ? L.color : "#d4351c";
              const done = P && P.isDone(s.node), here = i === idx;
              return (
                <li key={s.node + i}>
                  <div aria-hidden="true" className="metro-rail">
                    <span style={{ background: i === tour.length - 1 ? "transparent" : c }} />
                    <i style={{ borderColor: c, background: done || here ? c : "#ffffff" }} />
                  </div>
                  <div className="metro-stop">
                    <button type="button" className="metro-stopbtn" aria-current={here ? "step" : undefined}
                            onClick={() => onJumpTo(i)} style={{ fontWeight: here ? 700 : 600, color: here ? "#14171a" : "#51575e" }}>
                      {nameOf(s.node)}
                    </button>
                  </div>
                  <span className="metro-when">{here ? "here" : done ? "✓ done" : ""}</span>
                </li>
              );
            })}
          </ol>
          {changes.length > 0 && (
            <div className="metro-ride-change" style={{ marginTop: 10 }}>
              <span>Change here for the {BU_METRO.listAnd(changes.map(c => c.name))} {changes.length > 1 ? "lines" : "line"}</span>
              {onBranch && <button type="button" className="metro-btn ghost" onClick={() => onBranch(node)}>Change lines</button>}
            </div>
          )}
          <div className="metro-side-actions">
            <button type="button" className="metro-btn dark" onClick={onRide}>Back to the ride</button>
            {onShow3D && <button type="button" className="metro-linkbtn" onClick={onShow3D}>See it on the 3D brain</button>}
          </div>
        </aside>
      </div>
    </div>
  );
}

window.MetroLesson = MetroLesson;
