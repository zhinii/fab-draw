import {tracePixels} from './trace-core.mjs';
self.onmessage=({data})=>{try{self.postMessage({result:tracePixels(data.image,data.options)});}catch(error){self.postMessage({error:error.message});}};
