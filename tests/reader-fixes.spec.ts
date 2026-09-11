import {test,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
async function pdfBytes(count=1){const pdf=await PDFDocument.create();for(let i=0;i<count;i++){const page=pdf.addPage(i===3?[700,500]:[500,700]);page.drawText('Human Resource Management',{x:50,y:600,size:22});page.drawText('Selected text stays aligned when zooming.',{x:50,y:550,size:16});}return Array.from(await pdf.save());}
test('folder picker preserves every directory even empty, non-PDF, or failed PDF',async({page})=>{
  const bytes=await pdfBytes();await page.goto('/');
  await page.evaluate(bytes=>{
    const file=(name:string,good=true)=>({kind:'file',name,getFile:async()=>new File([new Uint8Array(good?bytes:[1,2,3])],name,{type:'application/pdf'})});
    const directory=(name:string,entries:unknown[])=>({kind:'directory',name,async *values(){yield* entries}});
    Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>directory('NASU',[
      directory('1FT',[file('first.pdf')]),directory('2ND',[file('second.pdf')]),directory('3RD',[]),directory('Non PDF',[file('image.jpg')]),directory('Broken',[file('broken.pdf',false)])])});
  },bytes);
  await page.getByRole('button',{name:'Read',exact:true}).click();
  await page.locator('.reader-header-actions').getByRole('button',{name:'Import folder',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('2 imported, 1 failed');
  await page.locator('.reader-header-actions').getByRole('button',{name:'Import folder',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('2 imported, 1 failed');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.length)).toBe(2);
  await page.getByRole('button',{name:'NASU',exact:true}).click();
  await expect(page.locator('.folder-label')).toHaveText(['1FT','2ND','3RD','Broken','Non PDF']);
  const shelf=page.getByRole('navigation',{name:'Document collections'});
  const box=await shelf.boundingBox(),button=await shelf.getByRole('button',{name:'Library',exact:true}).boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(42);expect(button!.y+button!.height).toBeLessThanOrEqual(box!.y+box!.height);
  await page.getByRole('button',{name:'1FT',exact:true}).click();await expect(page.getByText('first',{exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Read',exact:true}).click();await page.getByRole('button',{name:'NASU',exact:true}).click();
  await expect(page.getByRole('button',{name:'3RD',exact:true})).toBeVisible();
});
test('highlight alignment, smooth zoom, annotation undo/redo and bounded page rendering',async({page})=>{
  await page.setViewportSize({width:1200,height:900});const bytes=await pdfBytes(12);await page.goto('/');
  await page.getByRole('button',{name:'Read',exact:true}).click();
  await page.getByTestId('pdf-file-input').setInputFiles({name:'Study.pdf',mimeType:'application/pdf',buffer:Buffer.from(bytes)});
  await page.getByRole('button',{name:'Open Study',exact:true}).click();
  const first=page.locator('[data-page-number="1"]');
  await expect(first).toHaveAttribute('data-rendered','true');
  await expect(first.locator('.pdf-text-layer')).toHaveAttribute('data-ready','true');
  const text=first.locator('.pdf-text-layer span').filter({hasText:'Human Resource Management'});
  await expect(text).toHaveCount(1);
  const initialFont=await text.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));expect(initialFont).toBeCloseTo(22,0);
  await page.getByRole('button',{name:'Highlight',exact:true}).click();
  await text.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))});
  const rect=first.locator('[data-kind="highlight"] rect');await expect(rect).toHaveCount(1);
  const before=await rect.boundingBox(),textBox=await text.boundingBox();expect(Math.abs(before!.x-textBox!.x)).toBeLessThan(2);expect(Math.abs(before!.width-textBox!.width)).toBeLessThan(2);expect(before!.height).toBeGreaterThan(30);
  await text.evaluate(el=>{(window as any).originalTextSpan=el});
  const initialWidth=(await first.boundingBox())!.width;
  await page.locator('.pdf-scroller').evaluate(el=>{const box=el.getBoundingClientRect();for(let i=0;i<10;i++)el.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-5,clientX:box.left+300,clientY:box.top+200,bubbles:true,cancelable:true}))});
  await expect.poll(async()=> (await first.boundingBox())!.width).toBeGreaterThan(initialWidth*1.09);
  expect((await first.boundingBox())!.width).toBeLessThan(initialWidth*1.12);
  expect(await text.evaluate(el=>el===(window as any).originalTextSpan)).toBe(true);
  const after=await rect.boundingBox(),afterText=await text.boundingBox();expect(Math.abs(after!.width-afterText!.width)).toBeLessThan(2);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(rect).toHaveCount(0);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(rect).toHaveCount(1);
  await page.getByRole('button',{name:'Pick color',exact:true}).click();await page.getByRole('button',{name:'Highlight color #72cd37',exact:true}).click();await expect(page.getByRole('button',{name:'Highlight shade #359f08',exact:true})).toBeVisible();await page.getByRole('button',{name:'Highlight shade #359f08',exact:true}).click();
  await page.keyboard.press('Escape');
  for(let i=0;i<8;i++)await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(page.locator('.reader-page-indicator')).toHaveText('9 / 12');
  await expect.poll(()=>page.locator('[data-active="true"]').count()).toBeLessThan(5);
  await expect(first.locator('canvas')).toHaveAttribute('width','1');
  await page.getByRole('button',{name:'Back to library',exact:true}).click();
  await page.getByRole('button',{name:'Open Study',exact:true}).click();
  await expect(page.locator('.reader-page-indicator')).toHaveText('9 / 12');
  await page.getByRole('button',{name:'PDF actions',exact:true}).click();await page.getByRole('button',{name:'Extract pages',exact:true}).click();
  await page.getByRole('textbox',{name:'Page range'}).fill('1, 3');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click();expect((await download).suggestedFilename()).toBe('Study_extract.pdf');
});
test('missing thumbnails regenerate from saved PDFs and survive reload without localStorage images',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Read',exact:true}).click();
  await page.getByTestId('pdf-file-input').setInputFiles({name:'Thumbnail.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdfBytes())});
  const image=page.getByRole('img',{name:'Preview of Thumbnail',exact:true});
  await expect(image).toBeVisible();await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(100);
  const ink=await image.evaluate((el:HTMLImageElement)=>{const canvas=document.createElement('canvas');canvas.width=el.naturalWidth;canvas.height=el.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(el,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<150&&pixels[i+3]>0)dark++;return dark});
  expect(ink).toBeGreaterThan(50);
  await page.evaluate(async()=>{
    const doc=JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments[0];
    if(doc.thumbnail)throw new Error('Thumbnail should not consume localStorage');
    await new Promise<void>((resolve,reject)=>{const req=indexedDB.open('minotes-pdf-files',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('files','readwrite');tx.objectStore('files').delete(`thumbnail:${doc.id}`);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});
  });
  await page.reload();await page.getByRole('button',{name:'Read',exact:true}).click();await expect(image).toBeVisible();await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(100);
  await page.screenshot({path:'artifacts/reader-thumbnail-fixed.png'});
  await page.reload();await page.getByRole('button',{name:'Read',exact:true}).click();await expect(image).toBeVisible();
});
