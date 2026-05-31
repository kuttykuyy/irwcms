/**
 * Jest global setup — mock the Chrome extension API.
 */

const storageMock: Record<string, unknown> = {};

(global as any).chrome = {
  storage: {
    local: {
      get: jest.fn((keys: string | string[], cb?: (r: Record<string, unknown>) => void) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        keyList.forEach(k => { if (k in storageMock) result[k] = storageMock[k]; });
        if (cb) cb(result);
        return Promise.resolve(result);
      }),
      set: jest.fn((data: Record<string, unknown>, cb?: () => void) => {
        Object.assign(storageMock, data);
        cb?.();
        return Promise.resolve();
      }),
      remove: jest.fn((keys: string | string[], cb?: () => void) => {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storageMock[k]);
        cb?.();
        return Promise.resolve();
      }),
    },
  },
  tabs: {
    query:      jest.fn().mockResolvedValue([{ id: 1, url: 'https://ircep.gov.in/test' }]),
    sendMessage: jest.fn().mockResolvedValue({}),
  },
  scripting: {
    executeScript: jest.fn().mockResolvedValue([{ result: 0 }]),
  },
  runtime: {
    onMessage: { addListener: jest.fn() },
  },
};

/** Reset storage between tests */
export function clearStorage(): void {
  Object.keys(storageMock).forEach(k => delete storageMock[k]);
}

/** Seed storage */
export function seedStorage(data: Record<string, unknown>): void {
  Object.assign(storageMock, data);
}
