'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import QuestionFlow from '@/components/QuestionFlow';
import { ChapterPack, Question, RunQuestionResult } from '@/lib/types';
import { usePacks } from '@/lib/usePacks';

const smokePack = {
  pack_id: 'ops_qf_smoke_pack',
  progression: {
    xp_rules: {
      base_xp_per_correct: 100,
      streak_bonus_per_5: 15,
      time_bonus_threshold_seconds: 45,
      time_bonus_xp: 20,
      mistake_penalty_xp: 0
    }
  },
  trap_list: [],
  enrichment: {
    confusion_pairs: [],
    tag_rules: {}
  }
} as unknown as ChapterPack;

const smokeQuestions: Array<{ key: string; label: string; question: Question }> = [
  {
    key: 'mcq',
    label: 'MCQ',
    question: {
      id: 'ops-qf-mcq',
      type: 'mcq',
      stem: 'Which control best reduces phishing login risk?',
      explanation: 'Phishing-resistant MFA reduces account takeover even after credential theft.',
      tags: ['auth.mfa', 'social.phishing'],
      objectiveIds: ['2.3'],
      rationaleCorrect: 'Phishing-resistant MFA blocks replay of stolen passwords and OTP prompts.',
      rationaleIncorrect: {
        A: 'Password complexity does not stop real-time phishing proxies.',
        B: 'Longer session timeout can reduce exposure window but does not prevent initial compromise.',
        D: 'User banners are awareness aids, not strong technical controls.'
      },
      misconceptionTags: ['mfa_strength'],
      difficulty: 2,
      estimated_seconds: 45,
      options: {
        A: 'Enforce 16-character passwords only',
        B: 'Increase session timeout to 8 hours',
        C: 'Use phishing-resistant MFA for privileged access',
        D: 'Add a warning banner to the login page'
      },
      answer: 'C'
    }
  },
  {
    key: 'multi_select',
    label: 'Multi-select',
    question: {
      id: 'ops-qf-multi',
      type: 'multi_select',
      stem: 'Select controls that reduce lateral movement after endpoint compromise.',
      explanation: 'Segmentation and least privilege constrain attacker movement between systems.',
      tags: ['network.segmentation', 'iam.least_privilege'],
      objectiveIds: ['3.2'],
      rationaleCorrect: 'Both selected controls limit pivot paths and privilege escalation opportunities.',
      rationaleIncorrect: {
        A: 'Flat networks speed attacker movement, not defender control.',
        B: 'Segmentation reduces east-west pivoting.',
        C: 'Least privilege reduces blast radius after credential theft.',
        D: 'Disabling logging removes detection visibility.'
      },
      misconceptionTags: ['lateral_movement_controls'],
      difficulty: 3,
      estimated_seconds: 60,
      options: {
        A: 'Keep a flat network for simpler troubleshooting',
        B: 'Apply internal network segmentation',
        C: 'Enforce least-privilege role assignments',
        D: 'Disable verbose logs to improve performance'
      },
      answers: ['B', 'C']
    }
  },
  {
    key: 'ordering',
    label: 'Ordering',
    question: {
      id: 'ops-qf-ordering',
      type: 'ordering',
      stem: 'Order the incident response steps from first to last.',
      explanation: 'Preparation and detection precede containment, then eradication/recovery and lessons learned.',
      tags: ['ir.lifecycle'],
      objectiveIds: ['4.8'],
      rationaleCorrect: 'The sequence matches standard IR lifecycle flow used in operations playbooks.',
      rationaleIncorrect: {
        Preparation: 'Preparation must come before detection and response.',
        Detection: 'Detection occurs before containment decisions.',
        Containment: 'Containment follows validated detection.',
        'Eradication and recovery': 'Eradication and recovery come after containment.',
        'Post-incident lessons learned': 'Lessons learned close the loop after recovery.'
      },
      misconceptionTags: ['ir_step_order'],
      difficulty: 2,
      estimated_seconds: 60,
      items: [
        'Containment',
        'Preparation',
        'Post-incident lessons learned',
        'Detection',
        'Eradication and recovery'
      ],
      correct_order: [
        'Preparation',
        'Detection',
        'Containment',
        'Eradication and recovery',
        'Post-incident lessons learned'
      ]
    }
  },
  {
    key: 'matching',
    label: 'Matching',
    question: {
      id: 'ops-qf-matching',
      type: 'matching',
      stem: 'Match each cryptographic objective to its meaning.',
      explanation: 'Confidentiality hides content, integrity detects tampering, and nonrepudiation proves origin.',
      tags: ['crypto.objectives'],
      objectiveIds: ['1.4'],
      rationaleCorrect: 'Each pair maps to the cryptographic property tested in Security+ scenarios.',
      rationaleIncorrect: {
        Confidentiality: 'Confidentiality protects secrecy of data.',
        Integrity: 'Integrity ensures unauthorized changes are detectable.',
        Nonrepudiation: 'Nonrepudiation provides proof of sender/action.'
      },
      misconceptionTags: ['crypto_property_mixups'],
      difficulty: 2,
      estimated_seconds: 50,
      left: ['Confidentiality', 'Integrity', 'Nonrepudiation'],
      right: [
        'Proof a sender performed an action',
        'Protection against unauthorized disclosure',
        'Assurance data was not altered'
      ],
      pairs: {
        Confidentiality: 'Protection against unauthorized disclosure',
        Integrity: 'Assurance data was not altered',
        Nonrepudiation: 'Proof a sender performed an action'
      }
    }
  }
];

