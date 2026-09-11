import './globals.css';
import BrowserCompatibility from '../components/BrowserCompatibility';
import InteractionFeedback from '../components/InteractionFeedback';
import PersistentPlayerProvider from '../components/PersistentPlayerProvider';

export const metadata = {
  title: 'MOMSAT — Persian Live TV',
  description: 'Persian live TV discovery platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <BrowserCompatibility />
        <PersistentPlayerProvider>
          {children}
        </PersistentPlayerProvider>
        <InteractionFeedback />
      </body>
    </html>
  );
}