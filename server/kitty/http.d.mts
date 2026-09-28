import type { IncomingMessage, ServerResponse } from 'node:http';
export function kittyMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void;
