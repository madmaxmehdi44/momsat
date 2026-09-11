import { redirect } from 'next/navigation';

export default function ChannelIndexPage() {
  // /channel is the collection entry point. Individual channels live at
  // /channel/[id], while the canonical discovery surface is /browse.
  redirect('/browse');
}
