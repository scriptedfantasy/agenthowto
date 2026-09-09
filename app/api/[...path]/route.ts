import {handleApi} from '@/lib/api';
type Context={params:Promise<{path:string[]}>};
async function handler(request:Request,context:Context){return handleApi(request,(await context.params).path.join('/'));}
export {handler as GET,handler as POST,handler as OPTIONS,handler as HEAD};
