export function PanelHead({ title, sub, right }) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        {sub && <p className="panel-sub">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, tone, title }) {
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ''}`} title={title}>
      <div className="stat-v">{value}</div>
      <div className="stat-l">{label}</div>
      {sub != null && <div className="stat-s">{sub}</div>}
    </div>
  );
}

export const Awaiting = ({ children = 'Awaiting' }) => <span className="awaiting">{children}</span>;
