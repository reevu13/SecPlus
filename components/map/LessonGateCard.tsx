'use client';

type LessonGateCardProps = {
  threshold: number;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export default function LessonGateCard({ threshold, enabled, onChange }: LessonGateCardProps) {
  return (
    <section className="card campaign-gate-card">
      <div className="campaign-gate-left">
        <div className="tag">Lesson Gate</div>
        <div className="campaign-gate-title">Require lesson completion before missions</div>
        <div className="campaign-gate-copy">
          Missions stay locked until lesson modules are complete or chapter mastery reaches the target.
        </div>
      </div>

      <div className="campaign-gate-right">
        <span className="campaign-tooltip" title={`Mastery ${threshold}+ unlocks missions even if pages are incomplete.`}>
          Mastery {threshold}+ required
        </span>
        <label className="campaign-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>
    </section>
  );
}