function SmokeFlowCard({
  label,
  question
}: {
  label: string;
  question: Question;
}) {
  const [completed, setCompleted] = useState<RunQuestionResult[] | null>(null);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="card">
        <div className="panel-header">
          <div>
            <div className="tag">QuestionFlow smoke</div>
            <h2 style={{ margin: '8px 0 0' }}>{label}</h2>
          </div>
          <div className="chip">{question.type}</div>
        </div>
      </div>
      {completed ? (
        <div className="card">
          <div className="tag">Completed</div>
          <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
            Completed this smoke question ({completed.length} answered).
          </p>
          <button className="button secondary" onClick={() => setCompleted(null)}>
            Run again
          </button>
        </div>
      ) : (
        <QuestionFlow
          pack={smokePack}
          questions={[question]}
          mode="campaign"
          title={`QF Smoke - ${label}`}
          subtitle="Deterministic sample data."
          sessionKey={`ops:qf-smoke:${question.id}`}
          onComplete={(results) => setCompleted(results)}
        />
      )}
    </div>
  );
}

export default function QuestionFlowSmokePage() {
  const { packs, loaded } = usePacks();
  const pbqMiniQuestion = useMemo(() => {
    for (const pack of packs) {
      for (const question of pack.question_bank) {
        if (question.legacyType === 'pbq_mini') {
          return question;
        }
      }
    }
    return null;
  }, [packs]);

  const samples = useMemo(() => {
    const base = [...smokeQuestions];
    if (pbqMiniQuestion) {
      base.push({
        key: 'pbq-mini',
        label: 'PBQ Mini (legacy)',
        question: pbqMiniQuestion
      });
    }
    return base;
  }, [pbqMiniQuestion]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="tag">Ops</div>
        <h1 style={{ marginTop: 8, marginBottom: 8 }}>QuestionFlow smoke page</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Deterministic sample set with one question per interactive type (MCQ, multi-select, ordering, matching).
        </p>
        <div className="flex" style={{ marginTop: 10 }}>
          <div className="stat-pill">Samples {samples.length}</div>
          <div className="stat-pill">Legacy pbq_mini {pbqMiniQuestion ? 'present' : loaded ? 'not found' : 'checking'}</div>
          <Link href={'/ops/coverage' as Route} className="button secondary">
            Coverage ops
          </Link>
          <Link href={'/map' as Route} className="button secondary">
            Back to map
          </Link>
        </div>
      </div>

      <div className="grid" style={{ gap: 20 }}>
        {samples.map((sample) => (
          <SmokeFlowCard key={sample.key} label={sample.label} question={sample.question} />
        ))}
      </div>
    </div>
  );
}
