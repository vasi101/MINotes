import {test,expect} from '@playwright/test';
test('fresh installations start empty and retain newly created content',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'All notes',exact:true})).toContainText('0 notes');
  await expect(page.locator('.folder-tile')).toHaveCount(1);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();await expect(page.getByText('No tasks yet')).toBeVisible();
  await page.getByRole('button',{name:'Read',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Document folders',exact:true})).toBeVisible();
  const initial = await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useStore } = await import(path);
    const { notes, tasks, folders, readDocuments, readFolders } = useStore.getState();
    return { notes, tasks, folders, readDocuments, readFolders };
  });
  expect(initial).toEqual({ notes: [], tasks: [], folders: [], readDocuments: [], readFolders: [] });
  await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'New note',exact:true}).click();
  await page.getByLabel('Note title').fill('My own note');
  await page.getByTestId('toolbar-text').locator('..').click();
  await page.mouse.click(290, 350);
  await page.locator('textarea.excalidraw-wysiwyg').fill('Keep my content');
  await page.locator('textarea.excalidraw-wysiwyg').press('Escape');
  await page.getByRole('button',{name:'Back to notes',exact:true}).click();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('minotes-v1')!).state);
  expect(state.notes).toHaveLength(1);expect(state.tasks).toEqual([]);expect(state.folders).toEqual([]);expect(state.readDocuments).toEqual([]);
  await page.reload();await page.getByRole('button',{name:'All notes',exact:true}).click();await page.getByRole('button',{name:/My own note/}).click();
  await expect(page.locator('.excalidraw')).toBeVisible();
  const saved = await page.evaluate(async () => {
    const path = '/src/canvas/storage.ts';
    const state = JSON.parse(localStorage.getItem('minotes-v1')!).state;
    return (await import(path)).loadScene(state.notes[0].id);
  });
  expect(saved.elements.some((element: { text?: string }) => element.text === 'Keep my content')).toBe(true);
});
