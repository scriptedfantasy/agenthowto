import {writeFileSync,existsSync} from 'node:fs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>x.startsWith('--')?[...a,[x.slice(2),all[i+1]]]:a,[]));
if(!args.origin||!args['database-id'])throw Error('Supply --origin and --database-id');
const origin=new URL(args.origin);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Use a plain http(s) node origin');
if(!/^[0-9a-f-]{36}$/i.test(args['database-id']))throw Error('Expected the D1 database UUID returned by Wrangler');
const name=args.name||'agenthow';if(!/^[a-z0-9-]{1,50}$/.test(name))throw Error('Use a lowercase worker name');
writeFileSync('agenthow.config.json',JSON.stringify({name:'AgentHow',origin:origin.origin,protocol:'agenthow/0.1',includeDemoNotes:true},null,2)+'\n');
writeFileSync('wrangler.node.json',JSON.stringify({name,main:'vinext/server/fetch-handler',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_name:name,database_id:args['database-id'],migrations_dir:'drizzle'}]},null,2)+'\n');
console.log('Configured independent node at '+origin.origin+'. No publishing credentials were copied.');
