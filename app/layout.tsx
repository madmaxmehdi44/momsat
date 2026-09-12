import './globals.css';
import BrowserCompatibility from '../components/BrowserCompatibility';
import InteractionFeedback from '../components/InteractionFeedback';
import HomeVisualHardening from '../components/HomeVisualHardening';
import MomsatAppChrome from '../components/MomsatAppChrome';
import PersistentPlayerProvider from '../components/PersistentPlayerProvider';
import BrowsePlayerGuard from '../components/BrowsePlayerGuard';

export const metadata = {
  title: 'MOMSAT — Persian Live TV',
  description: 'Persian live TV discovery platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <BrowserCompatibility />
        <HomeVisualHardening />
        <PersistentPlayerProvider>
          <BrowsePlayerGuard />
          <MomsatAppChrome>{children}</MomsatAppChrome>
        </PersistentPlayerProvider>
        <InteractionFeedback />
        <style dangerouslySetInnerHTML={{ __html: `
          main[class*="YouTubeBrowseShellV2_main"] {
            min-width: 0;
            padding: 20px 24px 90px;
            direction: rtl;
          }
          [class*="YouTubeBrowseShellV2_heroButton"] {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            min-height: 39px;
            width: fit-content;
            margin-top: 20px;
            padding: 0 15px;
            border: 0;
            border-radius: 8px;
            background: #fff;
            color: #111;
            font: 900 11px Tahoma, Arial, sans-serif;
            cursor: pointer;
            transition: transform .18s, background .18s;
          }
          [class*="YouTubeBrowseShellV2_heroButton"]:hover {
            background: #e8e8e8;
            transform: translateY(-1px);
          }
          @media (max-width: 1050px) {
            main[class*="YouTubeBrowseShellV2_main"] { padding: 16px 18px 80px; }
          }
          @media (max-width: 650px) {
            main[class*="YouTubeBrowseShellV2_main"] { padding: 12px 10px 90px; }
            [class*="YouTubeBrowseShellV2_heroButton"] { min-height: 35px; margin-top: 14px; padding: 0 11px; }
          }
        ` }} />
      </body>
    </html>
  );
}
