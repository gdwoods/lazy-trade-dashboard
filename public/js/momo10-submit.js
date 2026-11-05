export async function submitMomo10Trade(payload) {
  const res = await fetch('/api/momo10/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Submit failed');
  return json;
}
