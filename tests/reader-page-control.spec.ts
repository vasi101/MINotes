import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
test('page controls can move, stay in bounds, and jump pages',async({page})=>{
 const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage([500,700]);
 await page.goto('/');await page.getByRole('button',{name:'Read',exact:true}).click();
 await page.getByTestId('pdf-file-input').setInputFiles({name:'Floating.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
 await page.getByRole('button',{name:'Open Floating',exact:true}).click();
 const pill=page.getByRole('form',{name:'Page navigation'});const handle=page.getByRole('group',{name:'Page counter'});
 const before=(await pill.boundingBox())!,box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+10,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+35,box.y+220,{steps:8});await page.mouse.up();
 expect((await pill.boundingBox())!.y).toBeGreaterThan(before.y+150);
 await page.getByRole('button',{name:'Toggle page card'}).click();
 await expect(pill).toHaveClass(/is-expanded/);
 await expect(page.getByRole('textbox',{name:'Current page'})).toHaveCSS('appearance','textfield');
 await page.screenshot({path:'artifacts/happy-cat-page-card.png'});
 await page.getByRole('textbox',{name:'Current page'}).fill('3');await page.getByRole('textbox',{name:'Current page'}).press('Enter');
 await expect(page.getByRole('textbox',{name:'Current page'})).toHaveValue('3');
 await expect(pill.getByRole('button',{name:'Go',exact:true})).toHaveCount(0);
 await page.setViewportSize({width:360,height:600});const resized=(await pill.boundingBox())!;
 expect(resized.x).toBeGreaterThanOrEqual(0);expect(resized.x+resized.width).toBeLessThanOrEqual(360);expect(resized.y+resized.height).toBeLessThanOrEqual(600);
 await expect(page.locator('.pdf-page-container').first()).toHaveCSS('box-shadow','none');
 await page.getByRole('button',{name:'Open tools',exact:true}).click();
 await page.screenshot({path:'artifacts/floating-page-glass-wheel.png'});
});

test('browser menus and browser zoom shortcuts are suppressed',async({page})=>{
 await page.goto('/');
 const prevented=await page.evaluate(()=>{
  const menu=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.body.dispatchEvent(menu);
  const wheel=new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,bubbles:true,cancelable:true});document.body.dispatchEvent(wheel);
  const key=new KeyboardEvent('keydown',{ctrlKey:true,key:'+',bubbles:true,cancelable:true});document.body.dispatchEvent(key);
  return [menu.defaultPrevented,wheel.defaultPrevented,key.defaultPrevented];
 });
 expect(prevented).toEqual([true,true,true]);
});
