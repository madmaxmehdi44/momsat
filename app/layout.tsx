import './globals.css';
import './momsat-theme.css';
import './theme-polish.css';
import BrowserCompatibility from '../components/BrowserCompatibility';
import InteractionFeedback from '../components/InteractionFeedback';
import HomeVisualHardening from '../components/HomeVisualHardening';
import MomsatAppChrome from '../components/MomsatAppChrome';
import PersistentPlayerProvider from '../components/PersistentPlayerProvider';
import BrowsePlayerGuard from '../components/BrowsePlayerGuard';
import ThemeSync from '../components/ThemeSync';

export const metadata = {
  title: 'MOMSAT — Persian Live TV',
  description: 'Persian live TV discovery platform',
  icons: { icon: '/icon.svg', shortcut: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <ThemeSync />
        <BrowserCompatibility />
        <HomeVisualHardening />
        <PersistentPlayerProvider>
          <BrowsePlayerGuard />
          <MomsatAppChrome>{children}</MomsatAppChrome>
        </PersistentPlayerProvider>
        <InteractionFeedback />
      </body>
    </html>
  );
}
