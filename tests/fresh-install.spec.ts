import {test,expect} from '@playwright/test';
test('fresh installations start empty and retain newly created content',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'All notes',exact:true})).toContainText('0 notes');
  await expect(page.locator('.folder-tile')).toHaveCount(1);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();await expect(page.getByText('No tasks yet')).toBeVisible();
  await page.getByRole('button',{name:'Read',exact:true}).click();await expect(page.getByText('No PDF documents yet')).toBeVisible();
  await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'New note',exact:true}).click();
  await page.getByLabel('Note title').fill('My own note');await page.getByLabel('Note content').fill('Keep my content');
  await page.getByRole('button',{name:'Back to notes',exact:true}).click();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('minotes-v1')!).state);
  expect(state.notes).toHaveLength(1);expect(state.tasks).toEqual([]);expect(state.folders).toEqual([]);expect(state.readDocuments).toEqual([]);
  await page.reload();await page.getByRole('button',{name:'All notes',exact:true}).click();await page.getByRole('button',{name:/My own note/}).click();await expect(page.getByLabel('Note content')).toContainText('Keep my content');
});
