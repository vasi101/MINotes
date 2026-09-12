import {test,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
test('corner ring overlays the PDF without consuming reading space',async({page})=>{
  const pdf=await PDFDocument.create();pdf.addPage([500,700]).drawText('Edge to edge reading',{x:30,y:600});
  await page.goto('/');await page.getByRole('button',{name:'Read',exact:true}).click();
  await page.getByTestId('pdf-file-input').setInputFiles({name:'Ring.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await page.getByRole('button',{name:'Open Ring',exact:true}).click();
  const reader=page.locator('.pdf-viewer'),scroller=page.locator('.pdf-scroller');
  await expect(page.getByRole('button',{name:'Open tools',exact:true})).toBeVisible();
  await expect(page.getByRole('toolbar',{name:'Reader tools',exact:true})).toHaveCount(0);
  const before=await scroller.boundingBox(),outer=await reader.boundingBox();
  expect(before!.height).toBeCloseTo(outer!.height,0);expect(before!.y).toBeCloseTo(outer!.y,0);
  await page.getByRole('button',{name:'Open tools',exact:true}).click();
  await expect(page.getByRole('button',{name:'Highlight',exact:true})).toBeVisible();
  expect(await scroller.boundingBox()).toEqual(before);
  for(const button of await page.locator('.reader-ring-tool').all()){
    const box=await button.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y).toBeGreaterThanOrEqual(0);
  }
  await page.getByRole('button',{name:'Highlight',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open tools',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open tools',exact:true}).click();
  await page.getByRole('button',{name:'Reading controls',exact:true}).click();
  await expect(page.getByRole('button',{name:'Read fullscreen',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Back to library',exact:true})).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByRole('button',{name:'Close tools',exact:true})).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByRole('button',{name:'Open tools',exact:true})).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByRole('button',{name:'Highlight',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('t');
  await expect(page.getByRole('toolbar',{name:'Reader tools',exact:true})).toHaveCount(0);

});

test('selected annotations can change width in move mode',async({page})=>{
  const pdf=await PDFDocument.create();pdf.addPage([500,700]).drawText('Adjust width',{x:40,y:600});
  await page.goto('/');await page.getByRole('button',{name:'Read',exact:true}).click();
  await page.getByTestId('pdf-file-input').setInputFiles({name:'Width.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await page.getByRole('button',{name:'Open Width',exact:true}).click();
  await page.keyboard.press('m');
  const svg=page.locator('.pdf-annotation-layer').first();
  const box=await svg.boundingBox();
  await page.mouse.move(box!.x+120,box!.y+160);await page.mouse.down();await page.mouse.move(box!.x+240,box!.y+260,{steps:18});await page.mouse.up();
  const mark=page.locator('.pdf-annotation-layer path').first();
  await expect(mark).toBeVisible();
  const target=await mark.boundingBox();
  await page.mouse.click(target!.x + target!.width / 2, target!.y + target!.height / 2);
  await page.keyboard.press('g');
  await page.getByRole('button',{name:'Open tools',exact:true}).click();
  const slider=page.locator('[role="slider"]').first();
  const before=Number(await slider.getAttribute('aria-valuenow'));
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async()=>Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
});
