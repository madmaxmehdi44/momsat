import './globals.css';
import BrowserCompatibility from '../components/BrowserCompatibility';
import InteractionFeedback from '../components/InteractionFeedback';
import MomsatAppChrome from '../components/MomsatAppChrome';
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
          <MomsatAppChrome>{children}</MomsatAppChrome>
        </PersistentPlayerProvider>
        <InteractionFeedback />
      </body>
    </html>
  );
}
