import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
if(!existsSync('wrangler.node.json'))throw Error('Run scripts/configure-node.mjs first');
for(const [cmd,args] of [['npm',['run','build']],['npx',['wrangler','d1','migrations','apply','DB','--remote','--config','wrangler.node.json']],['npx',['wrangler','deploy','--config','dist/server/wrangler.json']]]){const r=spawnSync(cmd,args,{stdio:'inherit',env:{...process.env,AGENTHOW_STANDALONE:'1'}});if(r.status!==0)process.exit(r.status||1);}
