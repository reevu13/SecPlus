'use client';

import { useMemo, useState } from 'react';
import { ChapterPack, MistakeCard, Question } from '@/lib/types';
import RetryQuestion from '@/components/RetryQuestion';
import { getMistakeCardDueAt } from '@/lib/progress';

interface Props {
  card: MistakeCard;
  question?: Question;
  pack?: ChapterPack;
  onRetry: (cardId: string, result: { correct: boolean; unsure: boolean }) => void;
}

export default function MistakeCardItem({ card, question, pack, onRetry }: Props) {
  const [showRetry, setShowRetry] = useState(false);
  const remediationLinks = card.remediation ?? [];

  const confusionPair = useMemo(() => {
    if (!pack?.enrichment || !card.confusion_pair_id) return null;
    return pack.enrichment.confusion_pairs.find((pair) => pair.id === card.confusion_pair_id) ?? null;
  }, [pack, card.confusion_pair_id]);

  return (
    <div className="card">
      <div className="panel-header">
        <div>
          <div className="tag">{card.status.toUpperCase()}</div>
          <div style={{ fontWeight: 700, marginTop: 6 }}>{card.prompt}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="chip">Type {card.question_type.replace('_', ' ')}</div>
          <div className="chip">Hints {card.hints_used ? 'used' : 'none'}</div>
          <div className="chip">Due {new Date(getMistakeCardDueAt(card)).toLocaleDateString()}</div>
          <div className="chip">Interval {card.interval}d</div>
        </div>
      </div>

      <div className="answer-card" style={{ marginTop: 10 }}>
        <div className="tag">Your answer</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{card.my_answer}</div>
      </div>

      <div className="answer-card" style={{ marginTop: 10 }}>
        <div className="tag">Correct answer</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{card.correct_answer}</div>
      </div>

      <div className="answer-card" style={{ marginTop: 10 }}>
        <div className="tag">Rule of thumb</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{card.rule_of_thumb}</div>
      </div>

      <div className="answer-card" style={{ marginTop: 10 }}>
        <div className="tag">Micro-example</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{card.micro_example}</div>
      </div>

      {(card.objectiveIds.length > 0 || card.misconceptionTags.length > 0) && (
        <div className="answer-card" style={{ marginTop: 10 }}>
          <div className="tag">Learning signals</div>
          <div className="flex" style={{ marginTop: 8 }}>
            {card.objectiveIds.map((objectiveId) => (
              <div key={objectiveId} className="chip">Objective {objectiveId}</div>
            ))}
            {card.misconceptionTags.map((tag) => (
              <div key={tag} className="chip">Misconception: {tag}</div>
            ))}
          </div>
        </div>
      )}

      {confusionPair && (
        <div className="answer-card" style={{ marginTop: 10 }}>
          <div className="tag">Confusion Pair</div>
          <div style={{ fontWeight: 700 }}>{confusionPair.title}</div>
          <div className="grid" style={{ gap: 6, marginTop: 6 }}>
            <div><b>{confusionPair.a.term}:</b> {confusionPair.a.definition}</div>
            <div><b>{confusionPair.b.term}:</b> {confusionPair.b.definition}</div>
            <ul style={{ marginTop: 6 }}>
              {confusionPair.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        {remediationLinks.map((link) => (
          <a key={link.href} className="button secondary" href={link.href}>
            {link.label || 'Review lesson'}
          </a>
        ))}
        <button className="button" onClick={() => setShowRetry((prev) => !prev)} disabled={!question}>
          {showRetry ? 'Hide retry' : 'Retry now'}
        </button>
        <div className="stat-pill">Ease {card.ease.toFixed(2)}</div>
        <div className="stat-pill">Lapses {card.lapses}</div>
      </div>

      {showRetry && question && (
        <RetryQuestion
          question={question}
          onResult={(result) => {
            onRetry(card.id, result);
            setShowRetry(false);
          }}
        />
      )}
    </div>
  );
}
