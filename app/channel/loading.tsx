export default function ChannelLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="در حال بارگذاری شبکه‌ها"
      style={{
        minHeight: '60vh',
        padding: '32px',
        background: 'var(--bg, #0f0f0f)',
        color: 'var(--muted, #888)',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'Tahoma, Arial, sans-serif',
      }}
    >
      در حال بارگذاری شبکه‌ها…
    </main>
  );
}
