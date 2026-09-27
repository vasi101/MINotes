import {cpSync,mkdirSync} from 'node:fs';
mkdirSync('public/pdfjs',{recursive:true});
for(const directory of ['cmaps','standard_fonts','wasm'])cpSync(`node_modules/pdfjs-dist/${directory}`,`public/pdfjs/${directory}`,{recursive:true});

// Bundle native Excalidraw fonts for offline desktop use.
cpSync("node_modules/@excalidraw/excalidraw/dist/prod/fonts", "public/excalidraw/fonts", { recursive: true });
