const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8e7dbe', '#f4a261', '#457b9d', '#c06c84'];

function colorFor(name = '') {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export default function Avatar({ name, online, group }) {
  return (
    <span className="avatar" style={{ background: colorFor(name) }} aria-hidden="true">
      {group ? '👥' : (name?.[0] ?? '?').toUpperCase()}
      {online && <span className="online-dot" />}
    </span>
  );
}
