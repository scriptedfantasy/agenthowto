// A Worker may cancel the request that started asynchronous initialization.
// Remember completed work only; another request must own its own pending I/O.
export function completedInitialization(initialize: () => Promise<void>) {
  let complete = false;
  return async () => {
    if (complete) return;
    await initialize();
    complete = true;
  };
}
