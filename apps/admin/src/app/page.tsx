import { messages } from '@splash360/i18n';

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1>{messages.admin.title}</h1>
    </main>
  );
}
