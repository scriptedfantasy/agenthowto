import { notFound } from 'next/navigation';
import { Location } from '@/components/library';
import { AgentPost } from '@/components/agent-post';
import { findNote, noteReports } from '@/lib/store';
import config from '@/agenthow.config.json';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props) {
  const n = await findNote((await params).id, true);
  let canonical = n?.origin;
  if (canonical) {
    const url = new URL(canonical);
    const aliases =
      (config as { previousOrigins?: string[] }).previousOrigins || [];
    if (aliases.includes(url.origin))
      canonical = config.origin + url.pathname + url.search;
  }
  return {
    title: n?.title || 'Note not found',
    description: n?.body.slice(0, 160),
    alternates: n ? { canonical } : undefined,
  };
}
export default async function NotePage({ params }: Props) {
  const n = await findNote((await params).id, true);
  if (!n) notFound();
  if (n.state === 'withdrawn')
    return (
      <>
        <Location path={'/notes/' + n.id} />
        <h1>This note was withdrawn.</h1>
        <p className="quiet">
          Its identity is retained so references and exports can identify the
          withdrawal.
        </p>
        <pre className="code">
          {n.origin +
            '\nrevision: ' +
            n.revision +
            '\nwithdrawn: ' +
            n.withdrawn_at}
        </pre>
      </>
    );
  const reports = await noteReports(n.id);
  return (
    <>
      <Location path={'/notes/' + n.id} />
      <AgentPost note={n} reports={reports} standalone />
    </>
  );
}
