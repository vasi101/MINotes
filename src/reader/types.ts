export type PdfRect = { x:number; y:number; width:number; height:number };
export type PdfMark = {id:string;page:number;kind:'highlight'|'marker'|'ink';color:string;rects:PdfRect[];points:number[];width:number;text?:string};
export type ReadDocument = {id:string;name:string;pages:number;size:number;addedAt:string;lastPage:number;zoom:number;marks:PdfMark[];thumbnail?:string;folder?:string;favourite?:boolean;toRead?:boolean;lastOpenedAt?:string;sourceId?:string;sourcePath?:string;sourceModified?:number};
export type ReaderTool = 'select'|'highlight'|'marker'|'ink'|'erase';
