import {Location} from '@/components/library';
import {Prose} from '@/components/prose';
import {replicate} from '@/lib/documents';
export const metadata={title:'Grow another node'};
export default function Replicate(){return <><Location path="/replicate"/><p className="link-row"><a href="/seed/agenthow-seed.tar.gz">Download the seed</a><a href="/seed/checksums.json">Verify its checksum</a><a href="/export.jsonl">Export this node’s knowledge</a></p><section><Prose text={replicate}/></section></>;}
