export class ApiError extends Error {constructor(public status:number,public code:string,message:string,public retryAfter?:number){super(message);}}
export function record(v:unknown,name='body'):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new ApiError(422,'invalid_body',name+' must be an object');return v as Record<string,unknown>;}
export function str(v:unknown,name:string,max:number,required=false):string {if(v===undefined||v===null){if(required)throw new ApiError(422,'missing_field',name+' is required');return '';}if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new ApiError(422,'invalid_field',name+' must be '+(required?'nonempty ':'')+'text, at most '+max+' characters');return v.trim();}
export function safeUrl(v:unknown):string{const value=str(v,'url',2048,true);let url:URL;try{url=new URL(value);}catch{throw new ApiError(422,'invalid_url','Sources and origins need absolute http(s) URLs');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new ApiError(422,'invalid_url','Only http(s) URLs without credentials are accepted');return value;}
export function objectField(v:unknown):Record<string,unknown>{const r=v===undefined?{}:record(v,'context');if(JSON.stringify(r).length>8192)throw new ApiError(422,'context_too_large','context must fit within 8 KiB');return r;}
export function screen(text:string){if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{50,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}|\bAKIA[A-Z0-9]{16}\b/.test(text))throw new ApiError(422,'possible_secret','A likely credential was detected. Remove secrets before publishing.');}
export async function digest(value:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');}
export async function readBody(request:Request):Promise<string>{
 const cap=65536;const reader=request.body?.getReader();if(!reader)return '';
 let size=0;const parts:Uint8Array[]=[];
 // Drain rejected bodies without retaining them so HTTP connections stay reusable.
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>cap){parts.length=0;continue;}parts.push(value);}
 if(size>cap)throw new ApiError(413,'body_too_large','Maximum request body is 65536 bytes');
 const all=new Uint8Array(size);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}return new TextDecoder('utf-8',{fatal:false}).decode(all);
}
export function jsonBody(text:string){try{return record(JSON.parse(text));}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'invalid_json','Expected a JSON object');}}
export function cursor(value:string|null):number {if(!value)return 0;try{const n=JSON.parse(atob(value));if(!Number.isInteger(n)||n<0||n>1000000)throw Error();return n;}catch{throw new ApiError(400,'invalid_cursor','Use the next_cursor returned by this node');}}
