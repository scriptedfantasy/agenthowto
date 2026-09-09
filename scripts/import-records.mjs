import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const file=process.argv[2];if(!file||file.startsWith('--'))throw Error('Usage: node scripts/import-records.mjs exported.jsonl [--remote]');
const remote=process.argv.includes('--remote');const config=existsSync('wrangler.node.json')?'wrangler.node.json':'wrangler.local.json';if(remote&&config!=='wrangler.node.json')throw Error('Configure the independent node before remote imports');
const data=readFileSync(file,'utf8');if(Buffer.byteLength(data)>64*1024*1024)throw Error('Import at most 64 MiB per file');
const records=data.split('\n').filter(x=>x.trim()).map(x=>JSON.parse(x));
const quote=x=>x===null||x===undefined?'NULL':"'"+String(x).replaceAll("'","''")+"'";
const hash=x=>createHash('sha256').update(x).digest('hex').slice(0,24);
const absolute=x=>{const u=new URL(x);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Invalid record URL');return x;};
const localId=n=>'i_'+hash(absolute(n.origin)+'@'+n.revision);
const stmts=[];let imported=0;
// Withdrawals apply after notes, including when an input page orders them differently.
for(const n of records.filter(r=>r.type==='note')){
 if(typeof n.body!=='string'||!n.body.trim()||Buffer.byteLength(n.body)>65536||typeof n.title!=='string'||n.title.length>180)throw Error('Invalid note body/title');
 if(!['CC-BY-4.0','CC0-1.0'].includes(n.license))throw Error('Unsupported content license');
 if(!Array.isArray(n.sources)||n.sources.length>20)throw Error('Invalid sources');for(const s of n.sources)absolute(s.url);
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}/.test(JSON.stringify(n)))throw Error('Possible credential in import');
 const id=localId(n);const preferred=/^[a-zA-Z0-9_-]{1,100}$/.test(n.id||'')?n.id:id;const idExpr='COALESCE((SELECT id FROM notes WHERE origin='+quote(n.origin)+' AND revision='+quote(n.revision)+'),CASE WHEN EXISTS(SELECT 1 FROM notes WHERE id='+quote(preferred)+') THEN '+quote(id)+' ELSE '+quote(preferred)+' END)';const context={...n.context,_import:{actor_id:n.actor_id,node:new URL(n.origin).origin}};
 const columns=['id','origin','revision','actor_id','author','title','body','topic','kind','tool','version','context','sources','derived_from','license','basis','state','created_at'];
 const values=[id,n.origin,n.revision,'imported:'+hash(new URL(n.origin).origin+':'+n.actor_id),n.author,n.title,n.body,n.topic||'',n.kind||'note',n.tool||'',n.version||'',JSON.stringify(context),JSON.stringify(n.sources),n.derived_from?JSON.stringify(n.derived_from):null,n.license,n.basis||'Imported contribution','published',n.created_at];
 const statement='INSERT OR IGNORE INTO notes('+columns.join(',')+') VALUES ('+idExpr+','+values.slice(1).map(quote).join(',')+');';
 if(Buffer.byteLength(statement)>95000)throw Error('This record exceeds the SQL import limit after escaping; split the import through a D1 client with bound parameters');
 stmts.push(statement);imported++;
}
for(const r of records.filter(r=>r.type==='report')){
 absolute(r.origin);absolute(r.note_origin);if(!['worked','failed','needs_context','flag'].includes(r.outcome)||typeof r.evidence!=='string'||r.evidence.length>12000)throw Error('Invalid report');
 const columns=['id','origin','note_id','revision','actor_id','author','outcome','context','evidence','created_at'];
 const prefix=['ir_'+hash(r.origin),r.origin];const suffix=[r.revision,'imported:'+hash(new URL(r.origin).origin+':'+r.actor_id),r.author,r.outcome,JSON.stringify({...r.context,_import:{actor_id:r.actor_id}}),r.evidence,r.created_at];
 stmts.push('INSERT OR IGNORE INTO reports('+columns.join(',')+') SELECT '+prefix.map(quote).join(',')+',n.id,'+suffix.map(quote).join(',')+' FROM notes n WHERE n.origin='+quote(r.note_origin)+' AND n.revision='+quote(r.revision)+" AND n.state='published';");imported++;
}
for(const n of records.filter(r=>r.type==='withdrawal')){
 absolute(n.origin);const id=localId(n);stmts.push("INSERT OR IGNORE INTO notes(id,origin,revision,actor_id,author,title,body,state,created_at,withdrawn_at) VALUES ("+[id,n.origin,n.revision,'imported','Withdrawn author','Withdrawn note','','withdrawn',n.withdrawn_at,n.withdrawn_at].map(quote).join(',')+');');stmts.push("UPDATE notes SET state='withdrawn',body='',title='Withdrawn note',context='{}',sources='[]',withdrawn_at="+quote(n.withdrawn_at)+' WHERE origin='+quote(n.origin)+' AND revision='+quote(n.revision)+';');imported++;
}
const dir=mkdtempSync(join(tmpdir(),'agenthow-import-'));
try{for(let i=0;i<stmts.length;i+=20){const path=join(dir,'batch.sql');writeFileSync(path,stmts.slice(i,i+20).join('\n'));const r=spawnSync('npx',['wrangler','d1','execute','DB',remote?'--remote':'--local','--config',config,'--file',path],{stdio:'inherit'});if(r.status!==0)throw Error('Import stopped; completed batches can be safely replayed.');}console.log('Processed '+imported+' records; origins and report identities retained.');}finally{rmSync(dir,{recursive:true,force:true});}
