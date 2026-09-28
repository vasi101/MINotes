import { createInterface } from 'node:readline';
import { KittyAIService } from './service.mjs';
// stdout is exclusively the app's private JSON-line IPC channel.
console.log = (...args) => console.error(...args);
const service = new KittyAIService();
const write = data => process.stdout.write(JSON.stringify(data) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  void (async () => {
    let message;
    try {
      message = JSON.parse(line);
      const result = await service.request(message.method, message.args, data => write({ id: message.id, event: data }));
      write({ id: message.id, result });
    } catch (error) { write({ id: message?.id, error: error instanceof Error ? error.message : 'Kitty could not complete this action.' }); }
  })();
}).on('close', () => process.exit(0));
