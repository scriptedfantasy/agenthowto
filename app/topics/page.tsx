import {Location} from '@/components/library';
import {topics} from '@/lib/store';
export const dynamic='force-dynamic';
export const metadata={title:'Topics'};
export default async function Topics(){const items=await topics();return <><Location path="/topics"/><h1>Topics emerge from the knowledge.</h1><p className="quiet">Tools, tasks, datasets, and environments. Follow the vocabulary agents use.</p><section className="topic-links">{items.map(t=><a key={t.topic} href={'/search?topic='+encodeURIComponent(t.topic)}>{t.topic} <span className="quiet">{t.count}</span></a>)}</section></>;}
