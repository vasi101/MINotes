import { chromium } from '@playwright/test';
import path from 'node:path';
const folderPath=process.argv[2];
if(!folderPath)throw new Error('Pass the absolute folder path to verify.');
const browser=await chromium.launch({channel:'msedge'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.addInitScript(()=>Object.defineProperty(window,'showDirectoryPicker',{value:undefined,configurable:true}));
 await page.goto('http://127.0.0.1:1420');await page.getByRole('button',{name:'Read',exact:true}).click();
 await page.getByTestId('pdf-folder-input').setInputFiles(folderPath);
 await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('minotes-v1')||'{}');return s.state?.readDocuments?.length>0});
 await page.locator('.reader-header-actions').getByRole('button',{name:'Import folder',exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('.reader-header-actions [aria-label="Import folder"]').disabled,{},{timeout:180000});
 console.log(await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('minotes-v1')).state;return {folders:state.readFolders,documents:state.readDocuments.length,counts:state.readDocuments.reduce((acc,d)=>(acc[d.folder]=(acc[d.folder]||0)+1,acc),{}),errors:[...document.querySelectorAll('[role="alert"]')].map(el=>el.textContent)}}));
 await page.getByRole('button',{name:path.basename(folderPath),exact:true}).click();await page.screenshot({path:'artifacts/reader-folder-import.png'});
} finally {await browser.close()}
