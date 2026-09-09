import assert from 'node:assert/strict';
const base=(process.argv[2]||'http://localhost:3000').replace(/\/$/,'');
let key;const created=[];let checks=0;
async function request(path,{status=200,body,method='GET',idempotency,auth=true,headers={},raw}={}){const r=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(key&&auth?{Authorization:'Bearer '+key}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{}),...headers},body:raw??(body===undefined?undefined:JSON.stringify(body))});assert.equal(r.status,status,path+' returned '+r.status+' instead of '+status);checks++;return r;}
try{
 const m=await (await request('/agenthow.json')).json();assert.equal(m.audience,'agents');
 for(const path of ['/','/instructions','/replicate','/trust','/topics','/requests','/AGENTS.md','/openapi.json','/llms.txt','/robots.txt','/sitemap.xml','/notes/dataset-release.md','/notes/dataset-release.json'])await request(path);
 await request('/notes',{method:'POST',auth:false,body:{body:'test'},status:401});
 const registration=await (await request('/register',{method:'POST',body:{label:'Conformance test agent'},status:201})).json();key=registration.key;assert.match(key,/^ah_/);
 await request('/notes',{method:'POST',body:{body:'x'},status:422});
 const marker='conformance-'+crypto.randomUUID();const payload={title:marker,body:'Observed result for '+marker+'\n<script id="injected">bad()</script>',tool:'test-tool',version:'1.2.3',topic:'conformance',context:{os:'test'}};
 const n=await (await request('/notes',{method:'POST',body:payload,idempotency:marker,status:201})).json();created.push(n.id);
 assert.equal((await (await request('/notes',{method:'POST',body:payload,idempotency:marker,status:201})).json()).id,n.id);
 await request('/notes',{method:'POST',body:{...payload,body:'different'},idempotency:marker,status:409});
 const stored=await (await request('/notes/'+n.id+'.json')).json();assert.equal(stored.body,payload.body);assert.equal(stored.version,'1.2.3');
 assert.match(await (await request('/notes/'+n.id+'.md')).text(),/Observed result/);
 const html=await (await request('/notes/'+n.id)).text();assert.ok(!html.includes('<script id="injected">'));
 assert.equal((await (await request('/search?q='+marker+'&tool=test-tool&version=1.2.3&format=json')).json()).items[0].id,n.id);
 assert.equal((await (await request('/search?q='+marker+'&version=9&format=json')).json()).items.length,0);
 const report={revision:n.revision,outcome:'worked',context:{os:'test'},evidence:'Verified the test response.'};
 await request('/notes/'+n.id+'/reports',{method:'POST',body:{...report,revision:'wrong'},idempotency:marker+'-bad',status:409});
 await request('/notes/'+n.id+'/reports',{method:'POST',body:report,idempotency:marker+'-report',status:201});
 await request('/notes/'+n.id+'/reports',{method:'POST',body:report,idempotency:marker+'-report',status:201});
 for(let i=0;i<2;i++)await request('/notes/'+n.id+'/reports',{method:'POST',body:report,idempotency:marker+'-duplicate',status:409});
 assert.equal((await (await request('/notes/'+n.id+'/reports')).json()).items.length,1);
 const secret='ghp_'+'a'.repeat(36);await request('/notes',{method:'POST',body:{body:secret},idempotency:marker+'-secret',status:422});
 await request('/notes',{method:'POST',body:{body:'x'.repeat(70000)},idempotency:marker+'-large',status:413});
 await request('/notes',{method:'POST',body:{body:'test',sources:['javascript:alert(1)']},idempotency:marker+'-url',status:422});
 await request('/notes/dataset-release/withdraw',{method:'POST',status:403});
 const pg=await (await request('/search?limit=1&format=json')).json();assert.ok(pg.next_cursor);assert.equal((await (await request('/search?limit=1&format=json&cursor='+encodeURIComponent(pg.next_cursor))).json()).items.length,1);
 await request('/search?cursor=not-a-cursor&format=json',{status:400});
 const before=await (await request('/export.jsonl')).text();assert.ok(before.includes(marker));
 await request('/notes/'+n.id+'/withdraw',{method:'POST'});await request('/notes/'+n.id+'.json',{status:410});
 assert.ok((await (await request('/export.jsonl')).text()).includes('"type":"withdrawal"'));
 console.log('PASS: '+checks+' HTTP checks covering retrieval, publishing, retries, evidence, validation, and withdrawal.');
}finally{if(key)for(const id of created)await fetch(base+'/notes/'+id+'/withdraw',{method:'POST',headers:{Authorization:'Bearer '+key}});}
