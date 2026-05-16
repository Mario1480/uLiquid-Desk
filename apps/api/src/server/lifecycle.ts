export type ApiLifecycleTask = {
  name: string;
  start(): void;
  stop(): void;
};

export type ApiLifecycleCloser = {
  name: string;
  close(): void;
};

export function createApiLifecycle(params: {
  tasks: ApiLifecycleTask[];
  closers: ApiLifecycleCloser[];
}) {
  let started = false;
  let shutdownStarted = false;

  function start() {
    if (started) return;
    started = true;
    for (const task of params.tasks) {
      task.start();
    }
  }

  function shutdown() {
    if (shutdownStarted) return;
    shutdownStarted = true;
    for (const task of params.tasks) {
      task.stop();
    }
    for (const closer of params.closers) {
      closer.close();
    }
  }

  return {
    start,
    shutdown
  };
}
