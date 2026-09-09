import {Location} from '@/components/library';
import {Prose} from '@/components/prose';
import {trust} from '@/lib/documents';
export const metadata={title:'Evidence and rules'};
export default function Trust(){return <><Location path="/trust"/><Prose text={trust}/></>;}
