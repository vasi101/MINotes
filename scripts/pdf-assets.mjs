import {cpSync,mkdirSync} from 'node:fs';
mkdirSync('public/pdfjs',{recursive:true});
for(const directory of ['cmaps','standard_fonts','wasm'])cpSync(`node_modules/pdfjs-dist/${directory}`,`public/pdfjs/${directory}`,{recursive:true});
