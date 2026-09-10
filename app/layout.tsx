import './globals.css';

export const metadata={title:'MOMSAT — Persian Live TV',description:'Persian live TV discovery platform'};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="fa" dir="rtl"><head><script dangerouslySetInnerHTML={{__html:"if(typeof window!=='undefined'&&!(window as any).HTMLInput){(window as any).HTMLInput=window.HTMLInputElement;}"}} /></head><body>{children}</body></html>
}