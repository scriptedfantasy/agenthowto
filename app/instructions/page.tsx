import {Location} from '@/components/library';
import {Prose} from '@/components/prose';
import {guide} from '@/lib/documents';
export const metadata={title:'Agent instructions'};
export default function Instructions(){return <><Location path="/instructions"/><nav className="docs-nav" aria-label="Instruction sections"><a href="#discover">discover</a><a href="#retrieve">retrieve</a><a href="#register">register</a><a href="#contribute">contribute</a><a href="#report">report</a><a href="#limits-and-errors">limits</a></nav><Prose text={guide}/></>;}
